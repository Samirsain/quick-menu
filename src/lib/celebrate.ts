// Full-screen 3D confetti burst (three.js). three is imported lazily so it never weighs down the first menu load.
// Fire-and-forget: the overlay ignores clicks and removes/disposes itself when done.

const COLORS = [0xc8a24a, 0x1c1917, 0xf5f0e6, 0xa8a29e, 0xe2c275]; // gold, ink, ivory, stone - matches the menu palette
const COUNT = 110;
const DURATION = 2.6; // seconds
const GRAVITY = -16;

let running = false;

export async function celebrate() {
  if (running || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  running = true;
  try {
    const THREE = await import("three");
    const w = window.innerWidth, h = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    Object.assign(renderer.domElement.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "300" });
    renderer.domElement.setAttribute("aria-hidden", "true");
    document.body.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    camera.position.z = 10;
    const halfH = Math.tan((25 * Math.PI) / 180) * 10; // visible half-height at z=0
    const halfW = halfH * (w / h);

    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 4, 6);
    scene.add(sun);

    const geo = new THREE.PlaneGeometry(0.16, 0.26);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, transparent: true, roughness: 0.5, metalness: 0.2 });
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    scene.add(mesh);

    const color = new THREE.Color();
    const parts = Array.from({ length: COUNT }, (_, i) => {
      mesh.setColorAt(i, color.setHex(COLORS[i % COLORS.length]));
      const side = i % 2 ? 1 : -1; // two cannons from the bottom corners, aimed inward
      return {
        p: new THREE.Vector3(side * halfW * 0.9, -halfH - 0.5, (Math.random() - 0.5) * 3),
        v: new THREE.Vector3(-side * (2 + Math.random() * 5), 12 + Math.random() * 7, (Math.random() - 0.5) * 3),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 4),
      };
    });

    const dummy = new THREE.Object3D();
    const start = performance.now();
    let last = start;

    await new Promise<void>((done) => {
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 1 / 30); // capped so a stalled frame doesn't teleport pieces
        last = now;
        const t = (now - start) / 1000; // wall clock, so slow GPUs still finish on time
        for (let i = 0; i < COUNT; i++) {
          const q = parts[i];
          q.v.y += GRAVITY * dt;
          q.v.multiplyScalar(0.985); // air drag so pieces flutter down instead of dropping
          q.p.addScaledVector(q.v, dt);
          q.r.x += q.spin.x * dt; q.r.y += q.spin.y * dt; q.r.z += q.spin.z * dt;
          dummy.position.copy(q.p);
          dummy.rotation.copy(q.r);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mat.opacity = Math.min(1, (DURATION - t) / 0.6);
        renderer.render(scene, camera);
        if (t >= DURATION) done();
      });
    });

    renderer.setAnimationLoop(null);
    geo.dispose();
    mat.dispose();
    mesh.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  } catch {
    // No WebGL (old phone, blocked GPU) - confetti is decoration, skip silently
  } finally {
    running = false;
  }
}
