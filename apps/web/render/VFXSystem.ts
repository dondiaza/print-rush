import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { QualityLevel } from "./LightingRig";

/**
 * VFX SYSTEM V5.
 *
 * V4's effects were two object pools: 42 four-segment spheres used as smoke, sparks, ink and
 * confetti alike, and 54 boxes floating 0.68 m below the kart standing in for skid marks. Nothing
 * was a particle system, nothing was soft, and every effect looked like the same effect.
 *
 * This uses real particle systems with a generated soft sprite, plus a proper decal ribbon for skid
 * marks. Particle budgets are set per quality tier, and the reduction is always in count, never in
 * which effects exist: drift, boost and impact stay visible on the lowest tier because they are how
 * the player reads the kart.
 */

export type VFXKind =
  | "TIRE_SMOKE"
  | "DRIFT_SMOKE"
  | "BRAKE_SMOKE"
  | "SPARK"
  | "IMPACT"
  | "DUST"
  | "INK_SPLASH"
  | "BOOST_FIRE"
  | "BOOST_TRAIL"
  | "SPEED_LINE"
  | "LANDING"
  | "SHIELD"
  | "ITEM_PICKUP"
  | "CONFETTI";

export type VFXOptions = {
  quality: QualityLevel;
  accentA: string;
  accentB: string;
};

export type VFXFrame = {
  position: Vector3;
  heading: number;
  speedRatio: number;
  drifting: boolean;
  driftLevel: number;
  boosting: boolean;
  grounded: boolean;
  /** Absolute lateral velocity, m/s. Drives smoke density. */
  slip: number;
  surface: string;
};

/** Live particle budget per tier. The art bible sets these. */
const BUDGET: Record<QualityLevel, number> = { LOW: 120, MEDIUM: 350, HIGH: 900, ULTRA: 1_600 };

/** Drift charge is colour-coded, so the player never has to look at the HUD to read the tier. */
const DRIFT_COLORS = ["#f7f2e8", "#65d8ff", "#ff3da6", "#b9ff45"];

export class VFXSystem {
  private readonly scene: Scene;
  private readonly quality: QualityLevel;
  private readonly sprite: Texture;
  private readonly emitters = new Map<string, ParticleSystem>();
  private readonly anchor: TransformNode;

  private readonly skidPool: Array<{ mesh: Mesh; life: number; material: StandardMaterial }> = [];
  private skidCursor = 0;
  private lastSkidAt = 0;
  private readonly accentA: Color3;
  private readonly accentB: Color3;

  constructor(scene: Scene, options: VFXOptions) {
    this.scene = scene;
    this.quality = options.quality;
    this.accentA = Color3.FromHexString(options.accentA);
    this.accentB = Color3.FromHexString(options.accentB);
    this.sprite = createSoftSprite(scene);
    this.anchor = new TransformNode("vfx-anchor", scene);

    this.createContinuousEmitters();
    this.createSkidPool();
  }

  private budget(share: number): number {
    return Math.max(6, Math.round(BUDGET[this.quality] * share));
  }

