/**
 * Interactive 3D slot: intentionally empty.
 *
 * index.html reserves <div id="viewer-3d" class="viewer-3d is-empty"> (16:9) in the
 * middle of the page. main.js imports this module when the slot scrolls near the
 * viewport and calls mount(slot). Until mount() puts something in the slot, the
 * "coming soon" placeholder stays visible.
 *
 * Contract
 *   - Append your canvas / iframe / custom element to `el`. CSS stretches a direct
 *     <canvas> or <iframe> child to fill the box.
 *   - Remove the "is-empty" class once the viewer is in place (this hides the
 *     placeholder and the dashed border).
 *   - Size from el.clientWidth / el.clientHeight and keep up with a ResizeObserver.
 *   - To use a different file, change data-module on #viewer-3d in index.html.
 *
 * Example (three.js + a glTF export of the robot), kept commented out:
 *
 *   const V = '0.165.0';
 *   const THREE = await import(`https://cdn.jsdelivr.net/npm/three@${V}/+esm`);
 *   const { OrbitControls } = await import(`https://cdn.jsdelivr.net/npm/three@${V}/examples/jsm/controls/OrbitControls.js/+esm`);
 *   const { GLTFLoader } = await import(`https://cdn.jsdelivr.net/npm/three@${V}/examples/jsm/loaders/GLTFLoader.js/+esm`);
 *
 *   const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
 *   renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
 *   const scene = new THREE.Scene();
 *   const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 50);
 *   camera.position.set(1.2, 0.9, 1.4);
 *   scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.2));
 *   const controls = new OrbitControls(camera, renderer.domElement);
 *   controls.enableDamping = true;
 *   const gltf = await new GLTFLoader().loadAsync('static/models/dexdirect.glb');
 *   scene.add(gltf.scene);
 *
 *   const fit = () => {
 *     const w = el.clientWidth, h = el.clientHeight;
 *     renderer.setSize(w, h, false);
 *     camera.aspect = w / h;
 *     camera.updateProjectionMatrix();
 *   };
 *   new ResizeObserver(fit).observe(el);
 *   fit();
 *   el.replaceChildren(renderer.domElement);
 *   el.classList.remove('is-empty');
 *   renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
 */
export async function mount(el) {
  // Intentionally empty: drop the interactive 3D viewer in here.
  void el;
}
