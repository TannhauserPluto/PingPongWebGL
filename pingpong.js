/* 
 * PingPongWebGL is licensed under MIT licensed. See LICENSE.md file for more information.
 * Copyright (c) 2014 Imanol Fernandez @MortimerGoro
*/

'use strict';

(function () {

    window.PingPong = window.PingPong || {};

    var camera, scene, controls;
    var screenSize, tableSize, paddleSize, ballSize;
    var paddle, paddleAI;
    var paddleTrajectory = [];
    var ball;
    var STATES = {
        LOADING: 0,
        SERVING: 1,
        TOSSING: 2,
        PLAYING: 3
    };
    var state = STATES.LOADING;
    var input = { x: 0, y: 0 };
    var inputPlane;
    var projector = new THREE.Projector();
    var serveTossForce = 0.015;
    var paddleNormalVector = new THREE.Vector3(0, 0, -1);
    var paddleFriction = 0.7;

    PingPong.GameScene = function(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        // 新增：保存球网的物理盒和 mesh
        this.netBox = null;
        this.netMesh = null;

        this.init();
    };

    PingPong.GameScene.prototype = {

        init: function () {
            //create scene
            scene = new THREE.Scene();
            screenSize = { width: this.renderer.domElement.width, height: this.renderer.domElement.height };
            screenSize = { width: window.innerWidth, height: window.innerHeight };
            //initialize camera
            camera = new THREE.PerspectiveCamera(45, screenSize.width / screenSize.height, 0.5, 20);
            scene.add(camera);
            camera.position.set(0, this.settings.height / 2, this.settings.depth / 2);
            camera.lookAt(scene.position);

            //initialize audio
            PingPong.Audio.init(this.settings);

            //create physics
            this.simulation = new PingPong.Physics();

            //initialize world
            this.loadPlanes();
            this.loadLight();
            this.loadModels();
            this.initInput();

            //controls = new THREE.OrbitControls( camera, this.renderer.domElement );
        },

        loadPlanes: function () {
            var planes = this.settings.planes;
            for (var i = 0; i < planes.length; ++i) {
                var plane = planes[i];
                var planeMaterial;
                if (i > 0 || navigator.isCocoonJS) {
                    planeMaterial = new THREE.MeshBasicMaterial({ map: new THREE.ImageUtils.loadTexture(plane.texture), side: THREE.DoubleSide });
                }
                else { //light on the floor (test)
                    planeMaterial = new THREE.MeshPhongMaterial({ map: new THREE.ImageUtils.loadTexture(plane.texture), ambient: 0x333333, side: THREE.DoubleSide });
                }
                planeMaterial.map.wrapS = THREE.RepeatWrapping;
                planeMaterial.map.wrapT = THREE.RepeatWrapping;
                var repeat = plane.repeat || [1, 1];
                planeMaterial.map.repeat.set(repeat[0], repeat[1]);

                var planeGeometry = new THREE.PlaneGeometry(plane.size[0], plane.size[1], 10, 10);
                var planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);

                if (plane.rotation) {
                    planeMesh.rotation.set(plane.rotation[0], plane.rotation[1], plane.rotation[2]);
                }
                if (plane.scale) {
                    planeMesh.scale.set(plane.scale[0], plane.scale[1], plane.scale[2]);
                }
                if (plane.position) {
                    planeMesh.position.set(plane.position[0], plane.position[1], plane.position[2]);
                }
                scene.add(planeMesh);
            }
        },

        loadLight: function () {

            if (navigator.isCocoonJS) {

                var directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
                directionalLight.position.set(0, 20, 20);
                scene.add(directionalLight);
            }
            else {
                var light = new THREE.PointLight(0xffffff);
                light.position.set(0, 2.5, 2);
                scene.add(light);

                light = new THREE.SpotLight(0xffffff, 0.8);
                light.position.set(0, 2.0, 4.0);
                light.target.position.set(0, 0, 0.2);
                light.target.updateMatrixWorld();
                scene.add(light);
            }
        },

        loadModels: function () {

            var me = this;
            var loader = new THREE.JSONLoader();
            loader.load(this.settings.table.model, onTableLoad);

            function onTableLoad(geometry, materials) {
                //change the table color or texture
                var tableSettings = { ambient: 0x000000, specular: 0x777777 };
                if (me.settings.table.texture) {
                    tableSettings.map = THREE.ImageUtils.loadTexture(me.settings.table.texture);
                }
                else {
                    tableSettings.color = me.settings.table.color;
                }
                var m = new THREE.MeshPhongMaterial(tableSettings);
                if (m.map) {
                    m.map.repeat.x = 0.1;
                    m.map.repeat.y = 0.03;
                    m.map.wrapS = THREE.RepeatWrapping;
                    m.map.wrapT = THREE.RepeatWrapping;
                }
                materials[1] = m;

                //compute the model size
                var table = new THREE.Mesh(geometry, new THREE.MeshFaceMaterial(materials));
                geometry.computeBoundingBox();
                var boundingBox = geometry.boundingBox;
                var modelSize = {
                    width: boundingBox.max.x - boundingBox.min.x,
                    depth: boundingBox.max.z - boundingBox.min.z,
                    height: boundingBox.max.y - boundingBox.min.y
                };

                //scale the table according to the aspect ratio and the defined size in settings
                var scale = me.settings.table.width / modelSize.width;
                table.scale.set(scale, scale, scale);
                tableSize = {
                    width: modelSize.width * scale,
                    depth: modelSize.depth * scale,
                    height: modelSize.height * scale,
                    scale: scale
                };

                //Simulation boxes
                var tw = tableSize.width * 0.91;
                var th = tableSize.height * 0.083;
                var ty = tableSize.height * 0.805;
                var tablebox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
                tablebox.setFromCenterAndSize(
                    new THREE.Vector3(0, ty, 0),
                    new THREE.Vector3(tw, th, tableSize.depth)
                );
                me.simulation.addBox(tablebox);

                // ===== 新增：实体球网（物理 + 可见） =====
                var netHeight = tableSize.height * 0.15;          // 网高：略高于桌面
                var netThickness = tableSize.depth * 0.002;       // 网厚：很薄的一条
                var netWidth = tableSize.width * 0.96;           // 宽度略小于桌子

                // 物理盒中心（在 z = 0 中线）
                var netCenter = new THREE.Vector3(
                    0,
                    tableSize.height - netHeight / 2,  // 从桌面往上
                    0
                );

                // 尺寸向量
                var netSize = new THREE.Vector3(
                    netWidth,
                    netHeight,
                    netThickness
                );

                // 1）物理：添加到 Physics 里，让球可以和网发生碰撞
                var netBox = new THREE.Box3();
                netBox.setFromCenterAndSize(netCenter, netSize);
                me.simulation.addBox(netBox);
                me.netBox = netBox;

                // 2）可视：创建一个半透明白色长方体当作球网
                var netGeometry = new THREE.CubeGeometry(netSize.x, netSize.y, netSize.z);
                var netMaterial = new THREE.MeshLambertMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: 0.7
                });
                var netMesh = new THREE.Mesh(netGeometry, netMaterial);
                netMesh.position.copy(netCenter);
                scene.add(netMesh);
                me.netMesh = netMesh;


                //Initial camera position according to the table size
                camera.position.set(0, tableSize.height * 1.7, tableSize.depth / 2 * 2.3);
                var vector = new THREE.Vector3(0, tableSize.height, 0);
                camera.lookAt(vector);

                //Initialize the inputPlane
                inputPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), tableSize.height * 0.95);

                //setup table propeties and add it to the scene
                table.matrixAutoUpdate = false;
                table.updateMatrix();
                scene.add(table);

                //load paddles
                loader.load(me.settings.paddle.model, onPaddleLoad);
            }

            function onPaddleLoad(geometry, materials) {
                //scale the paddles the same way as the table
                var scale = tableSize.scale;

                paddle = new THREE.Mesh(geometry, new THREE.MeshFaceMaterial(materials));
                paddle.scale.set(scale, scale, scale);
                paddle.position.set(0, tableSize.height, tableSize.depth / 2);
                scene.add(paddle);

                var mat = new THREE.MeshFaceMaterial(materials, { side: THREE.DoubleSide });
                mat.side = THREE.DoubleSide;
                paddleAI = new THREE.Mesh(geometry, mat);
                paddleAI.scale.set(scale, scale, scale);
                paddleAI.position.set(0, tableSize.height, -tableSize.depth / 2);
                scene.add(paddleAI);

                geometry.computeBoundingBox();
                var boundingBox = geometry.boundingBox;
                var modelSize = {
                    width: boundingBox.max.x - boundingBox.min.x,
                    depth: boundingBox.max.z - boundingBox.min.z,
                    height: boundingBox.max.y - boundingBox.min.y
                };
                paddleSize = {
                    width: modelSize.width * scale,
                    depth: modelSize.depth * scale,
                    height: modelSize.height * scale,
                    scale: scale
                };

                var ballRadius = paddleSize.width * 0.13;
                var ballGeometry = new THREE.SphereGeometry(ballRadius, 16, 16);
                var ballMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, ambient: 0xcccccc });
                ball = new THREE.Mesh(ballGeometry, ballMaterial);
                ball.position.set(0, tableSize.height * 2, tableSize.depth * 0.25);
                scene.add(ball);
                me.simulation.setBall(ball, ballRadius);
                ballSize = ballRadius;

                me.ai = new PingPong.AI(me.simulation, tableSize, paddleAI, paddleSize, ball, ballRadius);

                state = STATES.SERVING;
            }

        },

        initInput: function () {

            var me = this;
            function inputHandler(ev) {
                if (ev.targetTouches && ev.targetTouches.length > 1) {
                    me.serve();
                    return;
                }
                var x = ev.targetTouches ? ev.targetTouches[0].clientX : ev.clientX;
                var y = ev.targetTouches ? ev.targetTouches[0].clientY : ev.clientY;
                me.processInput(x, y);
            }

            this.renderer.domElement.addEventListener("mousedown", function () { me.serve(); });
            this.renderer.domElement.addEventListener("mousemove", inputHandler);
            this.renderer.domElement.addEventListener("touchstart", inputHandler);
            this.renderer.domElement.addEventListener("touchmove", inputHandler);
        },

        processInput: function (x, y) {
            input.x = x;
            input.y = y;
        },

        serve: function () {
            if (state !== STATES.SERVING) {
                return;
            }
            ball.position.set(paddle.position.x, paddle.position.y + paddleSize.height, paddle.position.z);
            var dir = new THREE.Vector3(0, 1, 0);
            this.simulation.hitBall(dir, serveTossForce, { silent: true });
            state = STATES.TOSSING;
        },

        resetServe: function () {
            if (this.simulation) {
                this.simulation.resetBall();
            }
            paddleTrajectory.length = 0;
            state = STATES.SERVING;
            if (paddle && ball && paddleSize) {
                ball.position.set(paddle.position.x, paddle.position.y + paddleSize.height, paddle.position.z);
            }
        },

        hasBallTouchedFloor: function () {
            if (!ballSize || !ball) {
                return false;
            }
            return ball.position.y <= ballSize;
        },

        toScreen: function (x, y, z) {
            var widthHalf = screenSize.width / 2;
            var heightHalf = screenSize.height / 2;

            var projector = new THREE.Projector();
            var vector = projector.projectVector(new THREE.Vector3(x, y, z), camera);

            vector.x = (vector.x * widthHalf) + widthHalf;
            vector.y = -(vector.y * heightHalf) + heightHalf;
            return vector;
        },

        toWorld: function (x, y, zPlane) {
            var vector = new THREE.Vector3(
                (x / screenSize.width) * 2 - 1,
                -(y / screenSize.height) * 2 + 1,
                0.5);

            projector.unprojectVector(vector, camera);
            var dir = vector.sub(camera.position).normalize();
            zPlane = zPlane || 0;
            var distance = -(camera.position.z - zPlane) / dir.z;
            return camera.position.clone().add(dir.multiplyScalar(distance));
        },

        // =================== 核心：逻辑更新 ===================
        update: function () {
            if (state === STATES.LOADING) {
                return;
            }

            // AI & 物理
            if (state === STATES.PLAYING) {
                this.ai.play();
            }
            if (state === STATES.PLAYING || state === STATES.TOSSING) {
                this.simulation.simulate();
                if (state === STATES.PLAYING) {
                    this.ai.play();
                }
                if (state === STATES.PLAYING || state === STATES.TOSSING) {
                    this.simulation.simulate();

                    // ===== 新增：球撞到网就结束当前回合，进入下一次发球 =====
                    if (this.isBallTouchingNet()) {
                        // 这里先不做计分，只结束本回合、重置发球
                        this.resetServe();
                        return;
                    }
                }

            }

            // normalize input
            var px = (input.x / screenSize.width) * 2 - 1;
            var py = -(input.y / screenSize.height) * 2 + 1;

            // set camera position
            var cx = tableSize.width * 0.5 * px;
            var cy = tableSize.height * 1.5; // + tableSize.height * 0.3 * py;
            var cz = tableSize.depth / 2 * 3 * Math.abs(py);
            cz = Math.max(cz, tableSize.depth * 0.3);
            camera.position.set(cx, cy, cz);
            camera.lookAt(new THREE.Vector3(0, tableSize.height, 0));

            // Project input to table plane
            var maxpy = Math.min(0, py);
            var vector = new THREE.Vector3(px, maxpy, 0.5);
            projector.unprojectVector(vector, camera);
            var ray = new THREE.Ray(camera.position, vector.sub(camera.position).normalize());
            var intersect = ray.intersectPlane(inputPlane);

            if (!intersect) {
                intersect = paddle.position.clone();
            }
            intersect.z = Math.max(intersect.z, tableSize.depth * 0.05);

            // set paddle position
            paddle.position.x = intersect.x;
            paddle.position.z = intersect.z;
            paddle.position.y = tableSize.height;

            if (state === STATES.SERVING) {
                ball.position.set(paddle.position.x, paddle.position.y + paddleSize.height, paddle.position.z);
            }
            else {
                this.checkBallHit();
                if ((state === STATES.TOSSING || state === STATES.PLAYING) && this.hasBallTouchedFloor()) {
                    this.resetServe();
                }
            }

            // set paddle rotation
            var dx = Math.min(1, Math.abs(paddle.position.x / (tableSize.width * 0.6)));
            var dxAI = Math.min(1, Math.abs(paddleAI.position.x / (tableSize.width * 0.6)));

            paddle.rotation.z = Math.PI * 0.5 * dx * (paddle.position.x > 0 ? -1.0 : 1.0);
            paddle.rotation.x = Math.PI * 0.2 * dx;
            paddle.rotation.y = Math.PI * 0.2 * dx * (paddle.position.x > 0 ? 1.0 : -1.0);

            paddleAI.rotation.z = Math.PI * 0.5 * dxAI * (paddleAI.position.x > 0 ? 1.0 : -1.0);
            paddleAI.rotation.x = -Math.PI * 0.2 * dxAI;
            paddleAI.rotation.y = Math.PI * 0.2 * dxAI * (paddleAI.position.x > 0 ? -1.0 : 1.0);
            paddleAI.rotation.y += Math.PI;
        },

        checkBallHit: function () {
            var hitting = false;
            var hit = false;
            //check if paddle and ball are close
            var incomingBall = this.simulation.getLinearVelocity().z > 0 || state === STATES.TOSSING;
            var zInFront = paddle.position.z > ball.position.z;
            var yDistance = 0;

            if (incomingBall && (zInFront || state === STATES.TOSSING)) {
                //store trayectory
                var trayectory = {
                    time: Date.now(),
                    x: paddle.position.x,
                    y: paddle.position.y,
                    z: paddle.position.z
                };
                paddleTrajectory.push(trayectory);

                //check hit distances
                var zDistance = paddle.position.z - ball.position.z;
                var xDistance = Math.abs(paddle.position.x - ball.position.x);
                yDistance = paddle.position.y - ball.position.y;
                hit = zDistance < tableSize.depth * 0.03 && xDistance < paddleSize.width && Math.abs(yDistance) < paddleSize.height * 0.75;
                hitting = zDistance < tableSize.depth * 0.2 && xDistance < paddleSize.width;
            }

            //target paddle y position
            var targetY = tableSize.height;
            if (hitting) {
                targetY = ball.position.y;
            }
            var diffY = paddle.position.y - targetY;
            paddle.position.y += Math.min(Math.abs(diffY), paddleSize.height * 0.1) * (diffY ? -1 : 1);

            if (hit) {
                var trayectoryHit = this.calculatePaddleTrajectory();
                trayectoryHit.z = Math.min(trayectoryHit.z, 0);

                var dir = new THREE.Vector3(0, 0, 0);
                //fixed z
                dir.z = -1.0;
                //trayector dependant x
                var tx = trayectoryHit.x / (tableSize.width * 0.1);
                dir.x = 0.6 * Math.min(Math.abs(tx), 1.0) * (tx > 0 ? 1 : -1);
                //trayectory dependant force and y
                var tz = trayectoryHit.z / (tableSize.depth * 0.25);
                tz = Math.min(Math.abs(tz), 1);
                var force = 0.02 + tz * 0.01;

                dir.y = 0.4;
                if (ball.position.y < tableSize.height) {
                    dir.y += 0.1;
                }
                else {
                    force *= 1.1;
                }

                dir.y -= force * 2;
                if (paddle.position.z < tableSize.depth / 2) {
                    dir.y -= 0.1;
                }

                var spin = this.calculateSpin(trayectoryHit, yDistance, force);
                this.simulation.hitBall(dir, force, { spin: spin });
                state = STATES.PLAYING;
                paddleTrajectory.length = 0; //clear
            }

        },

        calculatePaddleTrajectory: function () {
            var now = Date.now();
            var trayectory = new THREE.Vector3(0, 0, 0);
            var prevT = null;
            for (var i = 0; i < paddleTrajectory.length; ++i) {
                var t = paddleTrajectory[i];
                if (now - t.time > 200) {
                    continue; //we only check 200ms trayectory
                }
                if (!prevT) {
                    prevT = t;
                    continue;
                }
                trayectory.set(
                    trayectory.x + t.x - prevT.x,
                    trayectory.y + t.y - prevT.y,
                    trayectory.z + t.z - prevT.z
                );
                prevT = t;
            }
            return trayectory;

        },

        calculateSpin: function (trayectory, yDistance, force) {
            var spin = new THREE.Vector3(0, 0, 0);
            var tangent = new THREE.Vector3(trayectory.x, trayectory.y, 0);
            var tangentLen = tangent.length();
            if (tangentLen > 0.0001) {
                spin.copy(tangent).cross(paddleNormalVector);
                var spinLen = spin.length();
                if (spinLen > 0.0001) {
                    spin.normalize();
                    var tangentScale = tableSize ? tableSize.width * 0.08 : 1;
                    var tangentIntensity = Math.min(tangentLen / tangentScale, 1.5);
                    var strength = tangentIntensity * (force / 0.02) * 8 * paddleFriction;
                    spin.multiplyScalar(strength);
                }
            }
            if (typeof yDistance === "number" && paddleSize) {
                var offset = Math.max(Math.min(yDistance / paddleSize.height, 1), -1);
                spin.x += -offset * (force / 0.02) * 4 * paddleFriction;
            }
            return spin;
        },

        // 检测球是否碰到球网
        isBallTouchingNet: function () {
            if (!this.netBox || !ball || !ballSize) {
                return false;
            }

            var nb = this.netBox;
            var x = ball.position.x;
            var y = ball.position.y;
            var z = ball.position.z;
            var r = ballSize;

            // 简单 AABB 检查：考虑球半径 padding
            var inside =
                (x + r >= nb.min.x && x - r <= nb.max.x) &&
                (y + r >= nb.min.y && y - r <= nb.max.y) &&
                (z + r >= nb.min.z && z - r <= nb.max.z);

            return inside;
        },

        // =================== 渲染 ===================
        render: function () {
            if (controls) {
                controls.update();
            }
            // 不再调用 this.update()，逻辑由 main.js 驱动
            this.renderer.render(scene, camera);
        }
    };

})();
