/* 
 * PingPongWebGL is licensed under MIT licensed. See LICENSE.md file for more information.
 * Copyright (c) 2014 Imanol Fernandez @MortimerGoro
*/

'use strict';

(function () {

    window.PingPong = window.PingPong || {};

    var targetPos = new THREE.Vector3(0, 0, 0);

    PingPong.AI = function (simulation, tableSize, paddle, paddleSize, ball, ballRadius, game) {
        this.simulation = simulation;
        this.tableSize = tableSize;
        this.paddle = paddle;
        this.paddleSize = paddleSize;
        this.ball = ball;
        this.ballRadius = ballRadius;
        this.speed = 1.0;
        this.force = 0.5;

        // 新增：保存 GameScene 引用，方便设置 currentHitter 等
        this.game = game;
    };


    PingPong.AI.prototype = {

        setSpeed: function (speed) {
            this.speed = speed;
        },

        setForce: function (force) {
            this.force = force;
        },

        play: function () {

            var myPos = this.paddle.position;
            var ballPos = this.ball.position;
            var paddleSize = this.paddleSize;
            var tableSize = this.tableSize;

            var vel = this.simulation.getLinearVelocity();

            // ==== 球飞离 AI：回到中路 ====
            if (vel.z > 0) {
                targetPos.set(0, tableSize.height, -tableSize.depth * 0.5);
            }
            // ==== 球飞向 AI：追球 ====
            else {
                // 原版这里 targetPos.y 恒定为 tableSize.height，现在改成追球高度
                targetPos.set(
                    ballPos.x,
                    ballPos.y,   // 核心改动：直接追球高度
                    -tableSize.depth * 0.5
                );

                var zDistance = Math.abs(myPos.z - ballPos.z);
                var xDistance = Math.abs(myPos.x - ballPos.x);
                var yDistance = myPos.y - ballPos.y;

                // === 判定窗口适当放宽（解决视觉上打到却不算的问题） ===

                var hit = (
                    zDistance < tableSize.depth * 0.08 &&              // 0.05 → 0.08
                    xDistance < paddleSize.width * 1.1 &&              // 放宽 X 范围
                    Math.abs(yDistance) < paddleSize.height * 0.95     // 0.75 → 0.95
                );

                var hitting = (
                    zDistance < tableSize.depth * 0.22 &&              // 0.2 → 0.22
                    xDistance < paddleSize.width * 1.2
                );

                if (hit) {

                    // AI开始击球时加入
                    this.game.currentHitter = "ai";
                    this.game.touchedPlayerTable = false;
                    this.game.touchedAiTable = false;

                    // 后面的计算和 hitBall()

                    // ===== 物理参数 =====
                    const g = -4.8;                   // physics.js 的重力
                    const dt = 1 / 60;                // 每帧时间
                    const N = 40;                     // 飞行帧数（可调）
                    const H = tableSize.height;

                    // ===== 当前球位置 =====
                    const x0 = ballPos.x;
                    const y0 = ballPos.y;
                    const z0 = ballPos.z;

                    // ===== 目标落点（玩家半台）=====
                    const tableDepth = tableSize.depth;

                    const zTarget = tableDepth * 0.25 + tableDepth * 0.1 * Math.random();
                    const xTarget = (Math.random() - 0.5) * tableSize.width * 0.6;

                    // 取比桌面碰撞高度稍高的值（≈0.8465H + 0.02H）
                    const yTarget = H * 0.88;

                    // ===== 1. 求 vx, vz =====
                    const vx = (xTarget - x0) / N;
                    const vz = (zTarget - z0) / N;

                    // vz 必须 > 0 才是“打向玩家”
                    if (vz <= 0) {
                        // 保底方案：让方向绝对朝 +z
                        const safeDir = new THREE.Vector3(0, 0.2, 1).normalize();
                        this.simulation.hitBall(safeDir, 0.03);
                        return;
                    }

                    // ===== 2. 求 vy（考虑重力）=====
                    const gravityDrop = 0.1 * g * (N * dt) * (N * dt);

                    let vy = (yTarget - y0 - gravityDrop) / N;

                    // ===== 3. 检查是否会挂网 =====
                    // 网顶 = 1.0H，安全高度 2% H
                    const netTop = H * 1.0;
                    const netSafe = H * 0.02;

                    // 球经过 z=0 时的帧数
                    let nNet = (0 - z0) / vz;

                    // 限制 nNet 范围，避免奇怪情况
                    if (nNet < 1) nNet = 1;
                    if (nNet > N - 1) nNet = N - 1;

                    const tNet = nNet * dt;
                    const yNet = y0 + vy * nNet + 0.1 * g * tNet * tNet;

                    if (yNet < netTop + netSafe) {
                        const delta = (netTop + netSafe) - yNet;
                        const correction = delta / nNet;
                        vy += correction;
                    }

                    // ===== 4. 合成速度向量 → dir + force =====
                    const v = new THREE.Vector3(vx, vy, vz);
                    const force = v.length();
                    const dir = v.clone().normalize();

                    this.simulation.hitBall(dir, force);
                }



            }

            // ==========================
            //    改进后的移动控制
            // ==========================

            // ---- X 移动（原版保留） ----
            var diffX = targetPos.x - myPos.x;
            var speedX = tableSize.width * 0.05 * this.speed;
            myPos.x += THREE.Math.clamp(diffX, -speedX, speedX);

            // ---- Y 移动（重新启用并修正方向） ----
            var diffY = targetPos.y - myPos.y;
            var speedY = tableSize.height * 0.05 * this.speed;
            myPos.y += THREE.Math.clamp(diffY, -speedY, speedY);

            // ---- 最后安全边界（不飞太高、不掉台） ----
            var minY = tableSize.height * 0.8;
            var maxY = tableSize.height * 1.4;
            myPos.y = THREE.Math.clamp(myPos.y, minY, maxY);
        }

    };

})();