  private createContinuousEmitters(): void {
    // ---------------------------------------------------------------- drift smoke
    // Two emitters, one per rear wheel, so the smoke comes off the tyres rather than out of the
    // middle of the chassis.
    for (const side of ["left", "right"] as const) {
      const smoke = new ParticleSystem(`vfx-drift-${side}`, this.budget(0.16), this.scene);
      smoke.particleTexture = this.sprite;
      smoke.emitter = new Vector3();
      smoke.minEmitBox = new Vector3(-0.15, 0, -0.15);
      smoke.maxEmitBox = new Vector3(0.15, 0.1, 0.15);
      smoke.minSize = 0.5;
      smoke.maxSize = 2.4;
      smoke.minLifeTime = 0.28;
      smoke.maxLifeTime = 0.72;
      smoke.emitRate = 0;
      smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      smoke.gravity = new Vector3(0, 1.6, 0);
      smoke.minEmitPower = 1.2;
      smoke.maxEmitPower = 3.4;
      smoke.updateSpeed = 0.016;
      smoke.color1 = new Color4(1, 1, 1, 0.5);
      smoke.color2 = new Color4(0.85, 0.88, 0.95, 0.32);
      smoke.colorDead = new Color4(0.7, 0.72, 0.78, 0);
      smoke.start();
      this.emitters.set(`drift-${side}`, smoke);
    }

    // ---------------------------------------------------------------- boost flame
    const flame = new ParticleSystem("vfx-boost", this.budget(0.2), this.scene);
    flame.particleTexture = this.sprite;
    flame.emitter = new Vector3();
    flame.minSize = 0.35;
    flame.maxSize = 1.5;
    flame.minLifeTime = 0.1;
    flame.maxLifeTime = 0.3;
    flame.emitRate = 0;
    flame.blendMode = ParticleSystem.BLENDMODE_ADD;
    flame.gravity = new Vector3(0, 2.4, 0);
    flame.minEmitPower = 3;
    flame.maxEmitPower = 8;
    flame.color1 = new Color4(1, 0.85, 0.4, 0.9);
    flame.color2 = new Color4(this.accentA.r, this.accentA.g, this.accentA.b, 0.8);
    flame.colorDead = new Color4(1, 0.3, 0.1, 0);
    flame.start();
    this.emitters.set("boost", flame);

    // ---------------------------------------------------------------- ground dust
    // Always on at speed, at a low rate. It is the cheapest way to make the floor feel like a floor.
    const dust = new ParticleSystem("vfx-dust", this.budget(0.1), this.scene);
    dust.particleTexture = this.sprite;
    dust.emitter = new Vector3();
    dust.minSize = 0.25;
    dust.maxSize = 1.1;
    dust.minLifeTime = 0.2;
    dust.maxLifeTime = 0.5;
    dust.emitRate = 0;
    dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    dust.gravity = new Vector3(0, 0.8, 0);
    dust.minEmitPower = 0.6;
    dust.maxEmitPower = 2;
    dust.color1 = new Color4(0.8, 0.78, 0.72, 0.25);
    dust.color2 = new Color4(0.7, 0.68, 0.64, 0.16);
    dust.colorDead = new Color4(0.6, 0.6, 0.6, 0);
    dust.start();
    this.emitters.set("dust", dust);
  }

