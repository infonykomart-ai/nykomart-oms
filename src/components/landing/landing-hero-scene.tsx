"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// 2026-10-16 — Landing page hero: the rotating wireframe globe with dotted
// trade lanes, i.e. the web/WebGL version of the reference art (glowing
// dotted globe with shipping/air freight around it) the owner sent.
//
// Same house rules as login-hero-scene.tsx (the other 3D scene in this
// app), so the two can't drift apart:
//   - every WebGL entry point is try/caught, so a driver/context failure
//     can only ever mean "no 3D shows up", never a thrown error;
//   - pointer parallax only, never full rotation control;
//   - ResizeObserver + devicePixelRatio capped at 2;
//   - prefers-reduced-motion renders one static frame instead of animating;
//   - every geometry/material/observer/listener is disposed on unmount.
// Additionally this one is PAUSED while it is scrolled out of view
// (IntersectionObserver) and while the tab is hidden — a marketing page has
// no business burning GPU cycles below the fold.
export function LandingHeroScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    try {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      camera.position.set(0, 0, 6.6);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
        failIfMajorPerformanceCaveat: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);

      // Collected so cleanup is one loop instead of a tail of .dispose()
      // calls that a later edit can forget to extend.
      const disposables: { dispose: () => void }[] = [];

      const globe = new THREE.Group();
      scene.add(globe);

      // Dark core so the dots/wireframe read as a solid globe over the
      // page's own gradient, instead of a floating see-through mesh.
      const coreGeo = new THREE.SphereGeometry(2.04, 48, 48);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0x05132c, transparent: true, opacity: 0.9 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      globe.add(core);
      disposables.push(coreGeo, coreMat);

      const wireGeo = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(2.1, 3));
      const wireMat = new THREE.LineBasicMaterial({ color: 0x4f8ff7, transparent: true, opacity: 0.22 });
      globe.add(new THREE.LineSegments(wireGeo, wireMat));
      disposables.push(wireGeo, wireMat);

      // Dotted surface — Fibonacci-sphere distribution, so the dots are
      // evenly spread (no polar clumping) exactly like the reference art.
      const DOT_COUNT = 1400;
      const dotPositions = new Float32Array(DOT_COUNT * 3);
      for (let i = 0; i < DOT_COUNT; i++) {
        const y = 1 - (i / (DOT_COUNT - 1)) * 2;
        const radius = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = i * 2.399963229728653;
        dotPositions[i * 3] = Math.cos(theta) * radius * 2.11;
        dotPositions[i * 3 + 1] = y * 2.11;
        dotPositions[i * 3 + 2] = Math.sin(theta) * radius * 2.11;
      }
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPositions, 3));
      const dotMat = new THREE.PointsMaterial({
        color: 0x8ed6ff,
        size: 0.035,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      });
      globe.add(new THREE.Points(dotGeo, dotMat));
      disposables.push(dotGeo, dotMat);

      // Orbit lanes: two cool + one amber (the brand's own blue/orange pair),
      // each carrying a travelling marker so the scene reads as "traffic
      // moving between marketplaces", not a decorative spinning ball.
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xd8f2ff });
      disposables.push(markerMat);
      const accents = [0x38bdf8, 0xffb020, 0x6ea8ff];
      const lanes: { radius: number; marker: THREE.Mesh; speed: number; phase: number }[] = [];
      for (let i = 0; i < 3; i++) {
        const radius = 2.55 + i * 0.4;
        const ringGeo = new THREE.TorusGeometry(radius, 0.0055, 6, 160);
        const ringMat = new THREE.MeshBasicMaterial({ color: accents[i], transparent: true, opacity: i === 1 ? 0.55 : 0.34 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.set(Math.PI / 2.35 + i * 0.22, i * 0.42, i * 0.16);
        globe.add(ring);
        disposables.push(ringGeo, ringMat);

        const markerGeo = new THREE.SphereGeometry(0.052 + i * 0.012, 16, 16);
        const marker = new THREE.Mesh(markerGeo, markerMat);
        disposables.push(markerGeo);
        // Child of the lane, so the marker inherits the lane's tilt and only
        // its angle along the ring has to be animated.
        ring.add(marker);
        lanes.push({ radius, marker, speed: 0.32 + i * 0.19, phase: i * 2.05 });
      }

      const pointer = { x: 0, y: 0 };
      const handlePointerMove = (event: PointerEvent) => {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
      };
      window.addEventListener("pointermove", handlePointerMove);

      const resize = () => {
        const { clientWidth, clientHeight } = container;
        if (clientWidth === 0 || clientHeight === 0) return;
        camera.aspect = clientWidth / clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(clientWidth, clientHeight, false);
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      let inView = true;
      const visibility = new IntersectionObserver(
        (entries) => {
          inView = entries[0]?.isIntersecting ?? true;
        },
        { threshold: 0.02 }
      );
      visibility.observe(container);

      let frameId = 0;
      let disposed = false;
      let angle = 0;
      const clock = new THREE.Clock();

      const renderFrame = () => {
        if (disposed) return;
        try {
          const delta = Math.min(clock.getDelta(), 0.05);
          if (!prefersReducedMotion && inView && !document.hidden) {
            angle += delta * 0.16;
            globe.rotation.y = angle;
            globe.rotation.x = -0.12 + Math.sin(angle * 0.7) * 0.05;
            for (const lane of lanes) {
              const a = angle * lane.speed * 3 + lane.phase;
              lane.marker.position.set(Math.cos(a) * lane.radius, Math.sin(a) * lane.radius, 0);
            }
          }
          // Parallax is applied to the CAMERA, never to the globe's own
          // rotation, so an idle mouse still leaves the spin uninterrupted.
          camera.position.x += (pointer.x * 0.85 - camera.position.x) * 0.045;
          camera.position.y += (-pointer.y * 0.55 - camera.position.y) * 0.045;
          camera.lookAt(0, 0, 0);

          renderer.render(scene, camera);
          frameId = requestAnimationFrame(renderFrame);
        } catch (err) {
          console.error("LandingHeroScene: render loop stopped:", err);
          disposed = true;
        }
      };
      frameId = requestAnimationFrame(renderFrame);

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        visibility.disconnect();
        window.removeEventListener("pointermove", handlePointerMove);
        try {
          container.removeChild(renderer.domElement);
        } catch {
          // already detached — fine
        }
        for (const item of disposables) item.dispose();
        renderer.dispose();
      };
    } catch (err) {
      console.error("LandingHeroScene: could not initialize, skipping decorative 3D:", err);
      return undefined;
    }
  }, []);

  return <div ref={containerRef} className="size-full" aria-hidden="true" role="presentation" />;
}
