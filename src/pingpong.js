/* 
 * PingPongWebGL is licensed under MIT licensed. See LICENSE.md file for more information.
 * Copyright (c) 2014 Imanol Fernandez @MortimerGoro
*/

'use strict';

(function () {

    window.PingPong = window.PingPong || {};

    // HUD 更新函数
    function updateScoreHUD(statusText) {
        var playerEl = document.getElementById('player-score');
        var aiEl = document.getElementById('ai-score');
        var statusEl = document.getElementById('status-text');

        if (playerEl) playerEl.textContent = playerScore;
        if (aiEl) aiEl.textContent = aiScore;

        if (statusEl) {
            if (statusText) {
                statusEl.textContent = statusText;
            } else {
                statusEl.textContent = 'Click / tap to serve, move to control the paddle.';
            }
        }
    }




    // 场景全局对象
    var camera, scene, controls;
    var screenSize, tableSize, paddleSize, ballSize;
    var paddle, paddleAI;
    var paddleTrajectory = [];
    var ball;

    // 状态机
    var STATES = {
        LOADING: 0,
        SERVING: 1,
        TOSSING: 2,
        PLAYING: 3,
        NET_HIT: 4     // 新增：撞网后的短暂停顿状态
    };
    var state = STATES.LOADING;



    var input = { x: 0, y: 0 };
    var inputPlane;
    var projector = new THREE.Projector();

    var serveTossForce = 0.015;
    var paddleNormalVector = new THREE.Vector3(0, 0, -1);
    var paddleFriction = 0.7;

    // 记录模拟前一帧的球 z 方向速度，用来判断是谁打不过网
    var lastBallVz = 0;

    // 计分系统
    var playerScore = 0;
    var aiScore = 0;
    var POINTS_TO_WIN = 11;  // 一局 11 分
    var MIN_LEAD = 2;        // 至少领先 2 分

    // 撞网动画时间 & 计时器
    var NET_HIT_DURATION = 1;  // 秒
    var netHitTimer = 0;


    // ================= GameScene 构造函数（已去重） =================

    PingPong.GameScene = function (renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        // 保存球网的物理盒和 mesh
        this.netBox = null;
        this.netMesh = null;

        this.simulation = null;
        this.ai = null;

        // 新增：记录本回合击球方和桌面触球情况
        this.currentHitter = null;        // "player" 或 "ai"
        this.touchedPlayerTable = false;  // 本回合是否碰过玩家桌面
        this.touchedAiTable = false;      // 本回合是否碰过 AI 桌面

        this.init();


        // 初始化 HUD 分数显示
        updateScoreHUD();
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
                    planeMaterial = new THREE.MeshBasicMaterial({
                        map: new THREE.ImageUtils.loadTexture(plane.texture),
                        side: THREE.DoubleSide
                    });
                }
                else { //light on the floor (test)
                    planeMaterial = new THREE.MeshPhongMaterial({
                        map: new THREE.ImageUtils.loadTexture(plane.texture),
                        ambient: 0x333333,
                        side: THREE.DoubleSide
                    });
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

                //Simulation boxes 球台高度H是视觉上球网的高度，实际碰撞高度为0.8465H
                var tw = tableSize.width * 0.91;
                var th = tableSize.height * 0.083;
                var ty = tableSize.height * 0.805;

                var tablebox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
                tablebox.setFromCenterAndSize(
                    new THREE.Vector3(0, ty, 0),
                    new THREE.Vector3(tw, th, tableSize.depth)
                );
                me.simulation.addBox(tablebox, "table");

                // 绑定桌面触球回调：利用 z 判断是玩家半台还是 AI 半台
                me.simulation.onTableHit = function (pos) {
                    if (!tableSize) return;

                    var halfW = tableSize.width * 0.5;
                    var halfD = tableSize.depth * 0.5;

                    // 只在球落在桌面投影范围内时记录
                    if (Math.abs(pos.x) <= halfW && Math.abs(pos.z) <= halfD) {
                        if (pos.z > 0) {
                            me.touchedPlayerTable = true;
                        } else if (pos.z < 0) {
                            me.touchedAiTable = true;
                        }
                    }
                };



                // ===== 实体球网（物理 + 可见），保持你当前参数 =====
                var netHeight = tableSize.height * 0.175;          // 网高：略高于桌面
                var netThickness = tableSize.depth * 0.002;       // 网厚：很薄的一条
                var netWidth = tableSize.width * 0.98;            // 宽度略小于桌子

                // 物理盒中心（在 z = 0 中线）
                var netCenter = new THREE.Vector3(
                    0,
                    tableSize.height * 0.9125,  // 与你当前版本保持一致
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

                me.ai = new PingPong.AI(me.simulation, tableSize, paddleAI, paddleSize, ball, ballRadius, me);

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

            // ✅ 清理上一回合的击球信息，避免极端情况下“脏数据”影响下一分
            this.currentHitter = null;
            this.touchedPlayerTable = false;
            this.touchedAiTable = false;

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

            // ========== NET_HIT 状态：只演 0.3 秒软网回弹 ==========
            if (state === STATES.NET_HIT) {
                // 只跑物理，让球自己弹一小下，然后下落
                this.simulation.simulate();

                // 简单按 60fps 估算时间
                netHitTimer -= 1 / 60;
                if (netHitTimer <= 0) {
                    // 播完动画后重置发球
                    this.resetServe();
                    // 恢复默认 HUD 提示（保留当前比分）
                    updateScoreHUD();
                    state = STATES.SERVING; //✅ 从 NET_HIT 回到发球状态

                }
                // 不更新相机、不移动球拍，完全冻结玩家和 AI
                return;
            }

            // ========== 普通状态 ==========
            // AI：只有在对拉中才动
            if (state === STATES.PLAYING) {
                this.ai.play();
            }






            // // 撞网判定：这里用的是 lastBallVz（撞网前的方向）
            // if (this.isBallTouchingNet()) {
            //     // 发球抛球阶段撞网：算发球失败，不计分，只重置发球
            //     if (state === STATES.TOSSING) {
            //         // this.resetServe();
            //         // return;
            //         // 发球阶段撞网也计分：一定是玩家不过网 → AI 得分
            //         this.awardPoint("ai");
            //         state = STATES.NET_HIT;
            //         netHitTimer = NET_HIT_DURATION;
            //         return;
            //     }

            //     if (state === STATES.PLAYING) {
            //         // 对拉阶段撞网：用“触球后桌面是否合法”的规则来判
            //         this.judgeStrokeResult("net");

            //         // 撞网动画仍然沿用 NET_HIT 状态
            //         state = STATES.NET_HIT;
            //         netHitTimer = NET_HIT_DURATION;
            //         return;
            //     }

            // }

            if (state === STATES.PLAYING || state === STATES.TOSSING) {
                // 只记录一下当前 z 速度（备用），然后推进一帧物理
                var vNow = this.simulation.getLinearVelocity();
                if (vNow) {
                    lastBallVz = vNow.z;
                }

                this.simulation.simulate();

                // 撞网判定：逻辑不变
                // 撞网判定：这里用的是 lastBallVz（撞网前的方向）
                if (this.isBallTouchingNet()) {
                    // 发球抛球阶段撞网：算发球失败，不计分，只重置发球
                    if (state === STATES.TOSSING) {
                        // this.resetServe();
                        // return;
                        // 发球阶段撞网也计分：一定是玩家不过网 → AI 得分
                        this.awardPoint("ai");
                        state = STATES.NET_HIT;
                        netHitTimer = NET_HIT_DURATION;
                        return;
                    }

                    if (state === STATES.PLAYING) {
                        // 对拉阶段撞网：用“触球后桌面是否合法”的规则来判
                        this.judgeStrokeResult("net");

                        // 撞网动画仍然沿用 NET_HIT 状态
                        state = STATES.NET_HIT;
                        netHitTimer = NET_HIT_DURATION;
                        return;
                    }
                }
            }


            // ======= 下面保持你原来的相机 / 输入 / 拍子逻辑不动 =======

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
                // 发球准备阶段：球跟在玩家球拍上
                ball.position.set(
                    paddle.position.x,
                    paddle.position.y + paddleSize.height,
                    paddle.position.z
                );
            } else {
                // 对拉 / 抛球阶段：先检测玩家是否击球
                this.checkBallHit();

                // 落地检测：只在 TOSSING 或 PLAYING 下关心
                if ((state === STATES.TOSSING || state === STATES.PLAYING) && this.hasBallTouchedFloor()) {

                    // 发球阶段落地：不计分，只重新发球
                    if (state === STATES.TOSSING) {
                        this.resetServe();
                    }

                    // 对拉阶段落地：用“触球后桌面是否合法”的规则来判
                    else if (state === STATES.PLAYING) {
                        this.judgeStrokeResult("floor");
                        this.resetServe();
                    }
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

                // 玩家击球成功后
                this.currentHitter = "player";
                this.touchedPlayerTable = false;
                this.touchedAiTable = false;


                // ==== 关闭旋转：不再计算 spin，不再传递给物理引擎 ====
                //var spin = this.calculateSpin(trayectoryHit, yDistance, force);
                //this.simulation.hitBall(dir, force, { spin: spin });

                this.simulation.hitBall(dir, force);
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

        // ==== 关闭旋转：不再计算 spin ====
        // calculateSpin: function (trayectory, yDistance, force) {
        //     var spin = new THREE.Vector3(0, 0, 0);
        //     var tangent = new THREE.Vector3(trayectory.x, trayectory.y, 0);
        //     var tangentLen = tangent.length();
        //     if (tangentLen > 0.0001) {
        //         spin.copy(tangent).cross(paddleNormalVector);
        //         var spinLen = spin.length();
        //         if (spinLen > 0.0001) {
        //             spin.normalize();
        //             var tangentScale = tableSize ? tableSize.width * 0.08 : 1;
        //             var tangentIntensity = Math.min(tangentLen / tangentScale, 1.5);
        //             var strength = tangentIntensity * (force / 0.02) * 8 * paddleFriction;
        //             spin.multiplyScalar(strength);
        //         }
        //     }
        //     if (typeof yDistance === "number" && paddleSize) {
        //         var offset = Math.max(Math.min(yDistance / paddleSize.height, 1), -1);
        //         spin.x += -offset * (force / 0.02) * 4 * paddleFriction;
        //     }
        //     return spin;
        // },

        judgeStrokeResult: function (eventType) {
            // 没有记录最后击球方，直接不判分（极端情况保护）
            if (!this.currentHitter) {
                return;
            }

            var hitter = this.currentHitter;                   // "player" or "ai"
            var opponent = (hitter === "player") ? "ai" : "player";

            // 以“击球方视角”来看本回合有没有碰到自己台 / 对方台
            var hitterTouchedOwn = (hitter === "player") ? this.touchedPlayerTable : this.touchedAiTable;
            var hitterTouchedOpp = (hitter === "player") ? this.touchedAiTable : this.touchedPlayerTable;

            var winner;

            // 情况1：这一板是“合法”的攻击 —— 球已经过网并先落到对方台一次，
            //        且在终结事件前没有落回自己台
            //
            //  -> 对方没把球打回来，所以【击球方得分】
            if (hitterTouchedOpp && !hitterTouchedOwn) {
                winner = hitter;
                console.log(
                    "[JUDGE]",
                    "hitter =", hitter,
                    "own =", hitterTouchedOwn,
                    "opp =", hitterTouchedOpp,
                    "event =", eventType
                );

            }
            // 情况2：否则就是“非法攻击”或“直接不过网”
            //  - 没有碰到对方台（hitterTouchedOpp === false）
            //  - 或者球又回到自己台（hitterTouchedOwn === true）
            //
            //  -> 说明是击球方这板有问题，所以【对方得分】
            else {
                winner = opponent;
                console.log(
                    "[JUDGE]",
                    "hitter =", hitter,
                    "own =", hitterTouchedOwn,
                    "opp =", hitterTouchedOpp,
                    "event =", eventType
                );

            }

            this.awardPoint(winner);
        },



        awardPoint: function (winner) {

            console.log("awardPoint called with winner =", winner);


            if (winner === "player") {
                playerScore++;
            } else if (winner === "ai") {
                aiScore++;
            }

            // 更新 HUD：显示是谁得分了（NET_HIT 期间保持这个文案）
            updateScoreHUD("Point → " + (winner === "player" ? "Player" : "AI"));

            // 控制台顺便打印一下
            console.log(
                "Point → " + winner +
                " | Score: Player " + playerScore + " - " + aiScore + " AI"
            );

            // 判断这一局是否结束
            var diff = playerScore - aiScore;
            if (playerScore >= POINTS_TO_WIN && diff >= MIN_LEAD) {
                console.log("Game over: Player wins the game!");
                updateScoreHUD("Game over: Player wins!");
                playerScore = 0;
                aiScore = 0;
            } else if (aiScore >= POINTS_TO_WIN && -diff >= MIN_LEAD) {
                console.log("Game over: AI wins the game!");
                updateScoreHUD("Game over: AI wins!");
                playerScore = 0;
                aiScore = 0;
            }

            // 注意：这里不再调用 resetServe()
            // 球的重置和状态切回 SERVING 交给 NET_HIT 状态里的定时器完成
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
