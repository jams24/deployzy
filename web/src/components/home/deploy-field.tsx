"use client";

import * as React from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

/**
 * The deploy field: a round island of container blocks seen from above. Blocks
 * breathe on slow noise; every few seconds a deploy lands somewhere and a ring
 * of light rolls outward, lifting and lighting the blocks it passes (green to
 * cyan, the logo colours). Pointer hover raises the blocks under it; a click
 * or tap fires a deploy right there.
 *
 * One draw call: an instanced box whose height, colour and lighting are all
 * computed in the shaders, so the CPU only updates a few uniforms per frame.
 */

const PULSES = 4;
const PULSE_LIFE = 5.5; // seconds a ring travels before fading
const PULSE_SPEED = 7.5; // cells per second

const vertex = /* glsl */ `
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uPointerOn;
  uniform vec2 uPulse[${PULSES}];
  uniform float uPulseT[${PULSES}];
  uniform float uRadius;
  attribute vec2 aCell;
  attribute float aSeed;
  varying float vShade;
  varying float vTop;
  varying float vLift;
  varying float vSeed;
  varying float vDist;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    float base = 0.2 + 0.95 * pow(noise(aCell * 0.15 + vec2(uTime * 0.06, uTime * 0.035)), 1.6);
    base += 0.18 * noise(aCell * 0.6 - uTime * 0.02);

    float lift = 0.0;
    for (int i = 0; i < ${PULSES}; i++) {
      float age = uTime - uPulseT[i];
      if (age > 0.0 && age < ${PULSE_LIFE.toFixed(1)}) {
        float d = distance(aCell, uPulse[i]);
        float front = age * ${PULSE_SPEED.toFixed(1)};
        float band = exp(-pow((d - front) * 0.6, 2.0));
        // The landing cell itself flashes first.
        band = max(band, exp(-d * d * 0.8) * smoothstep(0.9, 0.0, age));
        lift = max(lift, band * (1.0 - age / ${PULSE_LIFE.toFixed(1)}));
      }
    }
    float pd = distance(aCell, uPointer);
    lift = max(lift, uPointerOn * 0.85 * exp(-pd * pd * 0.035));

    vec3 p = position;
    p.y *= base + lift * 1.7;
    p.xz += aCell;

    // Fake directional light: tops bright, one side mid, the other dark.
    vShade = normal.y > 0.5 ? 1.0 : (abs(normal.x) > 0.5 ? (normal.x > 0.0 ? 0.62 : 0.4) : (normal.z > 0.0 ? 0.5 : 0.34));
    vTop = step(0.5, normal.y);
    vLift = lift;
    vSeed = aSeed;
    vDist = length(aCell) / uRadius;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTopCol;
  uniform vec3 uSideCol;
  uniform vec3 uGreen;
  uniform vec3 uCyan;
  uniform vec3 uBg;
  varying float vShade;
  varying float vTop;
  varying float vLift;
  varying float vSeed;
  varying float vDist;
  varying vec2 vUv;

  void main() {
    vec3 col = mix(uSideCol, uTopCol, vTop) * vShade;

    // Hairline rim on the top face so each block reads as a tile.
    vec2 e = abs(vUv - 0.5) * 2.0;
    float rim = smoothstep(0.86, 0.98, max(e.x, e.y)) * vTop;
    col += rim * 0.1;

    vec3 lit = mix(uGreen, uCyan, smoothstep(0.2, 0.9, vSeed));
    float glow = smoothstep(0.04, 0.55, vLift);
    col = mix(col, lit * mix(0.5, 1.15, vTop) + rim * lit * 0.4, glow);

    // A few blocks are "live" apps: a status light that breathes.
    float led = step(0.955, vSeed) * vTop * (0.55 + 0.45 * sin(uTime * 1.7 + vSeed * 60.0));
    col = mix(col, uGreen * 1.1, led * 0.75 * (1.0 - glow));

    // Fade into the card at the island's edge.
    col = mix(col, uBg, smoothstep(0.55, 1.0, vDist));
    gl_FragColor = vec4(col, 1.0);
  }
`;

type FieldProps = {
  grid: number;
  reduce: boolean;
  onDeploy?: (byVisitor: boolean) => void;
  eventRef?: React.RefObject<HTMLElement | null>;
};