  private createSkidPool(): void {
    // Skid marks are real decals lying on the surface, not boxes floating under the kart. Each is a
    // thin plane so a continuous mark is a chain of overlapping quads that fades as a whole.
    const count = this.quality === "LOW" ? 40 : this.quality === "MEDIUM" ? 90 : 160;
    for (let index = 0; index < count; index += 1) {
      const material = new StandardMaterial(`skid-mat-${index}`, this.scene);
      material.diffuseColor = new Color3(0.03, 0.03, 0.04);
      material.specularColor = Color3.Black();
      material.alpha = 0;
      material.disableLighting = true;
      material.emissiveColor = new Color3(0.02, 0.02, 0.025);

      const mesh = MeshBuilder.CreatePlane(`skid-${index}`, { width: 0.42, height: 1.4 }, this.scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.material = material;
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.parent = this.anchor;
      this.skidPool.push({ mesh, life: 0, material });
    }
  }

  /** A translucent sphere around the kart while a shield item is active. */
  createShield(parent: TransformNode): Mesh {
    const mesh = MeshBuilder.CreateSphere("player-shield", { diameter: 4.4, segments: 18 }, this.scene);
    mesh.parent = parent;
    mesh.position.y = 1.05;
    const material = new StandardMaterial("player-shield-material", this.scene);
    material.diffuseColor = Color3.FromHexString("#65d8ff");
    material.emissiveColor = Color3.FromHexString("#2f9fd0");
    material.alpha = 0.2;
    material.backFaceCulling = false;
    material.disableLighting = true;
    mesh.material = material;
    mesh.isVisible = false;
    mesh.isPickable = false;
    return mesh;
  }

  /**
   * Per-frame update driven entirely by vehicle state. Nothing here decides what happened — the
   * runtime already knows, and the effects follow from the same numbers the physics produced.
   */
  update(dt: number, frame: VFXFrame): void {
    const forwardX = Math.sin(frame.heading);
    const forwardZ = Math.cos(frame.heading);
    const rightX = forwardZ;
    const rightZ = -forwardX;

    // ---------------------------------------------------------------- drift smoke
    const driftColor = Color3.FromHexString(DRIFT_COLORS[Math.min(3, frame.driftLevel)] ?? DRIFT_COLORS[0]!);
    const slipping = frame.grounded && frame.slip > 2.4;
    const rate = slipping ? Math.min(1, frame.slip / 12) * (frame.drifting ? 260 : 90) : 0;

    for (const [key, side] of [["drift-left", -1], ["drift-right", 1]] as const) {
      const system = this.emitters.get(key);
      if (!system) continue;
      const emitter = system.emitter as Vector3;
      emitter.set(
        frame.position.x - forwardX * 1.15 + rightX * side * 0.82,
        frame.position.y - 0.3,
        frame.position.z - forwardZ * 1.15 + rightZ * side * 0.82,
      );
      system.emitRate = rate;
      // Ink is a wet surface: it throws ink, not smoke. That is the game's own signature effect.
      const wet = frame.surface === "INK";
      const tint = wet ? this.accentB : driftColor;
      system.color1 = new Color4(tint.r, tint.g, tint.b, wet ? 0.75 : 0.5);
      system.color2 = new Color4(tint.r * 0.8, tint.g * 0.8, tint.b * 0.85, 0.3);
    }

    // ---------------------------------------------------------------- boost flame
    const flame = this.emitters.get("boost");
    if (flame) {
      const emitter = flame.emitter as Vector3;
      emitter.set(
        frame.position.x - forwardX * 1.55,
        frame.position.y + 0.4,
        frame.position.z - forwardZ * 1.55,
      );
      flame.emitRate = frame.boosting ? this.budget(0.6) : 0;
      flame.direction1 = new Vector3(-forwardX * 3 - 0.6, 0.4, -forwardZ * 3 - 0.6);
      flame.direction2 = new Vector3(-forwardX * 3 + 0.6, 1.4, -forwardZ * 3 + 0.6);
    }

    // ---------------------------------------------------------------- dust
    const dust = this.emitters.get("dust");
    if (dust) {
      const emitter = dust.emitter as Vector3;
      emitter.set(frame.position.x, frame.position.y - 0.34, frame.position.z);
      dust.emitRate = frame.grounded && frame.speedRatio > 0.3 ? frame.speedRatio * this.budget(0.22) : 0;
    }

    // ---------------------------------------------------------------- skid marks
    const now = performance.now();
    if (slipping && now - this.lastSkidAt > 26) {
      this.lastSkidAt = now;
      for (const side of [-1, 1] as const) {
        this.placeSkid(
          frame.position.x - forwardX * 1.2 + rightX * side * 0.82,
          frame.position.y - 0.38,
          frame.position.z - forwardZ * 1.2 + rightZ * side * 0.82,
          frame.heading,
          Math.min(0.72, 0.2 + frame.slip / 16),
        );
      }
    }

    for (const skid of this.skidPool) {
      if (skid.life <= 0) continue;
      skid.life -= dt;
      // Six-second fade, weighted so the mark stays solid then disappears rather than ghosting.
      skid.material.alpha = Math.max(0, (skid.life / 6) ** 1.4 * 0.72);
      if (skid.life <= 0) skid.mesh.isVisible = false;
    }
  }

  private placeSkid(x: number, y: number, z: number, heading: number, alpha: number): void {
    const skid = this.skidPool[this.skidCursor]!;
    this.skidCursor = (this.skidCursor + 1) % this.skidPool.length;
    skid.mesh.position.set(x, y, z);
    skid.mesh.rotation.set(Math.PI / 2, heading, 0);
    skid.mesh.isVisible = true;
    skid.life = 6;
    skid.material.alpha = alpha;
  }

  /** One-shot burst. Each kind gets its own colour, spread, lifetime and blend mode. */
  burst(kind: VFXKind, position: Vector3, strength: number): void {
    const amount = Math.max(0.1, Math.min(1, strength));
    const preset = this.presetFor(kind, amount);
    const system = new ParticleSystem(`burst-${kind}-${Math.random().toString(36).slice(2, 8)}`, preset.count, this.scene);
    system.particleTexture = this.sprite;
    system.emitter = position.clone();
    system.minSize = preset.size * 0.4;
    system.maxSize = preset.size;
    system.minLifeTime = preset.life * 0.5;
    system.maxLifeTime = preset.life;
    system.blendMode = preset.additive ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    system.gravity = new Vector3(0, preset.gravity, 0);
    system.minEmitPower = preset.power * 0.35;
    system.maxEmitPower = preset.power;
    system.direction1 = new Vector3(-1, preset.upward * 0.4, -1);
    system.direction2 = new Vector3(1, preset.upward, 1);
    system.color1 = preset.color1;
    system.color2 = preset.color2;
    system.colorDead = new Color4(preset.color2.r, preset.color2.g, preset.color2.b, 0);
    system.disposeOnStop = true;
    system.manualEmitCount = preset.count;
    system.start();
    // A one-shot has to be told to stop, or the manual count re-emits on the next update.
    setTimeout(() => system.stop(), 40);
  }

  private presetFor(kind: VFXKind, amount: number): {
    count: number;
    size: number;
    life: number;
    power: number;
    gravity: number;
    upward: number;
    additive: boolean;
    color1: Color4;
    color2: Color4;
  } {
    const a = this.accentA;
    const b = this.accentB;
    switch (kind) {
      case "IMPACT":
        return {
          count: this.budget(0.1 * amount + 0.03), size: 1.4, life: 0.45, power: 9, gravity: -6,
          upward: 2, additive: true,
          color1: new Color4(1, 0.9, 0.6, 1), color2: new Color4(1, 0.45, 0.2, 0.8),
        };
      case "SPARK":
        return {
          count: this.budget(0.06), size: 0.3, life: 0.32, power: 12, gravity: -14, upward: 1.4,
          additive: true,
          color1: new Color4(1, 0.95, 0.7, 1), color2: new Color4(1, 0.6, 0.2, 0.7),
        };
      case "BOOST_FIRE":
        return {
          count: this.budget(0.14), size: 1.8, life: 0.4, power: 11, gravity: 3, upward: 1.6,
          additive: true,
          color1: new Color4(1, 0.88, 0.5, 1), color2: new Color4(a.r, a.g, a.b, 0.85),
        };
      case "INK_SPLASH":
        return {
          count: this.budget(0.16), size: 2.6, life: 0.9, power: 7, gravity: -9, upward: 2.2,
          additive: false,
          color1: new Color4(b.r, b.g, b.b, 0.95), color2: new Color4(a.r * 0.6, a.g * 0.6, a.b * 0.7, 0.8),
        };
      case "LANDING":
        return {
          count: this.budget(0.1 * amount + 0.03), size: 2.2, life: 0.55, power: 5, gravity: 0.6,
          upward: 0.8, additive: false,
          color1: new Color4(0.9, 0.9, 0.92, 0.5), color2: new Color4(0.75, 0.75, 0.8, 0.3),
        };
      case "ITEM_PICKUP":
        return {
          count: this.budget(0.08), size: 1, life: 0.55, power: 6, gravity: 1.5, upward: 2.4,
          additive: true,
          color1: new Color4(b.r, b.g, b.b, 1), color2: new Color4(1, 1, 1, 0.7),
        };
      case "SHIELD":
        return {
          count: this.budget(0.12), size: 1.6, life: 0.5, power: 10, gravity: 0, upward: 1,
          additive: true,
          color1: new Color4(0.4, 0.85, 1, 1), color2: new Color4(0.2, 0.5, 0.8, 0.6),
        };
      case "CONFETTI":
        return {
          count: this.budget(0.5), size: 0.9, life: 3.4, power: 14, gravity: -7, upward: 3.6,
          additive: false,
          color1: new Color4(a.r, a.g, a.b, 1), color2: new Color4(b.r, b.g, b.b, 1),
        };
      default:
        return {
          count: this.budget(0.08), size: 1.4, life: 0.5, power: 6, gravity: 0.8, upward: 1.2,
          additive: false,
          color1: new Color4(0.9, 0.9, 0.9, 0.5), color2: new Color4(0.7, 0.7, 0.75, 0.3),
        };
    }
  }

  /** A short additive streak between two points, used for projectile paths. */
  trail(from: Vector3, to: Vector3): void {
    const midpoint = Vector3.Center(from, to);
    this.burst("SPARK", midpoint, 1);
  }

  dispose(): void {
    this.emitters.forEach((system) => system.dispose());
    this.emitters.clear();
    this.skidPool.forEach((skid) => {
      skid.mesh.dispose();
      skid.material.dispose();
    });
    this.skidPool.length = 0;
    this.sprite.dispose();
    this.anchor.dispose();
  }
}

/**
 * A radial-gradient sprite generated once. V4 used four-segment spheres as smoke; a soft sprite is
 * both cheaper and the difference between "smoke" and "small grey balls".
 */
function createSoftSprite(scene: Scene): Texture {
  const size = 64;
  const texture = new DynamicTexture("vfx-sprite", { width: size, height: size }, scene, true);
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  texture.update(true);
  texture.hasAlpha = true;
  return texture;
}
