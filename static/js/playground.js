/* DexDirect playground (mounted into #viewer-3d by main.js).

   A MuJoCo simulation of the station running in the browser (official @mujoco/mujoco WebAssembly build).
   - Drag the orange handle: a spring pulls the grabbed point toward the pointer while the arm is gravity-
     compensated with no position stiffness, like the real drag mode. The mouse wheel moves the target in depth,
     Q / E roll the wrist.
   - "Use my webcam": MediaPipe Hands landmarks are retargeted to the 13 MIDAS finger actuators with the team's own
     mapping (ported from midas_hand_retargeter). C (or Calibrate) resets the hand mapping: the first press shows the
     reference pose in the top-right corner, a second press in that pose makes it the robot's open hand (Esc cancels).
     Without a webcam, the grip slider or the space bar closes the hand.
   - Reset puts the arm, the hand and the cubes back.
   Model: static/sim/dexdirect.xml (tools/sim/build_sim.py). Visuals: static/3d/robot.glb (STEP geometry). */

const T3 = 'https://cdn.jsdelivr.net/npm/three@0.170.0';
const MJ = 'https://cdn.jsdelivr.net/npm/@mujoco/mujoco@4.0.1/mujoco.js';
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';

export async function mount(el) {
  const ui = buildUI(el);
  el.classList.remove('is-empty');
  let started = false;
  ui.onStart(() => {
    if (started) return;
    started = true;
    start(el, ui).catch((err) => {
      console.warn('[playground]', err);
      ui.fail(err && err.userMessage ? err.userMessage : 'The simulation could not start in this browser.');
    });
  });
}

const fail = (msg, err) => Object.assign(err instanceof Error ? err : new Error(msg), { userMessage: msg });

// MuJoCo's wasm normally comes from the CDN next to mujoco.js. Hosts that only allow requests to their own origin
// get the same file from static/sim/mujoco.wasm instead, if it is there. The engine also needs WebAssembly and
// eval (its JS bindings generate functions at load time); hosts with a strict CSP block those, so check first.
async function loadEngine(base) {
  const elsewhere = 'Open the published page, or serve this folder locally (python3 -m http.server).';
  try { new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); } catch (e) {
    throw fail(`This host does not allow WebAssembly, which the physics engine needs. ${elsewhere}`, e);
  }
  try { new Function('return 0')(); } catch (e) {     // eslint-disable-line no-new-func
    throw fail(`This host blocks eval, which the physics engine needs. ${elsewhere}`, e);
  }
  let factory;
  try { factory = (await import(MJ)).default; } catch (e) { throw fail('The physics engine could not be downloaded.', e); }
  try { return await factory(); } catch (cdnErr) {
    console.warn('[playground] engine from the CDN failed, trying a local copy:', cdnErr);
    try { return await factory({ locateFile: (p) => new URL(`sim/${p}`, base).href }); } catch (e) {
      throw fail('The physics engine (WebAssembly) could not be loaded here.', e);
    }
  }
}

