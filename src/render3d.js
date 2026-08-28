/* =========================================================================
   Vista 3D: WebGL con las piezas voxelizadas a partir de los mismos sprites.
   Cada fila del sprite se revoluciona sobre si misma, asi que la figura tiene
   volumen real y se reconoce desde cualquier angulo, tambien desde arriba.
   Depende de: THEME y de los SPR_* (se le pasan en init).
   ========================================================================= */
const R3 = (function () {
  'use strict';

  const VOX = 24;            // resolucion del sprite: 24 de ancho
  const PIECE_W = 0.86;      // anchura de una pieza en casillas
  const VS = PIECE_W / VOX;  // lado de un voxel en unidades de mundo

  /* ------------------------------------------------------------ camaras */
  /* `zoom` es un factor sobre la distancia que se calcula para que el tablero
     entero quepa siempre, sea cual sea la proporcion del lienzo. */
  const CAMS = {
    clasica:    { el: 23, az: 0,  zoom: 1.00, fov: 32, ty: 0.30, label: 'Clasica' },
    isometrica: { el: 43, az: 16, zoom: 1.02, fov: 32, ty: 0.10, label: 'Isometrica' },
    cenital:    { el: 87, az: 0,  zoom: 1.04, fov: 33, ty: 0.00, label: 'Cenital' }
  };

  let gl = null, canvas = null, ok = false, initError = '';
  let progLit = null, progFlat = null;
  let meshes = Object.create(null);     // t+c -> {buf, count}
  let boardMesh = null, quadBuf = null;
  let W = 1, H = 1, DPR = 1;
  let camName = 'clasica';
  let cam = { el: 23, az: 0, zoom: 1.0, fov: 32, ty: 0.30 };
  let camTarget = Object.assign({}, cam);
  let flipped = false;
  let view = new Float32Array(16), proj = new Float32Array(16), viewProj = new Float32Array(16);
  let eye = [0, 0, 0];
  let shake = { x: 0, y: 0 };

  /* --------------------------------------------------------- matematicas */
  function mat4() { return new Float32Array(16); }
  function ident(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function perspective(m, fovDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovDeg * Math.PI / 180) / 2);
    m.fill(0);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) / (near - far); m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  }
  function lookAt(m, e, c, up) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
    m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
    m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
    m[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
    m[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
    m[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
    m[15] = 1;
    return m;
  }
  function mul(out, a, b) {                 // out = a * b
    const o = out === a || out === b ? mat4() : out;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
    }
    if (o !== out) out.set(o);
    return out;
  }
  function model(m, x, y, z, rotY, sx, sy, sz, rotZ) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const cz = Math.cos(rotZ || 0), sz2 = Math.sin(rotZ || 0);
    /* escala -> giro en Z (inclinacion al caer) -> giro en Y -> traslacion */
    const a00 = sx * cz, a01 = sx * sz2, a10 = -sy * sz2, a11 = sy * cz;
    m[0] = a00 * c; m[1] = a01; m[2] = -a00 * s; m[3] = 0;
    m[4] = a10 * c; m[5] = a11; m[6] = -a10 * s; m[7] = 0;
    m[8] = sz * s; m[9] = 0; m[10] = sz * c; m[11] = 0;
    m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
    return m;
  }

  /* ------------------------------------------------------------ shaders */
  const VS_LIT = [
    'attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;',
    'uniform mat4 uMV; uniform mat4 uModel;',
    'varying vec3 vNor; varying vec3 vCol; varying float vY;',
    'void main(){',
    '  vec4 wp = uModel * vec4(aPos,1.0);',
    '  vNor = mat3(uModel) * aNor;',
    '  vCol = aCol; vY = wp.y;',
    '  gl_Position = uMV * wp;',
    '}'
  ].join('\n');
  const FS_LIT = [
    'precision mediump float;',
    'varying vec3 vNor; varying vec3 vCol; varying float vY;',
    'uniform vec3 uLight; uniform float uWhite; uniform float uAlpha; uniform vec3 uTint;',
    'uniform float uErode;',
    'void main(){',
    '  if (vY < uErode) discard;',          // desintegracion: se consume de abajo arriba
    '  vec3 n = normalize(vNor);',
    '  float d = max(dot(n, normalize(uLight)), 0.0);',
    '  float sky = 0.5 + 0.5 * n.y;',
    '  vec3 c = vCol * (0.52 + 0.50 * d) + vCol * sky * 0.16;',
    '  c = mix(c, uTint, 0.0);',
    '  c = mix(c, vec3(1.0), uWhite);',
    '  gl_FragColor = vec4(c, uAlpha);',
    '}'
  ].join('\n');
  const VS_FLAT = [
    'attribute vec2 aXZ;',
    'uniform mat4 uMV; uniform vec4 uRect;',   // x, z, halfW, halfD
    'varying vec2 vUV;',
    'void main(){',
    '  vUV = aXZ;',
    '  vec3 p = vec3(uRect.x + aXZ.x * uRect.z, 0.0, uRect.y + aXZ.y * uRect.w);',
    '  gl_Position = uMV * vec4(p, 1.0);',
    '}'
  ].join('\n');
  const FS_FLAT = [
    'precision mediump float;',
    'varying vec2 vUV;',
    'uniform vec4 uColor; uniform float uSoft;',
    'void main(){',
    '  float r = length(vUV);',
    '  float a = uColor.a * (uSoft > 0.5 ? smoothstep(1.0, 0.25, r) : (r <= 1.0 ? 1.0 : 0.0));',
    '  if (a <= 0.003) discard;',
    '  gl_FragColor = vec4(uColor.rgb, a);',
    '}'
  ].join('\n');

  function compile(src, type) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
    return sh;
  }
  function link(vsSrc, fsSrc, attrs) {
    const v = compile(vsSrc, gl.VERTEX_SHADER), f = compile(fsSrc, gl.FRAGMENT_SHADER);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    const o = { p: p, a: {}, u: {} };
    for (const name of attrs) o.a[name] = gl.getAttribLocation(p, name);
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      o.u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return o;
  }

  /* ----------------------------------------------- voxelizado del sprite */
  function hex2rgb(h) {
    if (!h) return [1, 0, 1];
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* Cada tramo horizontal continuo del sprite se convierte en un cilindro:
     asi la figura tiene volumen real y se reconoce desde cualquier angulo,
     tambien desde arriba, sin perder ni un pixel del dibujo original.
     Se guarda solo el intervalo [z0,z1] de cada pixel: al ser un solido de
     revolucion siempre es continuo, y eso permite emitir UNA cara por
     intervalo en vez de una por voxel. */
  function voxelize(spr, pal) {
    const w = spr.w, h = spr.h, d = VOX;
    const rows = spr.idle;
    const z0 = new Int16Array(w * h), z1 = new Int16Array(w * h);
    const col = new Int16Array(w * h);
    col.fill(-1);
    const palette = [];
    const palIndex = Object.create(null);
    const cz = (d - 1) / 2;

    for (let y = 0; y < h; y++) {
      const row = rows[y] || '';
      let x = 0;
      while (x < w) {
        const ch0 = row.charAt(x);
        if (!ch0 || ch0 === '.') { x++; continue; }
        let xe = x;
        while (xe + 1 < w && row.charAt(xe + 1) && row.charAt(xe + 1) !== '.') xe++;
        const cx = (x + xe) / 2;
        const r = (xe - x + 1) / 2;
        for (let px = x; px <= xe; px++) {
          const ch = row.charAt(px);
          let ci = palIndex[ch];
          if (ci === undefined) { ci = palette.length; palIndex[ch] = ci; palette.push(hex2rgb(pal[ch] || pal.B)); }
          const dx = px - cx;
          const half = Math.sqrt(Math.max(0, r * r - dx * dx));
          const a = Math.max(0, Math.round(cz - half)), b = Math.min(d - 1, Math.round(cz + half));
          if (b < a) continue;
          const k = y * w + px;
          col[k] = ci; z0[k] = a; z1[k] = b + 1;      // [z0, z1) en celdas
        }
        x = xe + 1;
      }
    }
    return { z0: z0, z1: z1, col: col, palette: palette, w: w, h: h, d: d };
  }

  /* Caras de un cubo unidad: se usan para el tablero y el marco. */
  const FACES = [
    { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
    { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }
  ];

  /* Emite un rectangulo cualquiera con su normal y su color. */
  function quad(out, p0, p1, p2, p3, n, c) {
    const v = [p0, p1, p2, p0, p2, p3];
    for (let i = 0; i < 6; i++) {
      out.push(v[i][0], v[i][1], v[i][2], n[0], n[1], n[2], c[0], c[1], c[2]);
    }
  }

  function meshFromVoxels(vx) {
    const w = vx.w, h = vx.h, d = vx.d;
    const out = [];
    const halfX = w / 2, halfZ = d / 2;
    const X = function (x) { return (x - halfX) * VS; };
    const Y = function (y) { return (h - y) * VS; };          // el pie queda en y=0
    const Z = function (z) { return (z - halfZ) * VS; };
    const lleno = function (x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return null;
      const k = y * w + x;
      return vx.col[k] < 0 ? null : k;
    };
    /* Partes de [a,b) que NO cubre [na,nb): a lo sumo dos tramos. */
    const restos = [];
    const diff = function (a, b, na, nb) {
      restos.length = 0;
      if (na >= nb || nb <= a || na >= b) { restos.push(a, b); return restos; }
      if (a < na) restos.push(a, Math.min(na, b));
      if (b > nb) restos.push(Math.max(nb, a), b);
      return restos;
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = lleno(x, y);
        if (k === null) continue;
        const c = vx.palette[vx.col[k]];
        const a = vx.z0[k], b = vx.z1[k];
        const x0 = X(x), x1 = X(x + 1), y0 = Y(y + 1), y1 = Y(y);

        /* tapas delantera y trasera */
        quad(out, [x0, y0, Z(b)], [x1, y0, Z(b)], [x1, y1, Z(b)], [x0, y1, Z(b)], [0, 0, 1], c);
        quad(out, [x1, y0, Z(a)], [x0, y0, Z(a)], [x0, y1, Z(a)], [x1, y1, Z(a)], [0, 0, -1], c);

        /* caras laterales: un solo rectangulo por tramo descubierto */
        const lados = [
          { nk: lleno(x + 1, y), n: [1, 0, 0] },
          { nk: lleno(x - 1, y), n: [-1, 0, 0] },
          { nk: lleno(x, y - 1), n: [0, 1, 0] },
          { nk: lleno(x, y + 1), n: [0, -1, 0] }
        ];
        for (let s = 0; s < 4; s++) {
          const L2 = lados[s];
          const na = L2.nk === null ? 0 : vx.z0[L2.nk];
          const nb = L2.nk === null ? 0 : vx.z1[L2.nk];
          const rs = diff(a, b, na, nb);
          for (let t = 0; t < rs.length; t += 2) {
            const za = Z(rs[t]), zb = Z(rs[t + 1]);
            if (zb <= za) continue;
            if (s === 0) quad(out, [x1, y0, zb], [x1, y0, za], [x1, y1, za], [x1, y1, zb], L2.n, c);
            else if (s === 1) quad(out, [x0, y0, za], [x0, y0, zb], [x0, y1, zb], [x0, y1, za], L2.n, c);
            else if (s === 2) quad(out, [x0, y1, zb], [x1, y1, zb], [x1, y1, za], [x0, y1, za], L2.n, c);
            else quad(out, [x0, y0, za], [x1, y0, za], [x1, y0, zb], [x0, y0, zb], L2.n, c);
          }
        }
      }
    }
    return new Float32Array(out);
  }

  function upload(data) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf: buf, count: data.length / 9 };
  }

  /* --------------------------------------------------- tablero y escena */
  function pushBox(out, x0, y0, z0, x1, y1, z1, c, cTop) {
    const P = [[x0, y0, z0], [x1, y1, z1]];
    for (let fi = 0; fi < 6; fi++) {
      const F = FACES[fi];
      const col = (fi === 4 && cTop) ? cTop : c;
      const tri = [0, 1, 2, 0, 2, 3];
      for (let k = 0; k < 6; k++) {
        const vv = F.v[tri[k]];
        out.push(
          P[vv[0]][0], P[vv[1]][1], P[vv[2]][2],
          F.n[0], F.n[1], F.n[2],
          col[0], col[1], col[2]
        );
      }
    }
  }

  function buildBoard() {
    const out = [];
    const light = hex2rgb(THEME.board.light), dark = hex2rgb(THEME.board.dark);
    const lightSide = hex2rgb(THEME.board.lightEdge), darkSide = hex2rgb(THEME.board.darkEdge);
    const border = hex2rgb(THEME.board.border), borderHi = hex2rgb(THEME.board.borderHi);
    for (let sr = 0; sr < 8; sr++) {
      for (let sc = 0; sc < 8; sc++) {
        const claro = ((sr + sc) % 2) === 0;
        const x = sc - 4, z = sr - 4;
        pushBox(out, x, -0.18, z, x + 1, 0, z + 1,
          claro ? lightSide : darkSide, claro ? light : dark);
      }
    }
    /* marco de piedra */
    const B = 0.55, hgt = 0.26;
    pushBox(out, -4 - B, -0.30, -4 - B, 4 + B, hgt - 0.30, -4, border, borderHi);
    pushBox(out, -4 - B, -0.30, 4, 4 + B, hgt - 0.30, 4 + B, border, borderHi);
    pushBox(out, -4 - B, -0.30, -4, -4, hgt - 0.30, 4, border, borderHi);
    pushBox(out, 4, -0.30, -4, 4 + B, hgt - 0.30, 4, border, borderHi);
    /* zocalo bajo el tablero */
    pushBox(out, -4 - B, -0.62, -4 - B, 4 + B, -0.30, 4 + B, hex2rgb(THEME.board.grout), border);
    return upload(new Float32Array(out));
  }

  /* ------------------------------------------------------------- camara */
  /* Esquinas de la caja que envuelve tablero, marco y piezas. */
  const BOX = (function () {
    const R = 4.62, y0 = -0.62, y1 = 1.32, p = [];
    for (let i = 0; i < 8; i++) {
      p.push([(i & 1) ? R : -R, (i & 2) ? y1 : y0, (i & 4) ? R : -R]);
    }
    return p;
  })();

  function eyeAt(r, el, az, ty) {
    return [
      r * Math.cos(el) * Math.sin(az),
      ty + r * Math.sin(el),
      r * Math.cos(el) * Math.cos(az)
    ];
  }

  /* Distancia minima a la que la caja entera cae dentro del encuadre. */
  function fitDistance(el, az, ty, fov) {
    const v = mat4(), pr = mat4(), vp = mat4();
    const aspect = W / Math.max(1, H);
    perspective(pr, fov, aspect, 0.1, 100);
    const tgt = [0, ty, 0];
    const upv = el > 1.396 ? [0, 0, -1] : [0, 1, 0];   // 80 grados
    const cabe = function (r) {
      lookAt(v, eyeAt(r, el, az, ty), tgt, upv);
      mul(vp, pr, v);
      for (let i = 0; i < BOX.length; i++) {
        const b = BOX[i];
        const cw = vp[3] * b[0] + vp[7] * b[1] + vp[11] * b[2] + vp[15];
        if (cw <= 0.01) return false;
        const nx = (vp[0] * b[0] + vp[4] * b[1] + vp[8] * b[2] + vp[12]) / cw;
        const ny = (vp[1] * b[0] + vp[5] * b[1] + vp[9] * b[2] + vp[13]) / cw;
        if (Math.abs(nx) > 0.94 || Math.abs(ny) > 0.94) return false;
      }
      return true;
    };
    let lo = 5, hi = 60;
    if (!cabe(hi)) return hi;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (cabe(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  /* El encuadre solo se recalcula cuando cambia algo: la busqueda binaria es
     cara y updateMatrices corre en cada fotograma. */
  let fitKey = '', fitVal = 12;
  function camState() {
    const az = (cam.az + (flipped ? 180 : 0)) * Math.PI / 180;
    const el = cam.el * Math.PI / 180;
    const key = el.toFixed(3) + ',' + az.toFixed(3) + ',' + cam.ty.toFixed(3) + ',' +
      cam.fov.toFixed(2) + ',' + W + 'x' + H;
    if (key !== fitKey) { fitVal = fitDistance(el, az, cam.ty, cam.fov); fitKey = key; }
    const tgt = [0, cam.ty, 0];
    return { eye: eyeAt(fitVal * (cam.zoom || 1), el, az, cam.ty), tgt: tgt };
  }

  function updateMatrices() {
    const st = camState();
    eye = st.eye;
    const upv = cam.el > 80 ? [0, 0, -1] : [0, 1, 0];
    /* la sacudida mueve la camara de verdad */
    const sx = (shake.x || 0) * 0.004, sy = (shake.y || 0) * 0.004;
    lookAt(view, [eye[0] + sx, eye[1] + sy, eye[2]], [st.tgt[0] + sx, st.tgt[1] + sy, st.tgt[2]], upv);
    perspective(proj, cam.fov, W / Math.max(1, H), 0.1, 100);
    mul(viewProj, proj, view);
  }

  /* mundo -> pixeles CSS del lienzo */
  function worldToScreen(x, y, z) {
    const m = viewProj;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.0001) return { x: -9999, y: -9999, ok: false };
    return { x: (cx / cw * 0.5 + 0.5) * W, y: (1 - (cy / cw * 0.5 + 0.5)) * H, ok: true };
  }

  function squareWorld(sr, sc) { return { x: sc - 3.5, z: sr - 3.5 }; }

  /* ---------------------------------------------------------- API publica */
  function init(canvasEl, SPRMAP) {
    canvas = canvasEl;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false })
        || canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
    } catch (e) { gl = null; }
    if (!gl) return false;
    progLit = link(VS_LIT, FS_LIT, ['aPos', 'aNor', 'aCol']);
    progFlat = link(VS_FLAT, FS_FLAT, ['aXZ']);
    if (!progLit || !progFlat) { initError = 'no compilan los shaders'; gl = null; return false; }

    for (const t of Object.keys(SPRMAP)) {
      for (const c of ['w', 'b']) {
        try {
          meshes[t + c] = upload(meshFromVoxels(voxelize(SPRMAP[t], THEME.sprite[c])));
        } catch (e) { initError = (e && e.message) || String(e); return false; }
      }
    }
    try { boardMesh = buildBoard(); } catch (e) { initError = 'tablero: ' + ((e && e.message) || e); return false; }
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    ok = true;
    setCamera(camName, true);
    return true;
  }

  function resize(w, h, dpr) {
    if (!ok) return;
    W = Math.max(1, w); H = Math.max(1, h); DPR = dpr;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    updateMatrices();
  }

  function setCamera(name, instant) {
    if (!CAMS[name]) return;
    camName = name;
    camTarget = CAMS[name];
    if (instant) { cam = Object.assign({}, camTarget); updateMatrices(); }
  }
  function getCamera() { return camName; }
  function setFlip(v) { flipped = !!v; }

  function update(dt) {
    if (!ok) return;
    const k = Math.min(1, dt * 6);
    let moved = false;
    for (const key of ['el', 'az', 'zoom', 'fov', 'ty']) {
      const d = camTarget[key] - cam[key];
      if (Math.abs(d) > 0.0005) { cam[key] += d * k; moved = true; }
      else cam[key] = camTarget[key];
    }
    void moved;
    updateMatrices();
  }

  /* proyeccion de una casilla al plano de la pantalla, para las particulas */
  function project(sr, sc) {
    if (!ok) return { x: 0, y: 0, s: 1 };
    const p = squareWorld(sr, sc);
    const a = worldToScreen(p.x, 0, p.z);
    const b = worldToScreen(p.x, VS * 8, p.z);        // 8 voxels de alto
    const px = Math.abs(a.y - b.y) / 8;               // pixeles de pantalla por voxel
    return { x: a.x, y: a.y, s: px, world: p };
  }

  /* raton -> casilla, cortando el rayo con el plano del tablero */
  function pick(px, py) {
    if (!ok) return null;
    const ndcX = (px / W) * 2 - 1, ndcY = 1 - (py / H) * 2;
    const inv = invert(viewProj);
    if (!inv) return null;
    const p0 = applyInv(inv, ndcX, ndcY, -1), p1 = applyInv(inv, ndcX, ndcY, 1);
    if (!p0 || !p1) return null;
    const dy = p1[1] - p0[1];
    if (Math.abs(dy) < 1e-6) return null;
    const t = -p0[1] / dy;
    if (t < 0 || t > 1) return null;
    const x = p0[0] + (p1[0] - p0[0]) * t, z = p0[2] + (p1[2] - p0[2]) * t;
    const sc = Math.floor(x + 4), sr = Math.floor(z + 4);
    if (sc < 0 || sc > 7 || sr < 0 || sr > 7) return null;
    return { sr: sr, sc: sc };
  }
  function applyInv(m, x, y, z) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (Math.abs(w) < 1e-8) return null;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    ];
  }
  function invert(a) {
    const o = mat4();
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4];
    const b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13];
    const b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  }

  /* ------------------------------------------------------------- pintado */
  const mModel = mat4();
  const sunDir = [0.45, 0.82, 0.36];

  function bindLit() {
    gl.useProgram(progLit.p);
    gl.uniformMatrix4fv(progLit.u.uMV, false, viewProj);
    gl.uniform3fv(progLit.u.uLight, sunDir);
  }
  function drawMesh(m, mdl, white, alpha, erodeY) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    const st = 9 * 4;
    gl.enableVertexAttribArray(progLit.a.aPos);
    gl.vertexAttribPointer(progLit.a.aPos, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(progLit.a.aNor);
    gl.vertexAttribPointer(progLit.a.aNor, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(progLit.a.aCol);
    gl.vertexAttribPointer(progLit.a.aCol, 3, gl.FLOAT, false, st, 24);
    gl.uniformMatrix4fv(progLit.u.uModel, false, mdl);
    gl.uniform1f(progLit.u.uWhite, white || 0);
    gl.uniform1f(progLit.u.uAlpha, alpha == null ? 1 : alpha);
    gl.uniform1f(progLit.u.uErode, erodeY == null ? -99 : erodeY);
    gl.uniform3f(progLit.u.uTint, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  function drawFlatQuad(x, z, halfW, halfD, rgba, soft) {
    gl.useProgram(progFlat.p);
    gl.uniformMatrix4fv(progFlat.u.uMV, false, viewProj);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(progFlat.a.aXZ);
    gl.vertexAttribPointer(progFlat.a.aXZ, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(progFlat.u.uRect, x, z, halfW, halfD);
    gl.uniform4f(progFlat.u.uColor, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.uniform1f(progFlat.u.uSoft, soft ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* scene = {
       pieces: [{t,c,sr,sc,lift,squash,scale,lean,white,alpha,erode,facing}],
       marks:  [{sr,sc,color:[r,g,b,a],soft}],
       shake:  {x,y}, bg: '#rrggbb'
     } */
  function draw(scene) {
    if (!ok) return;
    shake = scene.shake || { x: 0, y: 0 };
    updateMatrices();

    const bg = hex2rgb(scene.bg || THEME.scene.skyBot);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    bindLit();
    ident(mModel);
    drawMesh(boardMesh, mModel, 0, 1, -99);

    /* marcas del tablero (seleccion, destinos, ultima jugada, jaque) */
    const marks = scene.marks || [];
    if (marks.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const mk of marks) {
        const p = squareWorld(mk.sr, mk.sc);
        drawFlatQuad(p.x, p.z, mk.r || 0.46, mk.r || 0.46, mk.color, mk.soft);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    /* sombras bajo las piezas */
    const pieces = scene.pieces || [];
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const pc of pieces) {
      if (pc.hidden) continue;
      const p = squareWorld(pc.sr, pc.sc);
      const lift = (pc.lift || 0) * VS;
      const a = 0.42 * Math.max(0, 1 - lift * 1.4) * (pc.alpha == null ? 1 : pc.alpha);
      if (a <= 0.01) continue;
      const r = 0.38 * (pc.t === 'r' ? 1.15 : 1) * (1 + lift * 0.5);
      drawFlatQuad(p.x, p.z, r, r, [0, 0, 0, a], true);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    /* piezas */
    bindLit();
    for (const pc of pieces) {
      if (pc.hidden) continue;
      const m = meshes[pc.t + pc.c];
      if (!m) continue;
      const p = squareWorld(pc.sr, pc.sc);
      const sq = pc.squash == null ? 1 : pc.squash;
      const sc = pc.scale == null ? 1 : pc.scale;
      model(mModel, p.x, (pc.lift || 0) * VS, p.z, pc.facing || 0, sc, sq * sc, sc, pc.lean || 0);
      const erodeY = pc.erode ? (pc.lift || 0) * VS + pc.erode * (32 * VS) : -99;
      const alpha = pc.alpha == null ? 1 : pc.alpha;
      if (alpha < 0.999) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      drawMesh(m, mModel, pc.white ? 1 : 0, alpha, erodeY);
      if (alpha < 0.999) gl.disable(gl.BLEND);
    }
  }

  function stats() {
    let tris = 0;
    for (const k in meshes) tris += meshes[k].count / 3;
    return { mallas: Object.keys(meshes).length, triangulos: Math.round(tris), tablero: boardMesh ? boardMesh.count / 3 : 0 };
  }
  function ready() { return ok; }
  function lastError() { return initError; }
  function voxelSize() { return VS; }
  function cameraList() {
    return Object.keys(CAMS).map(function (k) { return { id: k, label: CAMS[k].label }; });
  }

  return {
    init: init, resize: resize, draw: draw, update: update,
    setCamera: setCamera, getCamera: getCamera, cameraList: cameraList,
    setFlip: setFlip, project: project, pick: pick, ready: ready,
    voxelSize: voxelSize, worldToScreen: worldToScreen, squareWorld: squareWorld,
    lastError: lastError, stats: stats
  };
})();
