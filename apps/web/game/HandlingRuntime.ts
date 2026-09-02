import { Engine, Scene, SceneInstrumentation, Vector3 } from "@babylonjs/core";
import {
  VehicleConfig,
  applyBoost,
  createKartState,
  getHandlingLab,
  launch,
  queryWall,
  resolveGround,
  resolveWall,
  sampleTrack,
  setVelocityAlongHeading,
  simulateKart,
  surfaceGrip,
  travelSpeed,
  type BakedTrack,
  type KartState,
  type TrackSample,
} from "@print-rush/game-core";
import { buildGreyBox, type BuiltGreyBox } from "@/render/GreyBoxBuilder";
import { KartPresets } from "@print-rush/3d-factory";
import { animateKart, buildKart, type KartVisual } from "@/render/KartBuilder";
import {
  DesktopCameraProfile,
  MobileCameraProfile,
  RaceCameraV5,
  type CameraContext,
} from "@/render/RaceCameraV5";
import { InputControllerV5, type TouchState } from "./InputControllerV5";

/**
 * HANDLING RUNTIME.
 *
 * The proving ground for stage 2 of the V5 plan. It runs the new vehicle model against the new
 * track sampler on the grey box, with a live telemetry read-out, and nothing else — no items, no
 * bots, no art. If the kart is not enjoyable here it will not become enjoyable once it has textures,
 * which is exactly why the brief puts this gate before the graphics work.
 */

const FIXED_STEP = 1 / 120;
/** Never run more than this many fixed steps in one frame; a stall must not become a time bomb. */
const MAX_STEPS = 8;

export type Telemetry = {
  speedKph: number;
  travelKph: number;
  longitudinal: number;
  lateral: number;
  slipAngleDeg: number;
  yawRateDeg: number;
  driftActive: boolean;
  driftDirection: number;
  driftCharge: number;
  driftLevel: number;
  boostRemaining: number;
  boostTier: number;
  grounded: boolean;
  airTime: number;
  surface: string;
  lateralOffset: number;
  offRoad: boolean;
  sector: number;
  progress: number;
  lapDistance: number;
  steer: number;
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  meshes: number;
  cameraFov: number;
  cameraDistance: number;
  lapTimeMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  wallHits: number;
  respawns: number;
};

export type HandlingRuntimeOptions = {
  onTelemetry: (telemetry: Telemetry) => void;
  mobile?: boolean;
};

