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

    PingPong.Physics = function () {
        this.ball = null;
        this.boxes = [];
    };

    PingPong.Physics.prototype = {

        addBox: function (box) {
            this.boxes.push(box);
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

            if (options.spin) {
                angularVelocity.copy(options.spin);
            } else {
                angularVelocity.set(0, 0, 0);
            }

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

            // 马格努斯效应：ω × v 方向的力
            if (angularVelocity.lengthSq() > 0.000001 && linearVelocity.lengthSq() > 0.000001) {
                tmpVector.copy(angularVelocity).cross(linearVelocity);
                linearVelocity.add(tmpVector.multiplyScalar(magnusStrength));
                angularVelocity.multiplyScalar(spinDamping);
            }

            // 位置更新
            ball.position.x += linearVelocity.x;
            ball.position.y += linearVelocity.y + vg;
            ball.position.z += linearVelocity.z;

            // 更新球的包围盒
            ballBoundingBox.setFromCenterAndSize(
                ball.position,
                new THREE.Vector3(ballRadius * 2, ballRadius * 2, ballRadius * 2)
            );

            // 与所有 box 进行碰撞检测
            for (var i = 0; i < this.boxes.length; ++i) {
                var box = this.boxes[i];
                if (this.isSphereIntersectingBox(box, ball.position, ballRadius)) {
                    this.collideBall(ball, box, vg);
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
        collideBall: function (ball, box, g) {
            var plane = new THREE.Plane();

            function sphereIntersectsPlane(nx, ny, nz, w, sphere, radius) {
                plane.setComponents(nx, ny, nz, w);
                return plane.distanceToPoint(sphere) <= radius;
            }

            // 顶面（桌面）
            var top = sphereIntersectsPlane(0, -1, 0, box.max.y, ball.position, ballRadius);
            // 前面（正 z 面）
            var front = sphereIntersectsPlane(0, 0, -1, box.max.z, ball.position, ballRadius);
            // 背面（负 z 面）
            var back = sphereIntersectsPlane(0, 0, 1, -box.min.z, ball.position, ballRadius);
            // 左面（负 x）
            var left = sphereIntersectsPlane(1, 0, 0, -box.min.x, ball.position, ballRadius);
            // 右面（正 x）
            var right = sphereIntersectsPlane(-1, 0, 0, box.max.x, ball.position, ballRadius);

            // 顶面：球落到桌面上
            if (top) {
                ball.position.y = box.max.y + ballRadius;

                // 竖直速度反弹 + 抵消重力这一帧的增量
                linearVelocity.y = -restitution * (linearVelocity.y + g);

                // 自旋向水平方向传递
                linearVelocity.x += -angularVelocity.z * contactSpinTransfer;
                linearVelocity.z += angularVelocity.x * contactSpinTransfer;

                angularVelocity.x *= bounceSpinDamping;
                angularVelocity.z *= bounceSpinDamping;

                // 重置重力积分
                gravityTime = 0;
                prevGravity = 0;
            }

            // 前面：从玩家这侧撞上桌子/障碍
            if (front && !top) {
                ball.position.z = box.max.z + ballRadius;
                linearVelocity.z *= -restitution;

                linearVelocity.x += angularVelocity.y * contactSpinTransfer;
                linearVelocity.y += -angularVelocity.x * (contactSpinTransfer * 0.5);

                angularVelocity.y *= bounceSpinDamping;
                angularVelocity.x *= bounceSpinDamping;
            }

            // 背面：从对面那头撞上
            if (back && !top && !front) {
                ball.position.z = box.min.z - ballRadius;
                linearVelocity.z *= -restitution;

                linearVelocity.x += -angularVelocity.y * contactSpinTransfer;
                linearVelocity.y += -angularVelocity.x * (contactSpinTransfer * 0.5);

                angularVelocity.y *= bounceSpinDamping;
                angularVelocity.x *= bounceSpinDamping;
            }

            // 左右两侧：很少用到，但加上更健壮
            if (left && !top && !front && !back) {
                ball.position.x = box.min.x - ballRadius;
                linearVelocity.x *= -restitution;

                angularVelocity.z *= bounceSpinDamping;
            } else if (right && !top && !front && !back) {
                ball.position.x = box.max.x + ballRadius;
                linearVelocity.x *= -restitution;

                angularVelocity.z *= bounceSpinDamping;
            }

            // 撞得足够有速度就播放音效
            if (linearVelocity.length() > 0.001) {
                PingPong.Audio.playBallSound();
            }
        }
    };

})();