async function start(el, ui) {
  const base = new URL('static/', document.baseURI);
  ui.loading('Loading the physics engine', 0.05);
  const libs = Promise.all([
    import(`${T3}/+esm`),
    import(`${T3}/examples/jsm/controls/OrbitControls.js/+esm`),
    import(`${T3}/examples/jsm/loaders/GLTFLoader.js/+esm`),
    import(`${T3}/examples/jsm/libs/meshopt_decoder.module.js/+esm`),
    import(`${T3}/examples/jsm/environments/RoomEnvironment.js/+esm`),
    import(`${T3}/examples/jsm/geometries/RoundedBoxGeometry.js/+esm`),
  ]).catch((e) => { throw fail('The 3D libraries could not be loaded.', e); });
  const engine = loadEngine(base);
  engine.catch(() => {});                              // handled where it is awaited; avoids an "unhandled" report meanwhile
  const files = Promise.all([
    fetch(new URL('sim/dexdirect.xml', base)).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    fetch(new URL('sim/meta.json', base)).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
  ]).catch((e) => { throw fail('The simulation model could not be loaded.', e); });
  files.catch(() => {});

  const [THREE, { OrbitControls }, { GLTFLoader }, { MeshoptDecoder }, { RoomEnvironment }, { RoundedBoxGeometry }] = await libs;
  ui.loading('Loading the robot', 0.35);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltfP = loadRobot(loader, new URL('3d/', base), (u) => ui.loading('Loading the robot', 0.35 + 0.35 * u));
  const [mujoco, [xml, meta], gltf] = await Promise.all([engine, files, gltfP]);
  ui.loading('Building the scene', 0.85);

  /* ---------- MuJoCo ---------- */
  let model, data;
  try {
    model = mujoco.MjModel.from_xml_string(xml);
    data = new mujoco.MjData(model);
  } catch (e) { throw fail('The simulation model failed to compile.', e); }
  const OBJ = mujoco.mjtObj;
  const id = (type, name) => mujoco.mj_name2id(model, type.value, name);
  const nameOf = (type, i) => mujoco.mj_id2name(model, type.value, i);
  const reset = () => { mujoco.mj_resetDataKeyframe(model, data, 0); mujoco.mj_forward(model, data); };
  reset();
  const dt = (model.opt && model.opt.timestep) || 0.002;
  const bLink6 = id(OBJ.mjOBJ_BODY, 'link6');
  const bBase = id(OBJ.mjOBJ_BODY, 'base_link');
  const bPalm = id(OBJ.mjOBJ_BODY, 'palm_base');

  /* ---------- three.js ---------- */
  const canvas = ui.canvas;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) { throw fail('This browser cannot show 3D (WebGL is unavailable).', e); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0e11);
  scene.fog = new THREE.Fog(0x0d0e11, 5, 11);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.02, 30);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.3; controls.maxDistance = 4; controls.maxPolarAngle = Math.PI * 0.52;
  const root = new THREE.Group(); root.rotation.x = -Math.PI / 2; scene.add(root);   // MuJoCo world (Z-up)

  // lights
  scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x202022, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  const tz = meta.table_z;
  key.position.set(1.6, 2.6 + tz, 1.2); key.target.position.set(0.4, tz, 0.3);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.5, far: 6 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.6); fill.position.set(-1.5, 1.5 + tz, -1); scene.add(fill);

  // environment geoms (table, post, floor, tray, cubes) straight from the model
  const robotRoot = model.body_rootid[bBase];
  const geomMeshes = [];
  const mats = {};
  const matFor = (r, g, b, kind) => {
    const k = `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)},${kind}`;
    if (!mats[k]) {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(r, g, b), roughness: kind === 'metal' ? 0.35 : 0.6, metalness: kind === 'metal' ? 0.8 : 0 });
      m.color.convertSRGBToLinear(); mats[k] = m;
    }
    return mats[k];
  };
  for (let g = 0; g < model.ngeom; g += 1) {
    const b = model.geom_bodyid[g];
    if (b !== 0 && model.body_rootid[b] === robotRoot) continue;
    const type = model.geom_type[g];
    const s = model.geom_size.slice(3 * g, 3 * g + 3);
    const [r, gg, bb] = model.geom_rgba.slice(4 * g, 4 * g + 3);
    const name = nameOf(OBJ.mjOBJ_GEOM, g) || '';
    let mesh;
    if (type === 0) {                                              // plane: the floor
      mesh = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.95 }));
    } else if (type === 6) {                                       // box
      const cube = model.body_jntnum[b] > 0;
      const geo = cube ? new RoundedBoxGeometry(2 * s[0], 2 * s[1], 2 * s[2], 3, 0.003) : new THREE.BoxGeometry(2 * s[0], 2 * s[1], 2 * s[2]);
      mesh = new THREE.Mesh(geo, matFor(r, gg, bb, name === 'post' ? 'metal' : 'plain'));
      mesh.castShadow = true;
    } else continue;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    geomMeshes.push({ g, mesh, moving: model.body_jntnum[b] > 0 });
  }
  const tmpM = new THREE.Matrix4();
  const setFromXpos = (mesh, pos, mat, o, r) => {
    tmpM.set(mat[r], mat[r + 1], mat[r + 2], pos[o], mat[r + 3], mat[r + 4], mat[r + 5], pos[o + 1], mat[r + 6], mat[r + 7], mat[r + 8], pos[o + 2], 0, 0, 0, 1);
    mesh.matrix.copy(tmpM); mesh.matrixWorldNeedsUpdate = true;
  };
  const syncGeoms = (all) => {
    const gp = data.geom_xpos, gm = data.geom_xmat;
    for (const it of geomMeshes) if (all || it.moving) setFromXpos(it.mesh, gp, gm, 3 * it.g, 9 * it.g);
  };
  syncGeoms(true);

  // robot visuals, driven by the simulated joint angles
  const robot = gltf.scene;
  robot.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(robot);
  robot.position.set(...data.xpos.slice(3 * bBase, 3 * bBase + 3));
  const bq = data.xquat.slice(4 * bBase, 4 * bBase + 4);
  robot.quaternion.set(bq[1], bq[2], bq[3], bq[0]);
  const visJoints = [];
  for (let j = 0; j < model.njnt; j += 1) {
    if (model.jnt_type[j] !== 3) continue;                            // hinge
    const node = robot.getObjectByName(`J_${nameOf(OBJ.mjOBJ_JOINT, j)}`);
    if (!node) continue;
    visJoints.push({ node, adr: model.jnt_qposadr[j], axis: new THREE.Vector3(...model.jnt_axis.slice(3 * j, 3 * j + 3)) });
  }
  const syncRobot = () => { const q = data.qpos; for (const v of visJoints) v.node.quaternion.setFromAxisAngle(v.axis, q[v.adr]); };
  syncRobot();
  const link6Node = robot.getObjectByName('J_joint6');
  const handleMeshes = [];
  link6Node.children.forEach((c) => {
    if (c.isMesh && c.material && c.material.color) {
      const col = c.material.color;
      if (col.r > 0.7 && col.g > 0.15 && col.g < 0.6 && col.b < 0.15) handleMeshes.push(c);
    }
  });
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.set(...meta.grip); link6Node.add(proxy);
  const grabTargets = [...handleMeshes, proxy];
  // the CAD colour (#FF8700) was stored as-is in a linear glTF slot, which renders amber; convert it so the handle is the real orange
  const glowMats = handleMeshes.map((m) => { m.material = m.material.clone(); m.material.color.convertSRGBToLinear(); return m.material; });
  const setGlow = (on) => glowMats.forEach((m) => { m.emissive = new THREE.Color(on ? 0x5a2a00 : 0x000000); });

  // camera: in front of the workspace, the handle and the cubes in view
  root.updateMatrixWorld(true);
  const toWorld = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(root.matrixWorld);
  const home = { pos: toWorld(1.05, -0.95, tz + 0.55), target: toWorld(0.33, -0.25, tz + 0.12) };
  camera.position.copy(home.pos); controls.target.copy(home.target); controls.update();

  /* ---------- hand actuators ---------- */
  const actIdx = {};
  meta.actuators.forEach((n, i) => { actIdx[n.replace('_xm335_t323_t', '')] = i; });
  const ctrlRange = [];
  for (let i = 0; i < model.nu; i += 1) ctrlRange.push([model.actuator_ctrlrange[2 * i], model.actuator_ctrlrange[2 * i + 1]]);
  const GRASP = {
    index_mcp_pitch_joint: -1.0, index_pip_joint: -0.95, middle_mcp_pitch_joint: -1.0, middle_pip_joint: -0.95,
    ring_mcp_pitch_joint: -1.0, ring_pip_joint: -0.95, thumb_cmc_roll_joint: 1.35, thumb_cmc_side_joint: 0.45,
    thumb_mcp_joint: -0.55, thumb_dip_joint: -0.45,
  };
  const target = new Float64Array(model.nu);
  const setGrip = (u) => { for (const [n, i] of Object.entries(actIdx)) target[i] = (GRASP[n] || 0) * u; };
  setGrip(0);

  /* ---------- handle drag ---------- */
  const K = 300, C = 30, KR = 6, CR = 0.6, FMAX = 40;
  const drag = { on: false, local: new THREE.Vector3(), target: new THREE.Vector3(), plane: new THREE.Plane(), prev: null, Rhold: new Float64Array(9) };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (ev) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const toSim = (v) => root.worldToLocal(v.clone());
  const R6 = () => data.xmat.slice(9 * bLink6, 9 * bLink6 + 9);
  canvas.addEventListener('pointerdown', (ev) => {
    pick(ev);
    const hit = ray.intersectObjects(grabTargets, false)[0];
    if (!hit) return;
    ev.preventDefault(); ev.stopPropagation();
    canvas.setPointerCapture(ev.pointerId);
    controls.enabled = false;
    drag.on = true; drag.prev = null;
    drag.local.copy(link6Node.worldToLocal(hit.point.clone()));
    drag.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), hit.point);
    drag.target.copy(toSim(hit.point));
    drag.Rhold.set(R6());
    ui.dragging(true); setGlow(true);
  }, { capture: true });
  const hoverCheck = (ev) => {
    if (drag.on) return;
    pick(ev);
    const over = ray.intersectObjects(grabTargets, false).length > 0;
    canvas.style.cursor = over ? 'grab' : '';
    setGlow(over);
  };
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag.on) { if (ev.pointerType === 'mouse') hoverCheck(ev); return; }
    pick(ev);
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(drag.plane, p)) drag.target.copy(toSim(p));
    canvas.style.cursor = 'grabbing';
  });
  const endDrag = () => {
    if (!drag.on) return;
    drag.on = false; controls.enabled = true; ui.dragging(false); setGlow(false); canvas.style.cursor = '';
    data.xfrc_applied.fill(0);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (ev) => {
    if (!drag.on) return;
    ev.preventDefault(); ev.stopPropagation();
    const dir = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(ev.deltaY > 0 ? 0.01 : -0.01);
    drag.plane.constant -= drag.plane.normal.dot(dir);
    drag.target.add(toSim(dir.add(new THREE.Vector3())).sub(toSim(new THREE.Vector3())));
  }, { passive: false, capture: true });
  const rollHold = (ang) => {                                        // rotate the held orientation about the flange axis
    const R = drag.Rhold, c = Math.cos(ang), s = Math.sin(ang);
    for (let i = 0; i < 3; i += 1) {
      const x = R[3 * i], y = R[3 * i + 1];
      R[3 * i] = c * x + s * y; R[3 * i + 1] = -s * x + c * y;
    }
  };

  function applyDrag() {
    const xp = data.xpos, xm = data.xmat, o = 3 * bLink6, r = 9 * bLink6, l = drag.local;
    const p = [xp[o] + xm[r] * l.x + xm[r + 1] * l.y + xm[r + 2] * l.z,
      xp[o + 1] + xm[r + 3] * l.x + xm[r + 4] * l.y + xm[r + 5] * l.z,
      xp[o + 2] + xm[r + 6] * l.x + xm[r + 7] * l.y + xm[r + 8] * l.z];
    const v = drag.prev ? [(p[0] - drag.prev[0]) / dt, (p[1] - drag.prev[1]) / dt, (p[2] - drag.prev[2]) / dt] : [0, 0, 0];
    drag.prev = p;
    let F = [0, 1, 2].map((k) => K * (drag.target.getComponent(k) - p[k]) - C * v[k]);
    const n = Math.hypot(...F); if (n > FMAX) F = F.map((f) => f * FMAX / n);
    // orientation hold: torque toward Rhold (rotation vector of Rhold * R^T)
    const Rh = drag.Rhold, R = xm.subarray(r, r + 9);
    const E = new Array(9);
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) E[3 * i + j] = Rh[3 * i] * R[3 * j] + Rh[3 * i + 1] * R[3 * j + 1] + Rh[3 * i + 2] * R[3 * j + 2];
    const tr = Math.min(1, Math.max(-1, (E[0] + E[4] + E[8] - 1) / 2)), ang = Math.acos(tr), sn = Math.sin(ang);
    const k = ang < 1e-4 ? 0.5 : ang / (2 * sn);
    const rv = [(E[7] - E[5]) * k, (E[2] - E[6]) * k, (E[3] - E[1]) * k];
    const xi = data.xipos, cv = data.cvel, ci = 6 * bLink6;
    const d = [p[0] - xi[o], p[1] - xi[o + 1], p[2] - xi[o + 2]];
    const tau = [d[1] * F[2] - d[2] * F[1] + KR * rv[0] - CR * cv[ci], d[2] * F[0] - d[0] * F[2] + KR * rv[1] - CR * cv[ci + 1], d[0] * F[1] - d[1] * F[0] + KR * rv[2] - CR * cv[ci + 2]];
    const xf = data.xfrc_applied, fi = 6 * bLink6;
    xf[fi] = F[0]; xf[fi + 1] = F[1]; xf[fi + 2] = F[2]; xf[fi + 3] = tau[0]; xf[fi + 4] = tau[1]; xf[fi + 5] = tau[2];
  }

  /* ---------- retargeting (webcam) ---------- */
  const limits = {};
  meta.actuators.forEach((a, i) => { limits[a.replace('_xm335_t323_t', '')] = ctrlRange[i]; });
  const rt = makeMidasRetargeter(limits);
  let webcam = null, handFresh = false, posing = false;
  async function webcamOn() {
    ui.webcam('loading');
    try {
      webcam = await startHandTracking(MP, new URL('3d/hand_landmarker.task', base).href, ui.video);
    } catch (err) {
      webcam = null;
      const embedded = window.self !== window.top;
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      ui.webcam('off', denied && embedded ? 'The camera is blocked in this embedded preview. Open the page on its own, or use the grip slider.'
        : denied ? 'Camera permission was denied. The grip slider still works.' : 'Camera or hand tracker unavailable. The grip slider still works.');
      return;
    }
    rt.reset();
    ui.webcam('on');
  }
  function webcamOff() { if (webcam) webcam.stop(); webcam = null; handFresh = false; setPosing(false); rt.clearCalibration(); ui.webcam('off'); setGrip(ui.gripValue()); }
  function setPosing(on) { posing = on; ui.pose(on); }
  // C or the Calibrate button. The first press shows the reference pose; a second press, made while holding it, maps
  // that pose to the robot's open hand (every joint at zero).
  function handMapping() {
    if (!webcam) { ui.flash('C resets the hand mapping while the webcam is on.'); return; }
    if (!posing) { setPosing(true); return; }
    if (!handFresh || !rt.calibrate()) { ui.flash('No hand in view. Hold it up to the camera in the pose and try again.'); return; }
    setPosing(false);
    ui.flash('Hand mapping reset: this pose is now the robot\'s open hand.');
  }
  ui.onWebcam(() => (webcam ? webcamOff() : webcamOn()));
  ui.onGrip((u) => { if (!webcam) setGrip(u); });
  ui.onCalibrate(handMapping);
  ui.onReset(() => { reset(); data.xfrc_applied.fill(0); endDrag(); rt.reset(); if (!webcam) setGrip(ui.gripValue()); });
  window.addEventListener('keydown', (ev) => {
    if (!visible || (ev.target && ev.target.closest && ev.target.closest('input, textarea, select'))) return;
    if (ev.key === ' ' && !webcam) { ev.preventDefault(); setGrip(1); ui.setGrip(1); }
    if ((ev.key === 'q' || ev.key === 'e') && drag.on) rollHold(ev.key === 'q' ? 0.12 : -0.12);
    if ((ev.key === 'c' || ev.key === 'C') && !ev.repeat && !ev.ctrlKey && !ev.metaKey && !ev.altKey) handMapping();
    if (ev.key === 'Escape' && posing) setPosing(false);
  });
  window.addEventListener('keyup', (ev) => { if (ev.key === ' ' && !webcam) { setGrip(0); ui.setGrip(0); } });

  /* ---------- loop ---------- */
  let visible = true, raf = 0, last = 0, acc = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 1 ? 48 : 36; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();
  function frame(now) {
    raf = 0;
    const el_ = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    if (webcam) {
      const res = webcam.latest();
      const fresh = res && now - res.at < 500;
      handFresh = !!fresh;
      ui.tracking(fresh ? res : null);
      if (fresh && res.at !== rt.lastAt) { rt.lastAt = res.at; const q = rt.retarget(res.world); for (const [n, v] of Object.entries(q)) if (n in actIdx) target[actIdx[n]] = v; }
    }
    for (let i = 0; i < model.nu; i += 1) {
      const c = data.ctrl[i] + (target[i] - data.ctrl[i]) * 0.35;
      data.ctrl[i] = Math.min(ctrlRange[i][1], Math.max(ctrlRange[i][0], c));
    }
    acc += el_;
    let n = 0;
    while (acc >= dt && n < 25) {
      if (drag.on) applyDrag();
      mujoco.mj_step(model, data);
      acc -= dt; n += 1;
    }
    if (n === 25) acc = 0;
    syncRobot(); syncGeoms(false);
    controls.update();
    renderer.render(scene, camera);
    if (visible) raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    if (visible && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!visible && webcam) webcamOff();
  }).observe(el);

  el.__pg = { mujoco, model, data, camera, controls, view: (p, t) => { camera.position.set(...p); controls.target.set(...t); controls.update(); },
    grab: (dx, dy, dz) => { drag.on = true; drag.prev = null; drag.local.set(...meta.grip); drag.Rhold.set(R6());
      const g = id(OBJ.mjOBJ_SITE, 'grip'); drag.target.set(data.site_xpos[3 * g] + dx, data.site_xpos[3 * g + 1] + dy, data.site_xpos[3 * g + 2] + dz); },
    release: endDrag, grip: setGrip,
    gripScreen: () => { const g = id(OBJ.mjOBJ_SITE, 'grip'); const v = new THREE.Vector3(...data.site_xpos.slice(3 * g, 3 * g + 3)).applyMatrix4(root.matrixWorld).project(camera);
      const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    gripPos: () => { const g = id(OBJ.mjOBJ_SITE, 'grip'); return Array.from(data.site_xpos.slice(3 * g, 3 * g + 3)); },
    cube: (n) => { const b = id(OBJ.mjOBJ_BODY, n); return Array.from(data.xpos.slice(3 * b, 3 * b + 3)); },
    ctrl: () => Array.from(data.ctrl),
    retargetTest: (world) => { const q = rt.targets(world.map((p) => [p.x, p.y, p.z])); return Object.fromEntries(Object.entries(q).map(([k, v]) => [k.replace('_joint', ''), +v.toFixed(2)])); } };
  ui.ready();
  raf = requestAnimationFrame(frame);
}

