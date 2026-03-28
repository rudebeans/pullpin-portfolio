/* ============================================================
   HERO WIREFRAME — PullPin Logo
   Canvas 2D renderer — no WebGL required.
   Loads GLB (3-primitive merged mesh) via GLTFLoader,
   extracts clean structural edges, draws with perspective
   depth-cued glow lines on an auto-rotating 3D object.
   ============================================================ */

window.PullPinWireframe = (function () {
  'use strict';

  var canvas, ctx, animId;
  var isActive    = false;
  var initialized = false;
  var mountId     = null;

  /* ---- rotation / parallax state ---- */
  var rotY  = 0.6;         /* start at slight angle to show depth immediately */
  var rotX  = -0.08;       /* gentle top-down tilt */
  var rotZ  = 0;
  var mouseX = 0, mouseY = 0;
  var tiltX  = 0, tiltZ  = 0;

  /* ---- turntable drag ---- */
  var AUTO_SPIN   = 0.0016;   /* idle auto-rotate speed (rad/frame)   */
  var spinVel     = AUTO_SPIN; /* current Y spin velocity              */
  var isDragging  = false;
  var lastDragX   = 0;

  /* ---- model geometry ---- */
  /* edges: array of { a:[x,y,z], b:[x,y,z], part:0|1|2 }  */
  var edges      = [];
  var modelReady = false;

  /* ============================================================
     PERSPECTIVE CAMERA
     CAMERA_Z in model-space units; model sits at Z ≈ 0
     FOCAL in pixels — set dynamically in draw() from canvas H
     ============================================================ */
  var CAMERA_Z = 2.2;   /* slightly further back — less perspective warp at top */

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
     GLB LOAD — Three.js GLTFLoader (JS-only, no GPU needed)
     Handles multi-primitive meshes. Edge threshold 10° gives
     clean silhouettes on a proper topology mesh.
     ============================================================ */
  function loadModel() {
    if (!window.THREE || !THREE.GLTFLoader) {
      console.warn('PullPin Wireframe: THREE or GLTFLoader not found');
      return;
    }

    var loader = new THREE.GLTFLoader();
    loader.load(
      'media/pullpin-logo.glb',

      /* onLoad */
      function (gltf) {
        var raw    = [];          /* { a, b, part } */
        var partIdx = 0;

        /* Bounds tracking for centring + normalising */
        var minX =  Infinity, maxX = -Infinity;
        var minY =  Infinity, maxY = -Infinity;
        var minZ =  Infinity, maxZ = -Infinity;

        gltf.scene.traverse(function (child) {
          if (!child.isMesh) return;

          var part = partIdx++;

          /* Accumulate full parent chain transforms */
          child.updateWorldMatrix(true, false);
          var e = child.matrixWorld.elements;

          /* ---- Per-part edge thresholds ----
             Part 0 = grenade body  → 15° keeps feature creases, hides micro-tri
             Part 1 = lightbulb globe (smooth sphere) → 1° reveals lat/lng grid
             Part 2 = neck/connector → 15° clean structural lines only          */
          var threshold = (part === 1) ? 1 : 15;
          var edgeGeo   = new THREE.EdgesGeometry(child.geometry, threshold);
          var pos     = edgeGeo.attributes.position;

          for (var i = 0; i < pos.count; i += 2) {
            var ax = pos.getX(i),   ay = pos.getY(i),   az = pos.getZ(i);
            var bx = pos.getX(i+1), by = pos.getY(i+1), bz = pos.getZ(i+1);

            /* World-space transform (scale + translate in node) */
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

        /* ---- Centre on X, Y, Z and normalise to ~2.6 units tall ---- */
        var cX   = (minX + maxX) * 0.5;
        var cY   = (minY + maxY) * 0.5;
        var cZ   = (minZ + maxZ) * 0.5;
        var span = Math.max(maxY - minY, maxX - minX, 0.001);
        var sc   = 2.415 / span;  /* 2.1 × 1.15 — 15% larger */

        edges = raw.map(function (ed) {
          return {
            a:    [(ed.a[0]-cX)*sc, (ed.a[1]-cY)*sc, (ed.a[2]-cZ)*sc],
            b:    [(ed.b[0]-cX)*sc, (ed.b[1]-cY)*sc, (ed.b[2]-cZ)*sc],
            part: ed.part
          };
        });

        modelReady = true;
        console.log('PullPin Wireframe: ready —', edges.length, 'edges across', partIdx, 'parts');
      },

      /* onProgress */ undefined,

      /* onError */
      function (err) { console.error('PullPin Wireframe: GLB load error', err); }
    );
  }

  /* ============================================================
     CANVAS 2-D DRAW
     Depth-bucketed strokes + per-bucket glow for a premium
     "floating hologram" look.
     ============================================================ */
  function draw() {
    if (!ctx || !modelReady) return;

    var W     = canvas.width;
    var H     = canvas.height;
    var cx    = W * 0.66 - 50;   /* 50 px toward centre */
    var cy    = H * 0.54;        /* shifted down — grenade top has headroom  */
    var focal = H * 0.50;

    /* Transparent canvas — background image shows through from behind */
    ctx.clearRect(0, 0, W, H);

    /* --- Transform all edges, bucket by depth --- */
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

      /* Cull edges completely behind camera */
      if (pa[2] <= 0 || pb[2] <= 0) continue;

      var depth  = (pa[2] + pb[2]) * 0.5;
      var bucket = Math.min(BUCKETS - 1, Math.floor((depth / maxScale) * BUCKETS));
      paths[bucket].push(pa[0], pa[1], pb[0], pb[1]);
    }

    /* --- Draw from back to front, each bucket one stroke() call --- */
    for (var b = 0; b < BUCKETS; b++) {
      if (paths[b].length === 0) continue;

      /* Opacity: back edges near-invisible, front edges crisp */
      var t     = b / (BUCKETS - 1);
      var alpha = 0.06 + t * 0.84;       /* 0.06 … 0.90 */

      /* Glow only on the two nearest buckets */
      if (b >= BUCKETS - 2) {
        ctx.shadowBlur  = (b === BUCKETS - 1) ? 9 : 4;
        ctx.shadowColor = 'rgba(255,255,255,' + (alpha * 0.55).toFixed(2) + ')';
      } else {
        ctx.shadowBlur  = 0;
        ctx.shadowColor = 'transparent';
      }

      ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
      ctx.lineWidth   = 0.9 + t * 0.6;  /* thin far, slightly thicker near */
      ctx.beginPath();
      var pts = paths[b];
      for (var k = 0; k < pts.length; k += 4) {
        ctx.moveTo(pts[k],   pts[k+1]);
        ctx.lineTo(pts[k+2], pts[k+3]);
      }
      ctx.stroke();
    }

    /* Reset shadow so it doesn't bleed into anything else */
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
  }

  /* ============================================================
     ANIMATION LOOP
     ============================================================ */
  function animate() {
    if (!isActive) return;
    animId = requestAnimationFrame(animate);

    /* Turntable: inertia decay → blends back to auto-spin when released */
    if (!isDragging) {
      spinVel = spinVel * 0.94 + AUTO_SPIN * 0.06;
      rotY   += spinVel;
    }

    tiltX += ( mouseY * 0.55  - tiltX) * 0.07;
    tiltZ += (-mouseX * 0.35  - tiltZ) * 0.07;
    rotX   = -0.08 + tiltX;
    rotZ   =  tiltZ;

    draw();
  }

  /* ============================================================
     INIT
     Canvas 2-D is synchronous — no GPU / RAF dance needed.
     ============================================================ */
  function doInit() {
    var mount = document.getElementById(mountId);
    if (!mount) { console.warn('PullPin Wireframe: mount #' + mountId + ' not found'); return false; }

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;';
    mount.appendChild(canvas);

    var hero = document.getElementById('hero');
    var W = (hero && hero.offsetWidth  > 0) ? hero.offsetWidth  : window.innerWidth;
    var H = (hero && hero.offsetHeight > 0) ? hero.offsetHeight : window.innerHeight;
    canvas.width  = W;
    canvas.height = H;

    ctx = canvas.getContext('2d');
    if (!ctx) { console.warn('PullPin Wireframe: cannot get 2D context'); return false; }

    /* Turntable — mousedown starts drag */
    canvas.addEventListener('mousedown', function (e) {
      isDragging = true;
      lastDragX  = e.clientX;
      spinVel    = 0;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });

    /* Turntable — release anywhere on document */
    document.addEventListener('mouseup', function () {
      if (!isDragging) return;
      isDragging = false;
      canvas.style.cursor = 'grab';
    });

    /* Parallax + drag delta — single handler */
    document.addEventListener('mousemove', function (e) {
      mouseX = (e.clientX / window.innerWidth  - 0.5);
      mouseY = (e.clientY / window.innerHeight - 0.5);

      if (isDragging) {
        var dx = e.clientX - lastDragX;
        spinVel  = dx * 0.005;   /* 200 px drag ≈ 1 rad spin — turntable feel */
        rotY    += spinVel;
        lastDragX = e.clientX;
      }
    });

    /* Resize */
    window.addEventListener('resize', function () {
      var h = document.getElementById('hero');
      canvas.width  = h ? h.offsetWidth  : window.innerWidth;
      canvas.height = h ? h.offsetHeight : window.innerHeight;
    });

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
      if (!isActive) {
        isActive = true;
        animate();
      }
    },

    pause: function () {
      isActive = false;
      cancelAnimationFrame(animId);
    }
  };

})();
