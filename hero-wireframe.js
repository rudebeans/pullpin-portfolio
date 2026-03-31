/* ============================================================
   HERO WIREFRAME — PullPin Logo
   Canvas 2D renderer — no WebGL required.
   Loads GLB (3-primitive merged mesh) via GLTFLoader,
   extracts clean structural edges, draws with perspective
   depth-cued glow lines on an auto-rotating 3D object.

   Features:
   - Cyberpunk colour-cycling wireframe with additive bloom
   - Turntable drag with inertia
   - Particle sparks on spin/drag
   - Proximity-based GRAB cursor (tight to actual model bounds)
   ============================================================ */

window.PullPinWireframe = (function () {
  'use strict';

  var canvas, ctx, animId;
  var isActive    = false;
  var initialized = false;
  var mountId     = null;

  /* ---- rotation / parallax state ---- */
  var rotY  = 0.6;
  var rotX  = -0.08;
  var rotZ  = 0;
  var mouseX = 0, mouseY = 0;
  var tiltX  = 0, tiltZ  = 0;

  /* ---- turntable drag ---- */
  var AUTO_SPIN   = 0.0016;
  var spinVel     = AUTO_SPIN;
  var isDragging  = false;
  var lastDragX   = 0;

  /* ---- bloom / glow ---- */
  var bloomIntensity = 0;

  /* ---- colour (shared between draw + particle spawn) ---- */
  var currentHue = 0;

  /* ---- model geometry ---- */
  var edges      = [];
  var modelReady = false;

  /* ---- last frame's projected paths (for particle origin sampling) ---- */
  var lastPaths = [];

  /* ---- cursor proximity ---- */
  var cursorEl        = null;
  var cursorLabelEl   = null;
  var isNearModel     = false;
  var proximityActive = false;   /* only true while slide 0 is on screen */

  /* ============================================================
     PERSPECTIVE CAMERA
     ============================================================ */
  var CAMERA_Z = 2.2;

  /* ============================================================
     3-D MATH — pure JS
     ============================================================ */
  function rotY3(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [p[0]*c + p[2]*s, p[1], -p[0]*s + p[2]*c];
  }
  function rotX3(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [p[0], p[1]*c - p[2]*s, p[1]*s + p[2]*c];
  }
  function rotZ3(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [p[0]*c - p[1]*s, p[0]*s + p[1]*c, p[2]];
  }
  function project(p, focal, cx, cy) {
    var dist  = Math.max(CAMERA_Z - p[2], 0.001);
    var scale = focal / dist;
    return [p[0]*scale + cx, -p[1]*scale + cy, scale];
  }

  /* ============================================================
     PARTICLE SYSTEM
     Sparks burst from projected edge points during spin/drag.
     Uses 'lighter' (additive) blending for neon glow effect.
     ============================================================ */
  var particles  = [];
  var MAX_PARTS  = 140;

  function spawnParticles(cx, cy, count) {
    var hue = currentHue;

    for (var i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTS) break;

      /* Sample a random point along a projected edge from the last frame.
         Walk through non-empty buckets to find a valid segment. */
      var sx, sy;
      var placed = false;

      if (lastPaths.length > 0) {
        for (var attempt = 0; attempt < 8; attempt++) {
          var bIdx = Math.floor(Math.random() * lastPaths.length);
          var bp   = lastPaths[bIdx];
          if (!bp || bp.length < 4) continue;

          /* Pick a random segment from this bucket */
          var segCount = Math.floor(bp.length / 4);
          var seg      = Math.floor(Math.random() * segCount) * 4;
          var t        = Math.random();
          sx = bp[seg]     + (bp[seg + 2] - bp[seg])     * t;
          sy = bp[seg + 1] + (bp[seg + 3] - bp[seg + 1]) * t;
          placed = true;
          break;
        }
      }

      /* Fallback: random point within approximate model radius */
      if (!placed) {
        var ang  = Math.random() * Math.PI * 2;
        var rad  = Math.random() * cy * 0.4;
        sx = cx + Math.cos(ang) * rad;
        sy = cy + Math.sin(ang) * rad;
      }

      /* Velocity: outward from model centre + random spread */
      var dx    = sx - cx;
      var dy    = sy - cy;
      var dist  = Math.sqrt(dx * dx + dy * dy) || 1;
      var speed = 0.8 + Math.random() * 2.4;

      particles.push({
        x:     sx,
        y:     sy,
        vx:    (dx / dist) * speed + (Math.random() - 0.5) * 1.8,
        vy:    (dy / dist) * speed + (Math.random() - 0.5) * 1.8 - 0.3,
        life:  1.0,
        decay: 0.018 + Math.random() * 0.022,
        size:  0.7 + Math.random() * 2.0,
        hue:   (hue + (Math.random() - 0.5) * 30 + 360) % 360
      });
    }
  }

  function drawParticles() {
    if (particles.length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];

      /* Physics */
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.045;   /* gravity */
      p.vx *= 0.968;
      p.vy *= 0.968;
      p.life -= p.decay;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      /* Ease-out alpha so sparks fade gracefully */
      var alpha = p.life * p.life;
      var r     = p.size * Math.max(0.2, p.life);

      ctx.globalAlpha   = alpha * 0.9;
      ctx.shadowBlur    = 8;
      ctx.shadowColor   = 'hsl(' + Math.round(p.hue) + ',100%,70%)';
      ctx.fillStyle     = 'hsl(' + Math.round(p.hue) + ',100%,78%)';

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /* ============================================================
     GLB LOAD — Three.js GLTFLoader
     ============================================================ */
  function loadModel() {
    if (!window.THREE || !THREE.GLTFLoader) {
      console.warn('PullPin Wireframe: THREE or GLTFLoader not found');
      return;
    }

    var loader = new THREE.GLTFLoader();
    loader.load(
      'media/pullpin-logo-v2.glb',

      function (gltf) {
        var raw     = [];
        var partIdx = 0;
        var minX =  Infinity, maxX = -Infinity;
        var minY =  Infinity, maxY = -Infinity;
        var minZ =  Infinity, maxZ = -Infinity;

        gltf.scene.traverse(function (child) {
          if (!child.isMesh) return;

          var part = partIdx++;
          child.updateWorldMatrix(true, false);
          var e = child.matrixWorld.elements;

          var threshold = (part === 1) ? 1 : 15;
          var edgeGeo   = new THREE.EdgesGeometry(child.geometry, threshold);
          var pos       = edgeGeo.attributes.position;

          for (var i = 0; i < pos.count; i += 2) {
            var ax = pos.getX(i),   ay = pos.getY(i),   az = pos.getZ(i);
            var bx = pos.getX(i+1), by = pos.getY(i+1), bz = pos.getZ(i+1);

            var wa = [
              e[0]*ax + e[4]*ay + e[8]*az  + e[12],
              e[1]*ax + e[5]*ay + e[9]*az  + e[13],
              e[2]*ax + e[6]*ay + e[10]*az + e[14]
            ];
            var wb = [
              e[0]*bx + e[4]*by + e[8]*bz  + e[12],
              e[1]*bx + e[5]*by + e[9]*bz  + e[13],
              e[2]*bx + e[6]*by + e[10]*bz + e[14]
            ];

            raw.push({ a: wa, b: wb, part: part });

            minX = Math.min(minX, wa[0], wb[0]);
            maxX = Math.max(maxX, wa[0], wb[0]);
            minY = Math.min(minY, wa[1], wb[1]);
            maxY = Math.max(maxY, wa[1], wb[1]);
            minZ = Math.min(minZ, wa[2], wb[2]);
            maxZ = Math.max(maxZ, wa[2], wb[2]);
          }
        });

        if (raw.length === 0) {
          console.warn('PullPin Wireframe: no edges extracted');
          return;
        }

        var cX   = (minX + maxX) * 0.5;
        var cY   = (minY + maxY) * 0.5;
        var cZ   = (minZ + maxZ) * 0.5;
        var span = Math.max(maxY - minY, maxX - minX, 0.001);
        var isMobile = window.innerWidth <= 900;
        var sc   = (isMobile ? 2.415 : 2.898) / span;

        edges = raw.map(function (ed) {
          return {
            a:    [(ed.a[0]-cX)*sc, (ed.a[1]-cY)*sc, (ed.a[2]-cZ)*sc],
            b:    [(ed.b[0]-cX)*sc, (ed.b[1]-cY)*sc, (ed.b[2]-cZ)*sc],
            part: ed.part
          };
        });

        modelReady = true;
        console.log('PullPin Wireframe: ready —', edges.length, 'edges,', partIdx, 'parts');
      },

      undefined,

      function (err) { console.error('PullPin Wireframe: GLB load error', err); }
    );
  }

  /* ============================================================
     CANVAS 2-D DRAW
     ============================================================ */
  function draw() {
    if (!ctx || !modelReady) return;

    var W  = canvas.width;
    var H  = canvas.height;
    var mob = window.innerWidth <= 900;
    var cx = mob ? W * 0.50 : W * 0.66 - 50;
    var cy = mob ? H * 0.36 : H * 0.54;
    var focal = H * 0.50;

    ctx.clearRect(0, 0, W, H);

    /* --- Transform + bucket edges by depth --- */
    var BUCKETS  = 6;
    var maxScale = focal / Math.max(CAMERA_Z - 0.9, 0.001);
    var paths    = [];
    for (var b = 0; b < BUCKETS; b++) paths.push([]);

    for (var i = 0; i < edges.length; i++) {
      var ed = edges[i];
      var a  = rotY3(ed.a, rotY);  a  = rotX3(a,  rotX);  a  = rotZ3(a,  rotZ);
      var bv = rotY3(ed.b, rotY);  bv = rotX3(bv, rotX);  bv = rotZ3(bv, rotZ);

      var pa = project(a,  focal, cx, cy);
      var pb = project(bv, focal, cx, cy);

      if (pa[2] <= 0 || pb[2] <= 0) continue;

      var depth  = (pa[2] + pb[2]) * 0.5;
      var bucket = Math.min(BUCKETS - 1, Math.floor((depth / maxScale) * BUCKETS));
      paths[bucket].push(pa[0], pa[1], pb[0], pb[1]);
    }

    /* Save paths for particle spawn sampling next tick */
    lastPaths = paths;

    var bi  = bloomIntensity;
    var hue = ((rotY * 45) % 360 + 360) % 360;
    currentHue = hue;   /* expose for particles */

    var sat = Math.round(bi * 100);
    var lit = Math.round(85 - bi * 22);
    var lineColor = 'hsla(' + Math.round(hue) + ',' + sat + '%,' + lit + '%,';
    var glowColor = 'hsla(' + Math.round(hue) + ',100%,70%,';

    /* --- Back-to-front stroke passes --- */
    for (var b = 0; b < BUCKETS; b++) {
      if (paths[b].length === 0) continue;

      var t     = b / (BUCKETS - 1);
      var alpha = 0.06 + t * 0.84;

      var baseBlur  = (b === BUCKETS - 1) ? 9 : (b === BUCKETS - 2) ? 4 : 0;
      var extraBlur = bi * 18;
      if (baseBlur + extraBlur > 0) {
        ctx.shadowBlur  = baseBlur + extraBlur;
        ctx.shadowColor = glowColor + (alpha * (0.55 + bi * 0.4)).toFixed(2) + ')';
      } else {
        ctx.shadowBlur  = 0;
        ctx.shadowColor = 'transparent';
      }

      ctx.strokeStyle = lineColor + alpha.toFixed(3) + ')';
      ctx.lineWidth   = 0.9 + t * 0.6 + bi * 0.4;
      ctx.beginPath();
      var pts = paths[b];
      for (var k = 0; k < pts.length; k += 4) {
        ctx.moveTo(pts[k],   pts[k+1]);
        ctx.lineTo(pts[k+2], pts[k+3]);
      }
      ctx.stroke();
    }

    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';

    /* ============================================================
       BLOOM PASSES — additive layered glow
       ============================================================ */
    if (bi > 0.03) {

      /* Pass 1: wide soft halo */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter      = 'blur(' + Math.round(5 + bi * 20) + 'px)';
      ctx.globalAlpha = bi * 0.38;
      ctx.strokeStyle = glowColor + '1)';
      ctx.lineWidth   = 1.0 + bi * 0.8;
      ctx.beginPath();
      for (var bb = Math.max(0, BUCKETS - 3); bb < BUCKETS; bb++) {
        var bpts = paths[bb];
        for (var bk = 0; bk < bpts.length; bk += 4) {
          ctx.moveTo(bpts[bk], bpts[bk+1]);
          ctx.lineTo(bpts[bk+2], bpts[bk+3]);
        }
      }
      ctx.stroke();
      ctx.restore();

      /* Pass 2: tight bright core (bloom > 0.25) */
      if (bi > 0.25) {
        var t2 = (bi - 0.25) / 0.75;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter      = 'blur(' + Math.round(1 + t2 * 5) + 'px)';
        ctx.globalAlpha = t2 * 0.65;
        ctx.strokeStyle = 'hsla(' + Math.round(hue) + ',80%,' + Math.round(88 - t2 * 15) + '%,1)';
        ctx.lineWidth   = 1.3 + t2 * 0.5;
        ctx.beginPath();
        var fp = paths[BUCKETS - 1];
        for (var fk = 0; fk < fp.length; fk += 4) {
          ctx.moveTo(fp[fk], fp[fk+1]);
          ctx.lineTo(fp[fk+2], fp[fk+3]);
        }
        ctx.stroke();
        ctx.restore();
      }

      /* Pass 3: central flare (bloom > 0.55) */
      if (bi > 0.55) {
        var t3 = (bi - 0.55) / 0.45;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = 'none';
        var flareR = H * 0.22 * t3;
        var fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, flareR);
        fg.addColorStop(0,    glowColor + (t3 * 0.22).toFixed(3) + ')');
        fg.addColorStop(0.35, glowColor + (t3 * 0.10).toFixed(3) + ')');
        fg.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    /* ---- Draw particles (always on top, additive) ---- */
    drawParticles();
  }

  /* ============================================================
     ANIMATION LOOP
     ============================================================ */
  function animate() {
    if (!isActive) return;
    animId = requestAnimationFrame(animate);

    if (!isDragging) {
      spinVel = spinVel * 0.94 + AUTO_SPIN * 0.06;
      rotY   += spinVel;
    }

    var targetBloom = Math.min(1.0, Math.max(0, (Math.abs(spinVel) - AUTO_SPIN) / 0.010));
    bloomIntensity  = bloomIntensity * 0.91 + targetBloom * 0.09;

    tiltX += ( mouseY * 0.55  - tiltX) * 0.07;
    tiltZ += (-mouseX * 0.35  - tiltZ) * 0.07;
    rotX   = -0.08 + tiltX;
    rotZ   =  tiltZ;

    draw();

    /* ---- Spawn particles when spinning fast enough ----
       Threshold slightly above idle so natural drift = no sparks.
       Fires during drag AND during inertia wind-down.           */
    var SPARK_THRESHOLD = AUTO_SPIN * 2.2;
    if (Math.abs(spinVel) > SPARK_THRESHOLD && modelReady) {
      var W  = canvas.width;
      var H  = canvas.height;
      var mob = window.innerWidth <= 900;
      var cx = mob ? W * 0.50 : W * 0.66 - 50;
      var cy = mob ? H * 0.36 : H * 0.54;
      var excess = Math.abs(spinVel) - SPARK_THRESHOLD;
      var count  = Math.min(7, Math.ceil(excess * 280));
      spawnParticles(cx, cy, count);
    }
  }

  /* ============================================================
     PROXIMITY CURSOR
     Only trigger GRAB label when mouse is within the model's
     approximate on-screen footprint (radius = 30% of canvas H).
     ============================================================ */
  function clearProximityCursor() {
    if (isNearModel) {
      isNearModel = false;
      if (cursorEl)      cursorEl.classList.remove('cursor--hover');
      if (cursorLabelEl) cursorLabelEl.textContent = '';
    }
  }

  function updateProximityCursor(clientX, clientY) {
    if (!proximityActive || !canvas || !cursorEl || !cursorLabelEl) return;

    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width  / (rect.width  || 1);
    var scaleY = canvas.height / (rect.height || 1);

    /* Mouse position in canvas pixel space */
    var mcx = (clientX - rect.left) * scaleX;
    var mcy = (clientY - rect.top)  * scaleY;

    /* Model screen centre */
    var W   = canvas.width;
    var H   = canvas.height;
    var modX = W * 0.66 - 50;
    var modY = H * 0.54;

    /* Grab radius: slightly tighter than the model's visual footprint */
    var grabR = H * 0.30;

    var dx   = mcx - modX;
    var dy   = mcy - modY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < grabR) {
      if (!isNearModel) {
        isNearModel = true;
        cursorEl.classList.add('cursor--hover');
        cursorLabelEl.textContent = 'Grab';
      }
    } else {
      if (isNearModel && !isDragging) {
        isNearModel = false;
        cursorEl.classList.remove('cursor--hover');
        cursorLabelEl.textContent = '';
      }
    }
  }

  /* ============================================================
     CANVAS SIZING — single source of truth
     Uses getBoundingClientRect for accuracy during layout flux.
     ============================================================ */
  function syncCanvasSize() {
    if (!canvas) return;
    var hero = document.getElementById('hero');
    var rect = hero ? hero.getBoundingClientRect() : null;
    var W = (rect && rect.width  > 1) ? Math.round(rect.width)  : window.innerWidth;
    var H = (rect && rect.height > 1) ? Math.round(rect.height) : window.innerHeight;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width  = W;
      canvas.height = H;
    }
  }

  /* ============================================================
     INIT
     ============================================================ */
  function doInit() {
    var mount = document.getElementById(mountId);
    if (!mount) {
      console.warn('PullPin Wireframe: mount #' + mountId + ' not found');
      return false;
    }

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    mount.appendChild(canvas);

    /* Size canvas accurately — defer one rAF so layout is settled */
    syncCanvasSize();
    requestAnimationFrame(syncCanvasSize);

    /* Belt-and-suspenders: catch late reflows (fonts, images settling) */
    setTimeout(syncCanvasSize, 150);
    setTimeout(syncCanvasSize, 600);

    ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('PullPin Wireframe: cannot get 2D context');
      return false;
    }

    /* Grab cursor DOM refs */
    cursorEl      = document.getElementById('cursor');
    cursorLabelEl = document.getElementById('cursorLabel');

    /* ---- Mouse down: begin drag ---- */
    canvas.addEventListener('mousedown', function (e) {
      isDragging = true;
      lastDragX  = e.clientX;
      spinVel    = 0;
      if (window.heroCarousel) window.heroCarousel.pause();
      /* Ensure hover state stays active during drag */
      if (cursorEl)      cursorEl.classList.add('cursor--hover');
      if (cursorLabelEl) cursorLabelEl.textContent = 'Grab';
      e.preventDefault();
    });

    /* ---- Mouse up: end drag ---- */
    document.addEventListener('mouseup', function () {
      if (!isDragging) return;
      isDragging  = false;
      isNearModel = false;
      if (cursorEl)      cursorEl.classList.remove('cursor--hover');
      if (cursorLabelEl) cursorLabelEl.textContent = '';
      if (window.heroCarousel) window.heroCarousel.resume();
    });

    /* ---- Mouse move: parallax + drag + proximity cursor ---- */
    document.addEventListener('mousemove', function (e) {
      mouseX = (e.clientX / window.innerWidth  - 0.5);
      mouseY = (e.clientY / window.innerHeight - 0.5);

      if (isDragging) {
        var dx    = e.clientX - lastDragX;
        spinVel   = dx * 0.005;
        rotY     += spinVel;
        lastDragX = e.clientX;
      } else {
        updateProximityCursor(e.clientX, e.clientY);
      }
    }, { passive: true });

    /* ---- Mouse leaves canvas: clear cursor ---- */
    canvas.addEventListener('mouseleave', function () {
      if (!isDragging && isNearModel) {
        isNearModel = false;
        if (cursorEl)      cursorEl.classList.remove('cursor--hover');
        if (cursorLabelEl) cursorLabelEl.textContent = '';
      }
    });

    /* ---- Resize: window event + ResizeObserver on hero ---- */
    window.addEventListener('resize', syncCanvasSize);

    var hero = document.getElementById('hero');
    if (hero && window.ResizeObserver) {
      new ResizeObserver(syncCanvasSize).observe(hero);
    }

    loadModel();
    return true;
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  return {
    init: function (id) { mountId = id; },

    play: function () {
      if (!initialized) {
        initialized = doInit();
        if (!initialized) return;
      }
      proximityActive = true;   /* re-arm GRAB cursor */
      if (!isActive) {
        isActive = true;
        animate();
      }
    },

    pause: function () {
      isActive        = false;
      proximityActive = false;  /* disarm GRAB cursor while slide is off-screen */
      isDragging      = false;  /* safety: drop any in-flight drag state */
      cancelAnimationFrame(animId);
      clearProximityCursor();   /* immediately clear any visible GRAB label */
    }
  };

})();