/* ---------- robot model loading (with fallbacks for hosts that block WebAssembly or do not serve .glb) ---------- */
async function loadRobot(loader, base, onProgress) {
  for (const name of ['robot.glb', 'robot.glb.json', 'robot.plain.glb', 'robot.plain.glb.json']) {
    try {
      const url = new URL(name, base).href;
      if (!name.endsWith('.json')) return await loader.loadAsync(url, (e) => { if (e.total) onProgress(e.loaded / e.total); });
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const b64 = (await r.json()).glb;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return await loader.parseAsync(bytes.buffer, url.slice(0, url.lastIndexOf('/') + 1));
    } catch (err) {
      console.warn(`[playground] ${name} not used:`, (err && err.message) || err);
    }
  }
  throw fail('The robot model could not be loaded.');
}

/* ---------- MIDAS hand retargeting ----------
   Ported from midas-hand-org/midas_hand_retargeter (postprocess.py + the retargeter's filter and neutral calibration,
   MIT). In the team's teleop these landmark-derived targets overwrite every active joint after the dex-retargeting
   vector solve, so this layer alone defines the hand command. Finger curl comes from the PIP/DIP bend, ab/ad from the
   in-palm lateral direction (damped as the finger curls), thumb MCP/DIP from bend angles, CMC side from the in-plane
   sweep and CMC roll from the out-of-plane angle. Only relative geometry is used, so MediaPipe world landmarks of
   either hand go in directly (the teleop's MANO rotation and left-hand mirroring do not change these values). */
