import { Suspense, useRef, useState, Component, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { Group, MathUtils, PointLight } from "three";
import { useReducedMotion } from "motion/react";
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}
function Fallback() {
  return (
    <div className="mic-fallback" aria-label="Studio condenser microphone">
      <div className="mic-head" />
      <div className="mic-body">
        V<span>V O C A L R O O M</span>
      </div>
      <div className="mic-stem" />
    </div>
  );
}
function Microphone({ reduced }: { reduced: boolean }) {
  const group = useRef<Group>(null);
  const ring = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const velocity = useRef({ x: 0, y: 0 });
  useFrame(({ clock, pointer }, delta) => {
    if (!group.current || !ring.current) return;
    const dt = Math.min(delta, 0.04);
    const targetX = reduced ? -0.1 : -0.1 + pointer.y * 0.13;
    const targetY = reduced ? -0.28 : -0.28 + pointer.x * 0.26;
    for (const k of ["x", "y"] as const) {
      velocity.current[k] +=
        ((k === "x" ? targetX : targetY) - group.current.rotation[k]) * 48 * dt;
      velocity.current[k] *= Math.exp(-10 * dt);
      group.current.rotation[k] += velocity.current[k] * dt;
    }
    group.current.position.y = reduced
      ? 0
      : Math.sin(clock.elapsedTime * 0.7) * 0.055;
    ring.current.rotation.z = reduced ? -0.4 : -0.4 + pointer.x * 0.06;
    if (light.current)
      light.current.intensity = MathUtils.damp(
        light.current.intensity,
        15 + Math.abs(pointer.x) * 8,
        4,
        dt,
      );
  });
  const metal = (
    <meshStandardMaterial color="#b2a6ae" metalness={0.95} roughness={0.25} />
  );
  return (
    <>
      <Environment resolution={128}>
        <Lightformer
          position={[3, 2, 3]}
          scale={[3, 6, 1]}
          intensity={5}
          color="#fff5f8"
        />
        <Lightformer
          position={[-3, 0, 2]}
          scale={[2, 5, 1]}
          intensity={4}
          color="#a888ef"
        />
        <Lightformer
          position={[0, 4, -3]}
          scale={[4, 2, 1]}
          intensity={3}
          color="#ed9ec5"
        />
      </Environment>
      <ambientLight intensity={0.4} />
      <pointLight
        ref={light}
        position={[-2, 1, 3]}
        color="#e9a6c2"
        intensity={18}
      />
      <pointLight position={[3, 3, 0]} color="#b9a2d5" intensity={30} />
      <group ref={ring} position={[0, -0.05, -0.3]} rotation={[0.5, 0.3, -0.4]}>
        <mesh scale={[1, 0.72, 1]}>
          <torusGeometry args={[1.65, 0.012, 12, 160]} />
          <meshStandardMaterial
            color="#e9a6c2"
            emissive="#e9a6c2"
            emissiveIntensity={4}
            toneMapped={false}
          />
        </mesh>
        <mesh scale={[1.04, 0.75, 1]}>
          <torusGeometry args={[1.65, 0.003, 8, 160]} />
          <meshBasicMaterial color="#9c7096" transparent opacity={0.45} />
        </mesh>
      </group>
      <group ref={group} rotation={[-0.1, -0.28, -0.13]}>
        <mesh position={[0, 0.75, 0]}>
          <capsuleGeometry args={[0.45, 0.75, 12, 40]} />
          <meshStandardMaterial
            color="#28252c"
            metalness={0.9}
            roughness={0.45}
          />
        </mesh>
        <mesh position={[0, 0.75, 0]}>
          <capsuleGeometry args={[0.453, 0.75, 16, 48]} />
          <meshStandardMaterial
            color="#8b808d"
            metalness={0.8}
            roughness={0.4}
            wireframe
          />
        </mesh>{" "}
        {Array.from({ length: 29 }, (_, i) => (
          <mesh key={i} position={[0, 0.22 + i * 0.047, 0]}>
            <torusGeometry
              args={[
                0.449 *
                  Math.sqrt(
                    Math.max(
                      0.02,
                      1 -
                        Math.pow(
                          Math.max(
                            0,
                            Math.abs(0.22 + i * 0.047 - 0.75) - 0.375,
                          ) / 0.45,
                          2,
                        ),
                    ),
                  ),
                0.009,
                5,
                64,
              ]}
            />
            {metal}
          </mesh>
        ))}
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.sin(a) * 0.446, 0.75, Math.cos(a) * 0.446]}
            >
              <boxGeometry args={[0.007, 0.78, 0.009]} />
              {metal}
            </mesh>
          );
        })}
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.46, 0.46, 0.09, 64]} />
          {metal}
        </mesh>
        <mesh position={[0, -0.48, 0]}>
          <cylinderGeometry args={[0.455, 0.395, 1.08, 64]} />
          <meshStandardMaterial
            color="#27232c"
            metalness={0.86}
            roughness={0.29}
          />
        </mesh>
        <mesh position={[0, -1.03, 0]}>
          <cylinderGeometry args={[0.4, 0.35, 0.08, 64]} />
          {metal}
        </mesh>
        <mesh position={[0, -1.19, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.27, 32]} />
          <meshStandardMaterial
            color="#1d1a22"
            metalness={0.9}
            roughness={0.22}
          />
        </mesh>
        <mesh position={[0, -0.36, 0.451]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.15, 0.15, 0.016]} />
          <meshStandardMaterial
            color="#e9a6c2"
            metalness={0.65}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[0, -0.7, 0.43]}>
          <boxGeometry args={[0.12, 0.018, 0.014]} />
          {metal}
        </mesh>
        <group position={[0, -0.67, 0]}>
          {[-1, 1].map((side) => (
            <group key={side}>
              <RoundedBox
                args={[0.07, 1.13, 0.14]}
                radius={0.03}
                position={[side * 0.67, 0.05, 0]}
                rotation={[0, 0, side * -0.09]}
              >
                <meshStandardMaterial
                  color="#5c515f"
                  metalness={0.9}
                  roughness={0.25}
                />
              </RoundedBox>
              <mesh
                position={[side * 0.53, 0.52, 0]}
                rotation={[0, 0, Math.PI / 2]}
              >
                <cylinderGeometry args={[0.12, 0.12, 0.32, 32]} />
                {metal}
              </mesh>
            </group>
          ))}
          <RoundedBox
            args={[1.35, 0.08, 0.16]}
            radius={0.03}
            position={[0, -0.53, 0]}
          >
            {metal}
          </RoundedBox>
          <mesh position={[0, -0.83, 0]}>
            <cylinderGeometry args={[0.1, 0.13, 0.53, 32]} />
            {metal}
          </mesh>
        </group>
      </group>
    </>
  );
}
export default function MicScene() {
  const reduced = !!useReducedMotion();
  const [supported] = useState(() => {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  });
  return (
    <div
      className="mic-scene"
      role="img"
      aria-label="Interactive metallic condenser microphone with a glowing pink orbit. Move your cursor to rotate it."
    >
      {supported ? (
        <Boundary>
          <Canvas
            camera={{ position: [0, 0, 5.8], fov: 40 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
            frameloop={reduced ? "demand" : "always"}
          >
            <Suspense fallback={null}>
              <Microphone reduced={reduced} />
            </Suspense>
          </Canvas>
        </Boundary>
      ) : (
        <Fallback />
      )}
    </div>
  );
}
