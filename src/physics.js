/* 
 * PingPongWebGL is licensed under MIT licensed. See LICENSE.md file for more information.
 * Copyright (c) 2014 MortimerGoro
 */

'use strict';

(function () {

    window.PingPong = window.PingPong || {};

    // 线速度 & 角速度（全局共享，维持原有行为）
    var linearVelocity = new THREE.Vector3(0, 0, 0);
    var angularVelocity = new THREE.Vector3(0, 0, 0);

    var ballRadius = 0;

    // 基本物理参数
    var gravity = -4.8;            // “加速度”的大小
    var prevGravity = 0;
    var gravityTime = 0;

    var restitution = 0.75;        // 反弹系数
    var magnusStrength = 0.020;    // 马格努斯效应强度
    var spinDamping = 0.8;         // 自由飞行时的自旋衰减
    var bounceSpinDamping = 0.8;   // 碰撞带来的自旋衰减
    var contactSpinTransfer = 0.4; // 自旋向线速度的传递

    var ballBoundingBox = new THREE.Box3();
    var tmpVector = new THREE.Vector3();

    // 网材质：比桌面“更吃球”，反弹更小
    var netRestitution = 0.15;        // 网的法向反弹系数（比桌子低很多）
    var netTangentialDamping = 0.3;   // 网对切向速度的强衰减
    var netSpinDamping = 0.25;        // 碰网后自旋强力衰减
    var netContactSpinTransfer = 0.1; // 碰网时几乎不再给球额外自旋
    var netExtraDownward = 0.02;      // 轻微往下压一点，让球更快掉落


PingPong.Physics = function () {
    this.ball = null;
    this.boxes = [];

    // 新增：当球击中桌面顶面时的回调（由 GameScene 注入）
    this.onTableHit = null;
};


    PingPong.Physics.prototype = {

    addBox: function (box, type) {
        // type: 'default' | 'net' | 以后可以扩展其他材质
        this.boxes.push({
            box: box,
            type: type || 'default'
        });
    },


        setBall: function (ball, radius) {
            this.ball = ball;
            ballRadius = radius;
        },

        getLinearVelocity: function () {
            return linearVelocity;
        },

        /**
         * 给球一个初速度（和可选自旋）
         * dir：方向（未归一化也可以）
         * force：标量强度
         */
        hitBall: function (dir, force, options) {
            options = options || {};

            linearVelocity.copy(dir).multiplyScalar(force);

            // ==== 关闭自旋逻辑：不再使用 options.spin ====
            /*
            if (options.spin) {
                angularVelocity.copy(options.spin);
            } else {
                angularVelocity.set(0, 0, 0);
            }
            */
            angularVelocity.set(0, 0, 0);

            // 重置重力积分
            prevGravity = 0;
            gravityTime = 0;

            if (!options.silent) {
                PingPong.Audio.playPaddleSound();
            }
        },


        /**
         * 每一帧做一次物理更新
         * step：时间步长（秒），默认 1/60
         */
        simulate: function (step) {
            step = step || 1 / 60;

            if (!this.ball) return;

            // 重力积分（原作风格：用 “位移增量” vg）
            gravityTime += step;
            var currentGravity = 0.1 * gravity * gravityTime * gravityTime;
            var vg = currentGravity - prevGravity;
            prevGravity = currentGravity;

            var ball = this.ball;

            // ==== 关闭马格努斯效应（自旋导致的侧向力） ====
            // 保留代码以便后续恢复，但当前不再修改速度
            /*
            if (angularVelocity.lengthSq() > 0.000001 && linearVelocity.lengthSq() > 0.000001) {
                tmpVector.copy(angularVelocity).cross(linearVelocity);
                linearVelocity.add(tmpVector.multiplyScalar(magnusStrength));
                angularVelocity.multiplyScalar(spinDamping);
            }
            */


            // 位置更新
            ball.position.x += linearVelocity.x;
            ball.position.y += linearVelocity.y + vg;
            ball.position.z += linearVelocity.z;

            // 更新球的包围盒
            ballBoundingBox.setFromCenterAndSize(
                ball.position,
                new THREE.Vector3(ballRadius, ballRadius, ballRadius)
            );

            for (var i = 0; i < this.boxes.length; ++i) {
                var boxInfo = this.boxes[i];
                var box = boxInfo.box;

                if (this.isSphereIntersectingBox(box, ball.position, ballRadius)) {
                    this.collideBall(ball, boxInfo, vg);
                }
            }

        },

        /**
         * 重置球的速度（位置在外面决定）
         */
        resetBall: function () {
            linearVelocity.set(0, 0, 0);
            angularVelocity.set(0, 0, 0);
            prevGravity = 0;
            gravityTime = 0;
        },

        /**
         * 标准 AABB–Sphere 相交判断
         * 算法：找到盒子上距离球心最近的点，比较距离平方与半径平方
         */
        isSphereIntersectingBox: function (box, center, radius) {
            var min = box.min;
            var max = box.max;

            // 最近点（clamp）
            var cx = Math.max(min.x, Math.min(center.x, max.x));
            var cy = Math.max(min.y, Math.min(center.y, max.y));
            var cz = Math.max(min.z, Math.min(center.z, max.z));

            var dx = center.x - cx;
            var dy = center.y - cy;
            var dz = center.z - cz;

            return (dx * dx + dy * dy + dz * dz) <= radius * radius;
        },
        /**
         * 处理球与盒子的碰撞响应
         * g: 本帧重力增量（vg），用于修正竖直速度
         */
        collideBall: function (ball, boxInfo, g) {
            // boxInfo = { box: Box3, type: 'default' | 'net' | ... }
            var box = boxInfo.box;
            var type = boxInfo.type || 'default';
            var isNet = (type === 'net');

            var plane = new THREE.Plane();

            function sphereIntersectsPlane(nx, ny, nz, w, sphere, radius) {
                plane.setComponents(nx, ny, nz, w);
                return plane.distanceToPoint(sphere) <= radius;
            }

            // 顶面（桌面）—— 对网我们可以忽略这个（网是竖着的）
            var top = !isNet && sphereIntersectsPlane(0, -1, 0, box.max.y, ball.position, ballRadius);

            // 前 / 后 / 左 / 右 平面
            var front = sphereIntersectsPlane(0, 0, -1, box.max.z, ball.position, ballRadius);        // 正 z 面
            var back  = sphereIntersectsPlane(0, 0,  1, -box.min.z, ball.position, ballRadius);       // 负 z 面
            var left  = sphereIntersectsPlane(1, 0, 0, -box.min.x, ball.position, ballRadius);
            var right = sphereIntersectsPlane(-1, 0, 0, box.max.x, ball.position, ballRadius);

            // ================= 顶面：球落在桌子 / 地面上 =================
            if (top) {
                ball.position.y = box.max.y + ballRadius;


                // 竖直速度反弹 + 抵消重力这一帧的增量
                linearVelocity.y = -restitution * (linearVelocity.y + g);

                // ==== 关闭：自旋向平移速度的传递 ====
                //linearVelocity.x += -angularVelocity.z * contactSpinTransfer;
                //linearVelocity.z += angularVelocity.x * contactSpinTransfer;
                //
                //angularVelocity.x *= bounceSpinDamping;
                //angularVelocity.z *= bounceSpinDamping;


                // 重置重力积分
                gravityTime = 0;
                prevGravity = 0;

                    // ✅ 新增：如果这是“桌面”，通知上层（GameScene）记录触台
    if (type === 'table' && typeof this.onTableHit === 'function') {
        // 传一个 position 拷贝，避免后续被修改
        this.onTableHit(ball.position.clone());
    }
            }

            // ================= 前面：从玩家这侧撞上去 =================
            if (front && !top) {
                // 确保球在盒子前方
                ball.position.z = box.max.z + ballRadius;

                if (isNet) {
                    // ---- 软球网：吃球，轻微反弹 ----
                    // 1) z 方向小反弹
                    linearVelocity.z *= -netRestitution;

                    // 2) 切向速度大幅衰减（x / y）
                    linearVelocity.x *= netTangentialDamping;
                    linearVelocity.y *= netTangentialDamping;

                    // 3) 轻微往下压一点，让球更快掉落
                    linearVelocity.y -= netExtraDownward;

                    // 4) 自旋基本被磨掉（当前关闭） 
                    //angularVelocity.multiplyScalar(netSpinDamping);
                } else {
                    // ---- 普通硬表面：保持原逻辑 ----
                    linearVelocity.z *= -restitution;

                    // ==== 关闭：自旋对平移速度的影响 ====
                    //linearVelocity.x += angularVelocity.y * contactSpinTransfer;
                    //linearVelocity.y += -angularVelocity.x * (contactSpinTransfer * 0.5);
                    //
                    //angularVelocity.y *= bounceSpinDamping;
                    //angularVelocity.x *= bounceSpinDamping;
                }

            }

            // ================= 背面：从对面那头撞上 =================
            if (back && !top && !front) {
                ball.position.z = box.min.z - ballRadius;

                if (isNet) {
                    // 另一侧撞网，逻辑跟 front 基本一样
                    linearVelocity.z *= -netRestitution;

                    linearVelocity.x *= netTangentialDamping;
                    linearVelocity.y *= netTangentialDamping;

                    linearVelocity.y -= netExtraDownward;

                    // 4) 自旋基本被磨掉（当前关闭） 
                    //angularVelocity.multiplyScalar(netSpinDamping);
                } else {
                    linearVelocity.z *= -restitution;
                    
                    // ==== 关闭：自旋对平移速度的影响 ====
                    // linearVelocity.x += -angularVelocity.y * contactSpinTransfer;
                    // linearVelocity.y += -angularVelocity.x * (contactSpinTransfer * 0.5);

                    // angularVelocity.y *= bounceSpinDamping;
                    // angularVelocity.x *= bounceSpinDamping;
                }
            }

            // ================= 左右两侧：很少用到，但留着更健壮 =================
            if (left && !top && !front && !back) {
                ball.position.x = box.min.x - ballRadius;
                linearVelocity.x *= -restitution;
                
                // 关闭自旋
                //angularVelocity.z *= bounceSpinDamping;
            } else if (right && !top && !front && !back) {
                ball.position.x = box.max.x + ballRadius;
                linearVelocity.x *= -restitution;
                
                // 关闭自旋
                //angularVelocity.z *= bounceSpinDamping;
            }

            // 撞得足够有速度就播放音效
            if (linearVelocity.length() > 0.001) {
                PingPong.Audio.playBallSound();
            }
        }

    };

})();