function makeMidasRetargeter(limits) {
  const TUNE = { fingerCurl: 1.0, fingerAbad: 1.2, fingerAlpha: 0.25, thumbCmc: 1.0, thumbSide: 1.5, thumbRoll: 0.6, thumbFlex: 1.2, thumbAlpha: 0.25 };
  const FINGERS = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16] };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const n = norm(a); return n < 1e-9 ? [0, 0, 0] : mul(a, 1 / n); };
  const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const smoothstep = (v) => { const x = clip(v, 0, 1); return x * x * (3 - 2 * x); };
  const deadzone = (v, dz) => (Math.abs(v) <= dz ? 0 : v - Math.sign(v) * dz);
  const blend = (a, b, t) => a + clip(t, 0, 1) * (b - a);
  const angle = (a, b) => { const d = norm(a) * norm(b); return d < 1e-9 ? 0 : Math.acos(clip(dot(a, b) / d, -1, 1)); };
  const palmBasis = (P) => {
    const fwd = unit(sub(P[9], P[0]));
    let lat = unit(sub(P[13], P[5]));
    let nrm = unit(cross(lat, fwd));
    if (norm(nrm) < 1e-6) nrm = [0, 0, 1];
    lat = unit(cross(fwd, nrm));
    return [fwd, lat, nrm];
  };
  function targets(P) {
    const [fwd, lat, nrm] = palmBasis(P);
    const out = {};
    for (const [f, [m, pp, d, t]] of Object.entries(FINGERS)) {
      const prox = sub(P[pp], P[m]), mid = sub(P[d], P[pp]), dist = sub(P[t], P[d]);
      let curl = 0;
      if (norm(prox) + norm(mid) + norm(dist) >= 1e-6) curl = smoothstep(TUNE.fingerCurl * (0.62 * angle(prox, mid) + 0.38 * angle(mid, dist)) / 1.35);
      const dir = add(mul(prox, 0.75), mul(sub(P[d], P[m]), 0.25 * 0.5));
      const inPlane = sub(dir, mul(nrm, dot(dir, nrm)));
      const splay = deadzone(Math.atan2(dot(inPlane, lat), Math.abs(dot(inPlane, fwd)) + 1e-6), 0.05);
      out[`${f}_mcp_abad_joint`] = clip((1 - 0.5 * clip(curl, 0, 1)) * TUNE.fingerAbad * splay, -0.785, 0.785);
      out[`${f}_mcp_pitch_joint`] = blend(0, -1.35, curl);
      out[`${f}_pip_joint`] = blend(0, -1.22, curl);
    }
    const [cmc, mcp, ip, tip] = [P[1], P[2], P[3], P[4]];
    const a1 = sub(mcp, cmc), a2 = sub(ip, mcp), a3 = sub(tip, ip);
    const mcpCurl = smoothstep(TUNE.thumbFlex * angle(a1, a2) / 1.57);
    const dipCurl = Math.max(smoothstep(TUNE.thumbFlex * angle(a2, a3) / 1.57), 0.3 * mcpCurl);
    const side = Math.atan2(dot(a1, lat), dot(a1, fwd));
    const sideTarget = 0 - TUNE.thumbCmc * TUNE.thumbSide * deadzone(side - (-0.3), 0.05);
    const opp = Math.atan2(dot(a1, nrm), Math.hypot(dot(a1, fwd), dot(a1, lat)) + 1e-9);
    const opposition = clip(smoothstep(TUNE.thumbCmc * TUNE.thumbRoll * (Math.abs(opp) - 0.05) / 0.45), 0, 1);
    out.thumb_cmc_roll_joint = blend(0, 2.15, opposition);
    out.thumb_cmc_side_joint = clip(sideTarget, -0.785, 0.9);
    out.thumb_mcp_joint = blend(0, -1.57, mcpCurl);
    out.thumb_dip_joint = blend(0, -1.57, dipCurl);
    return out;
  }
  let filt = {}, neutral = {}, lastRaw = {};
  const lim = (n, v) => clip(v, limits[n][0], limits[n][1]);
  const calibrated = (n, raw, nv) => {                      // keep neutral at zero, map each limit back to itself
    const [lo, hi] = limits[n]; raw = clip(raw, lo, hi); nv = clip(nv, lo, hi);
    if (raw >= nv) return hi <= nv ? lim(n, 0) : lim(n, (raw - nv) * hi / (hi - nv));
    return nv <= lo ? lim(n, 0) : lim(n, (raw - nv) * (-lo) / (nv - lo));
  };
  function retarget(world) {
    const P = world.map((p) => [p.x, p.y, p.z]);
    const raw = targets(P), out = {};
    for (const [n, v] of Object.entries(raw)) {
      const a = n.startsWith('thumb') ? TUNE.thumbAlpha : TUNE.fingerAlpha;
      filt[n] = filt[n] === undefined ? v : filt[n] + a * (v - filt[n]);
      lastRaw[n] = lim(n, filt[n]);
      out[n] = n in neutral ? calibrated(n, lastRaw[n], neutral[n]) : lastRaw[n];
    }
    return out;
  }
  return {
    retarget, targets,
    reset: () => { filt = {}; },
    calibrate: () => { neutral = { ...lastRaw }; return Object.keys(neutral).length > 0; },
    clearCalibration: () => { neutral = {}; },
    lastAt: -1,
  };
}