function Field({ grid, reduce, onDeploy, eventRef }: FieldProps) {
  const material = React.useRef<THREE.ShaderMaterial>(null);
  const group = React.useRef<THREE.Group>(null);
  const { camera, gl } = useThree();
  const pointer = React.useRef({ ndc: new THREE.Vector2(), on: 0, target: 0, has: false });
  const nextPulse = React.useRef(0);
  const pulseSlot = React.useRef(0);
  const clicks = React.useRef<THREE.Vector2[]>([]);
  const radius = grid / 2;

  const geometry = React.useMemo(() => {
    const box = new THREE.BoxGeometry(0.84, 1, 0.84);
    box.translate(0, 0.5, 0);
    const cells: number[] = [];
    const seeds: number[] = [];
    for (let x = 0; x < grid; x++) {
      for (let z = 0; z < grid; z++) {
        const cx = x - (grid - 1) / 2;
        const cz = z - (grid - 1) / 2;
        if (Math.hypot(cx, cz) > radius) continue;
        cells.push(cx, cz);
        // Stable hash instead of Math.random: same field on every load, pure render.
        const h = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453;
        seeds.push(h - Math.floor(h));
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index;
    g.setAttribute("position", box.getAttribute("position"));
    g.setAttribute("normal", box.getAttribute("normal"));
    g.setAttribute("uv", box.getAttribute("uv"));
    g.setAttribute("aCell", new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    g.instanceCount = seeds.length;
    return g;
  }, [grid, radius]);

  const uniforms = React.useMemo(
    () => ({
      uTime: { value: reduce ? 14 : 0 },
      uPointer: { value: new THREE.Vector2(999, 999) },
      uPointerOn: { value: 0 },
      uPulse: { value: Array.from({ length: PULSES }, () => new THREE.Vector2()) },
      uPulseT: { value: Array.from({ length: PULSES }, () => -100) },
      uRadius: { value: radius },
      uTopCol: { value: new THREE.Color("#252a35") },
      uSideCol: { value: new THREE.Color("#161a21") },
      uGreen: { value: new THREE.Color("#34d399") },
      uCyan: { value: new THREE.Color("#22d3ee") },
      uBg: { value: new THREE.Color("#0b0c10") },
    }),
    [radius, reduce],
  );

  React.useEffect(() => () => geometry.dispose(), [geometry]);

  // Pointer: track over the canvas; a click/tap fires a deploy at that cell.
  React.useEffect(() => {
    if (reduce) return;
    // Listen on the whole hero, not the canvas: the headline sits on top of it.
    const el = eventRef?.current ?? gl.domElement;
    const toNdc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const move = (e: PointerEvent) => {
      toNdc(e);
      pointer.current.has = true;
      pointer.current.target = e.pointerType === "mouse" ? 1 : 0;
    };
    const leave = () => {
      pointer.current.target = 0;
    };
    const down = (e: PointerEvent) => {
      // Ignore presses on links, buttons and draggable chips layered on top.
      if ((e.target as HTMLElement).closest("a,button,input,[data-no-deploy]")) return;
      toNdc(e);
      clicks.current.push(pointer.current.ndc.clone());
    };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down);
    };
  }, [gl, reduce, eventRef]);

  const raycaster = React.useMemo(() => new THREE.Raycaster(), []);
  const plane = React.useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4), []);
  const hit = React.useMemo(() => new THREE.Vector3(), []);

  const toCell = React.useCallback(
    (ndc: THREE.Vector2): THREE.Vector2 | null => {
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, hit) || !group.current) return null;
      const local = group.current.worldToLocal(hit.clone());
      return new THREE.Vector2(local.x, local.z);
    },
    [camera, hit, plane, raycaster],
  );

  const fire = React.useCallback(
    (at: THREE.Vector2, t: number, byVisitor: boolean) => {
      const m = material.current;
      if (!m) return;
      const i = pulseSlot.current++ % PULSES;
      (m.uniforms.uPulse.value as THREE.Vector2[])[i].copy(at);
      (m.uniforms.uPulseT.value as number[])[i] = t;
      onDeploy?.(byVisitor);
    },
    [onDeploy],
  );

  useFrame((_, delta) => {
    const m = material.current;
    const g = group.current;
    if (!m || !g || reduce) return;
    const t = (m.uniforms.uTime.value += Math.min(delta, 0.05));

    // Slow turn, plus a gentle tilt toward the pointer.
    g.rotation.y = t * 0.035;
    const p = pointer.current;
    g.rotation.x += ((p.has ? p.ndc.y * 0.04 : 0) - g.rotation.x) * 0.04;

    p.on += (p.target - p.on) * 0.08;
    m.uniforms.uPointerOn.value = p.on;
    if (p.has) {
      const c = toCell(p.ndc);
      if (c) (m.uniforms.uPointer.value as THREE.Vector2).lerp(c, 0.25);
    }

    for (const ndc of clicks.current.splice(0)) {
      const c = toCell(ndc);
      if (c && c.length() < radius) fire(c, t, true);
    }
    if (t > nextPulse.current) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius * 0.6;
      fire(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r), t, false);
      nextPulse.current = t + 1.8 + Math.random() * 1.6;
    }
  });

  // Reduced motion: one frozen frame with a ring mid-flight.
  React.useEffect(() => {
    if (!reduce || !material.current) return;
    (material.current.uniforms.uPulseT.value as number[])[0] = 12.6;
  }, [reduce]);

  return (
    <group ref={group} rotation={[0, 0.5, 0]}>
      <mesh geometry={geometry} frustumCulled={false}>
        <shaderMaterial ref={material} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} />
      </mesh>
    </group>
  );
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function DeployField({
  className,
  onDeploy,
  eventRef,
}: {
  className?: string;
  onDeploy?: (byVisitor: boolean) => void;
  eventRef?: React.RefObject<HTMLElement | null>;
}) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<{ ok: boolean; reduce: boolean; small: boolean } | null>(null);
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    setState({
      ok: hasWebGL(),
      reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      small: window.matchMedia("(max-width: 640px)").matches,
    });
    const el = wrap.current;
    if (!el) return;
    // Stop rendering when the hero is scrolled out of view.
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className={className} aria-hidden>
      {state?.ok && (
        <Canvas
          dpr={state.small ? [1, 1.5] : [1, 1.75]}
          frameloop={state.reduce ? "demand" : visible ? "always" : "never"}
          // Low camera: the island reads as a skyline under the headline.
          camera={{ position: [0, state.small ? 11 : 10, state.small ? 33 : 31], fov: state.small ? 50 : 34, near: 0.5, far: 140 }}
          onCreated={({ camera }) => camera.lookAt(0, state.small ? 3.2 : 4, 0)}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        >
          <Field grid={state.small ? 30 : 44} reduce={state.reduce} onDeploy={onDeploy} eventRef={eventRef} />
        </Canvas>
      )}
    </div>
  );
}
