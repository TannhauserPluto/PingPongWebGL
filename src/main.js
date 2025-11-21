'use strict';

(function(){
    
    var renderer;
    var gameScene;
    
    var requestAnimationFrame = window.webkitRequestAnimationFrame ||
		window.mozRequestAnimationFrame ||
		window.oRequestAnimationFrame ||
		window.msRequestAnimationFrame ||
        function(callback) {
			window.setTimeout( callback, 1000 / 60 );
		};
    
    
    function createSettings() {
        
        //size in meters
        var width = 10;
        var depth = 20;
        var height = 5;
        var tableWidth = 1.5;

        var quality = 0;
        
        var settings = {
            width: width,
            height: height,
            depth: depth,
            planes: [
                {texture:"images/floor4.jpg", size:[width,depth], repeat:[6,6], rotation:[-Math.PI/2,0, 0]}, //floor
                {texture:"images/wall.jpg" , size:[width,height], position:[0, height/2, -depth/2]}, //front wall
                {texture:"images/wall.jpg" , size:[width,height], rotation:[0, Math.PI,0], position:[0, height/2, depth/2]}, //back wall
                {texture:"images/wall.jpg" , size:[depth,height], scale:[-1,1,1],rotation:[0, Math.PI/2, 0], position:[-width/2, height/2, 0]}, //left wall
                {texture:"images/wall.jpg" , size:[depth,height], scale:[-1,1,1], rotation:[0, -Math.PI/2, 0], position:[width/2, height/2, 0]} //right wall
            ],
            table: {
                model: "models/table.js",
                width: tableWidth,
                color: 0x2b476e,
                texture: "images/table.jpg"
            },
            
            paddle: {
                model: "models/paddle.js",
            },
            
            audio: {
                ball: ["audio/ball1.ogg", "audio/ball2.ogg"],
                paddle: ["audio/paddle1.ogg", "audio/paddle2.ogg"]
            }
        };
        
        return settings;
    }
    
    function init(){

        // Prevent running from file:// because asset loading via XHR will fail
        if (window.location.protocol === 'file:') {
            var message = 'Please run the game from a local web server instead of opening index.html directly (assets are loaded via XHR).';
            console.error(message);

            var warning = document.createElement('div');
            warning.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px;background:#b71c1c;color:#fff;font-family:sans-serif;font-size:14px;z-index:9999;';
            warning.textContent = message;
            document.body.appendChild(warning);
            return;
        }

        var canvas = document.createElement("canvas");
        canvas.screencanvas = true; //for cocoonjs
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas});
        renderer.setClearColor(0x000000);
        renderer.setSize(canvas.width, canvas.height);
        document.getElementById( 'container' ).appendChild( renderer.domElement );
        
        gameScene = new PingPong.GameScene(renderer, createSettings());
        
        requestAnimationFrame( render );
    }
    
    function render(){     
        gameScene.render();
        requestAnimationFrame(render);
    }
    
    window.onload = init;

})();