/* ---------- webcam hand tracking (MediaPipe, on device) ---------- */
async function startHandTracking(MPurl, modelUrl, video) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: modelUrl, delegate }, runningMode: 'VIDEO', numHands: 1,
    minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7 });
  let lm;
  try {
    video.srcObject = stream;
    await video.play();
    const vision = await import(`${MPurl}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MPurl}/wasm`);
    try { lm = await vision.HandLandmarker.createFromOptions(fileset, opts('GPU')); } catch { lm = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU')); }
  } catch (err) {                                    // do not leave the camera on if the tracker cannot start
    stream.getTracks().forEach((t) => t.stop()); video.srcObject = null;
    throw err;
  }
  let latest = null, lastT = -1, stopped = false;
  const loop = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.currentTime !== lastT) {
      lastT = video.currentTime;
      const r = lm.detectForVideo(video, performance.now());
      if (r.worldLandmarks && r.worldLandmarks.length) latest = { world: r.worldLandmarks[0], img: r.landmarks[0], at: performance.now() };
    }
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
  };
  loop();
  return { latest: () => latest, stop: () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; lm.close(); } };
}

/* ---------- UI ---------- */
function buildUI(el) {
  el.innerHTML = '';
  const w = document.createElement('div');
  w.className = 'pg';
  w.innerHTML = `
    <canvas class="pg-canvas" aria-label="MuJoCo simulation of the DexDirect station"></canvas>
    <div class="pg-start">
      <img class="pg-poster" src="static/images/posters/playground.jpg" alt="" onerror="this.remove()">
      <div class="pg-start-inner">
        <p class="pg-kicker">MuJoCo, running in your browser</p>
        <button class="pg-go" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>Start the simulation</button>
        <p class="pg-note">About 4 MB to download. Best on a laptop or desktop.</p>
      </div>
    </div>
    <p class="pg-hint" hidden><span>Drag the orange handle</span> to move the arm. Wheel: depth. Q / E: roll the wrist. C: reset hand mapping.</p>
    <div class="pg-bar" hidden>
      <button class="pg-btn pg-cam" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h3l2-2.5h8L18 8h3v11H3z"/><circle cx="12" cy="13" r="3.6"/></svg><span>Use my webcam</span></button>
      <button class="pg-btn pg-cal" type="button" title="Reset hand mapping (C)" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/></svg><span>Calibrate</span></button>
      <label class="pg-grip"><span>Grip</span><input type="range" min="0" max="100" value="0" aria-label="Close the hand"></label>
      <button class="pg-btn pg-reset" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg><span>Reset</span></button>
    </div>
    <div class="pg-webcam" hidden>
      <video playsinline muted></video>
      <canvas class="pg-lm" aria-hidden="true"></canvas>
      <p class="pg-note">Hand tracking runs on your device. No video is uploaded.</p>
    </div>
    <div class="pg-pose" role="group" aria-label="Reset hand mapping" hidden>
      <svg viewBox="0 0 60 84" aria-hidden="true"><rect x="20" y="18" width="6.5" height="34" rx="3.25"/><rect x="29" y="10" width="6.5" height="42" rx="3.25"/><rect x="38" y="14" width="6.5" height="38" rx="3.25"/><rect x="47" y="23" width="6" height="30" rx="3"/><path d="M20 44h33v16c0 11-7 18-16.5 18S20 71 20 60z"/><rect x="18.75" y="35" width="6.5" height="24" rx="3.25" transform="rotate(-45 22 59)"/></svg>
      <div>
        <p class="pg-pose-title">Hold this pose</p>
        <ul><li>Palm toward the camera</li><li>Fingers straight and together</li><li>Thumb open, about 45&deg; from the fingers</li></ul>
        <p class="pg-pose-key">Press <kbd>C</kbd> in this position</p>
        <p class="pg-pose-esc">Esc to cancel</p>
      </div>
    </div>
    <p class="pg-status" role="status"></p>
    <div class="pg-loading" hidden><span>Loading</span><i><b></b></i></div>`;
  el.appendChild(w);
  const $ = (s) => w.querySelector(s);
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) {  // touch screens: no keyboard, so no Q / E / C
    $('.pg-hint').lastChild.textContent = ' to move the arm. Drag anywhere else to look around.';
    $('.pg-pose-key').textContent = 'Tap Calibrate again in this position';
    $('.pg-pose-esc').hidden = true;
  }
  const status = $('.pg-status'), loadBox = $('.pg-loading'), bar = $('.pg-loading b'), grip = $('.pg-grip input');
  let onStart = () => {}, onWebcam = () => {}, onGrip = () => {}, onReset = () => {}, onCalibrate = () => {};
  let flashT = 0;
  $('.pg-go').addEventListener('click', () => onStart());
  $('.pg-cam').addEventListener('click', () => onWebcam());
  $('.pg-reset').addEventListener('click', () => onReset());
  $('.pg-cal').addEventListener('click', () => onCalibrate());
  grip.addEventListener('input', () => onGrip(grip.value / 100));
  return {
    canvas: $('.pg-canvas'), video: $('.pg-webcam video'),
    onStart: (f) => { onStart = f; }, onWebcam: (f) => { onWebcam = f; }, onGrip: (f) => { onGrip = f; }, onReset: (f) => { onReset = f; }, onCalibrate: (f) => { onCalibrate = f; },
    flash: (msg) => { status.textContent = msg; flashT = performance.now() + 2500; },
    gripValue: () => grip.value / 100, setGrip: (u) => { grip.value = String(Math.round(u * 100)); },
    loading: (msg, u) => { $('.pg-start').hidden = true; loadBox.hidden = false; loadBox.querySelector('span').textContent = msg; bar.style.width = `${Math.round(u * 100)}%`; },
    ready: () => { loadBox.hidden = true; $('.pg-bar').hidden = false; $('.pg-hint').hidden = false; w.classList.add('is-live'); },
    fail: (msg) => { loadBox.hidden = true; $('.pg-start').hidden = true; status.textContent = msg; w.classList.add('is-failed'); },
    dragging: (on) => { w.classList.toggle('is-dragging', on); },
    pose: (on) => { $('.pg-pose').hidden = !on; w.classList.toggle('is-posing', on); },
    webcam: (state, msg) => {
      const on = state === 'on';
      $('.pg-webcam').hidden = !on;
      $('.pg-grip').hidden = on;
      $('.pg-cal').hidden = !on;
      const b = $('.pg-cam'); b.disabled = state === 'loading'; b.classList.toggle('is-on', on);
      b.querySelector('span').textContent = on ? 'Stop webcam' : state === 'loading' ? 'Starting camera…' : 'Use my webcam';
      status.textContent = msg || (on ? 'Hold a hand up to the camera, palm toward it. If the fingers map oddly, press C.' : '');
    },
    tracking: (res) => {
      const c = $('.pg-lm'), v = $('.pg-webcam video');
      if (!v.videoWidth) return;
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
      const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
      if (performance.now() > flashT) status.textContent = res ? '' : 'Hold a hand up to the camera, palm toward it.';
      if (!res) return;
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.fillStyle = '#fff'; g.lineWidth = 2;
      const B = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12], [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]];
      const X = (p) => (1 - p.x) * c.width, Y = (p) => p.y * c.height;
      for (const ch of B) { g.beginPath(); ch.forEach((k, i) => { const p = res.img[k]; if (i) g.lineTo(X(p), Y(p)); else g.moveTo(X(p), Y(p)); }); g.stroke(); }
      for (const p of res.img) { g.beginPath(); g.arc(X(p), Y(p), 3, 0, 7); g.fill(); }
    },
  };
}