export class HandlingRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: RaceCameraV5;
  private readonly input = new InputControllerV5();
  private readonly track: BakedTrack;
  private readonly greyBox: BuiltGreyBox;
  private readonly instrumentation: SceneInstrumentation;
  private readonly kartVisual: KartVisual;

  private kart: KartState;
  private sample: TrackSample;
  private cursor = 0;
  private accumulator = 0;
  private disposed = false;

  private wheelSpin = 0;
  private frameMs = 16.7;
  private lastTelemetryAt = 0;

  private boostPadCooldown = 0;
  private jumpPadCooldown = 0;
  private wallHits = 0;
  private respawns = 0;

  private lapStartedAt = 0;
  private lapTimeMs = 0;
  private lastLapMs: number | null = null;
  private bestLapMs: number | null = null;
  private previousProgress = 0;

  private readonly boostPads: Array<{ position: Vector3; progress: number }> = [];
  private readonly jumpPads: Array<{ position: Vector3; progress: number; power: number }> = [];

  private readonly cameraContext: CameraContext = {
    aimPoint: new Vector3(),
    floorY: 0,
  };

  constructor(canvas: HTMLCanvasElement, private readonly options: HandlingRuntimeOptions) {
    this.engine = new Engine(canvas, true, {
      antialias: true,
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    this.scene = new Scene(this.engine);
    // Nothing in the grey box is pickable, and skipping the check saves a per-frame traversal.
    this.scene.skipPointerMovePicking = true;
    this.scene.autoClear = true;

    this.track = getHandlingLab();
    this.greyBox = buildGreyBox(this.scene, this.track.definition);

    this.camera = new RaceCameraV5(this.scene, options.mobile ? MobileCameraProfile : DesktopCameraProfile);

    // Draw calls are a headline number for the performance work in stage 18, so they are measured
    // from the start rather than estimated.
    this.instrumentation = new SceneInstrumentation(this.scene);
    this.instrumentation.captureFrameTime = true;

    /**
     * The grey box uses the real modelled kart, not a stand-in. The whole point of the stage-2 gate
     * is to judge the thing you will actually drive, and a kart with visible wheels, suspension
     * travel and a turning steering wheel is also the clearest read on what the model is doing.
     */
    this.kartVisual = buildKart(
      this.scene,
      { ...KartPresets[0]!, primaryColor: "#ff3da6", secondaryColor: "#b9ff45", rimColor: "#c8ced6" },
      "test-kart",
      "HIGH",
    );

    const spawn = this.track.definition.spawnPoints[0]!;
    this.kart = createKartState(spawn.position.x, spawn.position.z, spawn.rotation, spawn.position.y);
    this.sample = sampleTrack(this.track.definition, this.kart.position, -1);
    this.cursor = this.sample.index;
    this.previousProgress = this.sample.progress;

    // Features from the blueprint become pads on the track. Positions are resolved once.
    for (const feature of this.track.blueprint.features) {
      if (feature.kind === "BOOST") {
        const node = this.nodeAtProgress(feature.progress);
        this.boostPads.push({ position: new Vector3(node.x, node.y, node.z), progress: feature.progress });
      } else if (feature.kind === "JUMP") {
        const node = this.nodeAtProgress(feature.progress);
        this.jumpPads.push({
          position: new Vector3(node.x, node.y, node.z),
          progress: feature.progress,
          power: feature.power,
        });
      }
    }
  }

  private nodeAtProgress(progress: number) {
    const nodes = this.track.definition.nodes;
    const index = Math.floor(progress * nodes.length) % nodes.length;
    return nodes[index]!;
  }

  get analysis() {
    return this.track.analysis;
  }

  start(): void {
    this.input.attach();
    const resize = (): void => this.engine.resize();
    window.addEventListener("resize", resize);
    this.engine.onDisposeObservable.add(() => window.removeEventListener("resize", resize));
    this.engine.runRenderLoop(() => this.frame());
  }

  setTouch(patch: Partial<TouchState>): void {
    this.input.setTouch(patch);
  }

  setPaused(paused: boolean): void {
    this.input.paused = paused;
  }

  respawn(): void {
    this.input.queueRespawn();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.detach();
    this.instrumentation.dispose();
    this.greyBox.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private frame(): void {
    if (this.disposed) return;
    const delta = Math.min(80, this.engine.getDeltaTime());
    this.frameMs = this.frameMs * 0.9 + delta * 0.1;

    this.accumulator += delta / 1_000;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
      this.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    this.updateVisuals(delta / 1_000);
    this.scene.render();
    this.emitTelemetry();
  }

  private fixedUpdate(dt: number): void {
    if (this.input.paused) return;
    const input = this.input.snapshot(dt);

    if (input.respawn) {
      this.performRespawn();
      return;
    }

    const grip = surfaceGrip(this.sample.offRoad ? "OFFROAD" : this.sample.surface);
    const previousBoost = this.kart.boostRemaining;

    this.kart = simulateKart(this.kart, input, dt, grip);

    // ---------------------------------------------------------------- track contact
    this.sample = sampleTrack(this.track.definition, this.kart.position, this.cursor);
    this.cursor = this.sample.index;

    const landing = resolveGround(this.kart, this.sample.groundY + 0.42, dt);
    if (landing.landed) {
      this.camera.impulse({
        shake: Math.min(0.5, landing.impact / 26),
        dip: Math.min(0.9, landing.impact / 18),
      });
      if (landing.boostSeconds > 0) {
        this.kart = applyBoost(this.kart, landing.boostSeconds, 1);
      }
    }

    // ---------------------------------------------------------------- walls
    const wall = queryWall(this.sample, VehicleConfig.collisionRadius);
    if (wall) {
      const hit = resolveWall(this.kart, wall.normal, wall.penetration);
      if (hit && hit.severity > 0.06) {
        this.wallHits += 1;
        this.camera.impulse({ shake: hit.severity * 0.75 });
      }
    }

    // ---------------------------------------------------------------- pads
    this.boostPadCooldown = Math.max(0, this.boostPadCooldown - dt);
    this.jumpPadCooldown = Math.max(0, this.jumpPadCooldown - dt);

    if (this.boostPadCooldown === 0) {
      for (const pad of this.boostPads) {
        if (Vector3.DistanceSquared(pad.position, this.kartPosition()) < 42) {
          this.kart = applyBoost(this.kart, VehicleConfig.boostSeconds, 2);
          this.boostPadCooldown = 1.2;
          this.camera.impulse({ punch: 0.55 });
          break;
        }
      }
    }

    if (this.jumpPadCooldown === 0 && this.kart.grounded) {
      for (const pad of this.jumpPads) {
        if (Vector3.DistanceSquared(pad.position, this.kartPosition()) < 60) {
          launch(this.kart, 8.5 * pad.power);
          this.jumpPadCooldown = 1.5;
          this.camera.impulse({ shake: 0.18 });
          break;
        }
      }
    }

    if (previousBoost === 0 && this.kart.boostRemaining > 0) {
      this.camera.impulse({ punch: 0.5 + this.kart.boostTier * 0.15 });
    }

    // ---------------------------------------------------------------- lap timing
    this.lapTimeMs += dt * 1_000;
    // Crossing the wrap point forwards completes a lap; crossing it backwards must not.
    if (this.previousProgress > 0.85 && this.sample.progress < 0.15) {
      this.lastLapMs = Math.round(this.lapTimeMs);
      this.bestLapMs = this.bestLapMs === null ? this.lastLapMs : Math.min(this.bestLapMs, this.lastLapMs);
      this.lapTimeMs = 0;
      this.lapStartedAt = performance.now();
    }
    this.previousProgress = this.sample.progress;

    // ---------------------------------------------------------------- fell off the world
    if (this.kart.position.y < this.track.definition.bounds.minY + 2) this.performRespawn();
  }

  private performRespawn(): void {
    const nodes = this.track.definition.nodes;
    // Put the kart back on the racing line where it currently is, facing the right way, at a speed
    // that keeps the recovery brief. Losing ten seconds to a small mistake is what the brief calls out.
    const node = nodes[this.cursor]!;
    const ahead = nodes[(this.cursor + 6) % nodes.length]!;
    const heading = Math.atan2(ahead.x - node.x, ahead.z - node.z);
    this.kart = createKartState(node.x, node.z, heading, node.y + 0.42);
    setVelocityAlongHeading(this.kart, 12);
    this.sample = sampleTrack(this.track.definition, this.kart.position, this.cursor);
    this.camera.reset(this.kart);
    this.respawns += 1;
  }

  private kartPosition(): Vector3 {
    return new Vector3(this.kart.position.x, this.kart.position.y, this.kart.position.z);
  }

  private updateVisuals(dt: number): void {
    const root = this.kartVisual.root;
    root.position.set(this.kart.position.x, this.kart.position.y, this.kart.position.z);
    root.rotationQuaternion = null;
    root.rotation.y = this.kart.rotation;
    // Body roll from the slide, and pitch from suspension load.
    root.rotation.z = this.kart.lean;
    root.rotation.x = this.kart.suspension * 0.09;

    // Metres travelled converted to wheel rotation, so the wheels roll at the real speed.
    this.wheelSpin += (this.kart.speed * dt) / 0.4;
    animateKart(this.kartVisual, this.wheelSpin, this.kart.steerVisual, this.kart.suspension);

    // ---------------------------------------------------------------- camera aim
    const nodes = this.track.definition.nodes;
    const speedRatio = Math.min(1, travelSpeed(this.kart) / VehicleConfig.maxSpeed);
    const profile = this.camera.getProfile();
    // Look ahead along the racing line rather than along the nose. This is the difference between a
    // camera that shows the corner exit and one that shows the wall you are sliding toward.
    const aheadMetres = 8 + profile.lookAhead * speedRatio;
    const aheadNodes = Math.round(aheadMetres / 2.5);
    const aim = nodes[(this.cursor + aheadNodes) % nodes.length]!;
    this.cameraContext.aimPoint.set(aim.x, aim.y + 1.6, aim.z);
    this.cameraContext.floorY = this.sample.groundY;

    this.camera.update(this.kart, this.cameraContext, dt);
  }

  private emitTelemetry(): void {
    const now = performance.now();
    // 20 Hz. The read-out is for a human, and re-rendering React at frame rate is the thing the
    // brief explicitly forbids.
    if (now - this.lastTelemetryAt < 50) return;
    this.lastTelemetryAt = now;

    const debug = this.camera.debug;
    this.options.onTelemetry({
      speedKph: Math.round(Math.abs(this.kart.speed) * 3.6),
      travelKph: Math.round(travelSpeed(this.kart) * 3.6),
      longitudinal: Number(this.kart.speed.toFixed(2)),
      lateral: Number(this.kart.lateralSpeed.toFixed(2)),
      slipAngleDeg: Number(((this.kart.slipAngle * 180) / Math.PI).toFixed(1)),
      yawRateDeg: Number(((this.kart.yawRate * 180) / Math.PI).toFixed(1)),
      driftActive: this.kart.driftActive,
      driftDirection: this.kart.driftDirection,
      driftCharge: Number(this.kart.driftCharge.toFixed(2)),
      driftLevel: this.kart.driftLevel,
      boostRemaining: Number(this.kart.boostRemaining.toFixed(2)),
      boostTier: this.kart.boostTier,
      grounded: this.kart.grounded,
      airTime: Number(this.kart.airTime.toFixed(2)),
      surface: this.sample.offRoad ? "OFFROAD" : this.sample.surface,
      lateralOffset: Number(this.sample.lateral.toFixed(2)),
      offRoad: this.sample.offRoad,
      sector: this.sample.node.sector,
      progress: Number(this.sample.progress.toFixed(4)),
      lapDistance: Math.round(this.sample.node.distance),
      steer: Number(this.input.steer.toFixed(3)),
      fps: Math.round(1_000 / this.frameMs),
      frameMs: Number(this.frameMs.toFixed(2)),
      drawCalls: this.instrumentation.drawCallsCounter.current,
      triangles: this.scene.getActiveIndices() / 3,
      meshes: this.scene.meshes.length,
      cameraFov: debug.fov,
      cameraDistance: debug.distance,
      lapTimeMs: Math.round(this.lapTimeMs),
      lastLapMs: this.lastLapMs,
      bestLapMs: this.bestLapMs,
      wallHits: this.wallHits,
      respawns: this.respawns,
    });
    void this.lapStartedAt;
  }
}
