import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  GlowLayer,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { RigidBody, World } from "@dimforge/rapier3d";
import {
  VehicleConfig,
  SeededRandom,
  advanceRaceProgress,
  applyBoost,
  createKartState,
  createRaceProgress,
  isWrongWay,
  rankPlayers,
  sanitizeInput,
  simulateKart,
  pickWeightedItem,
  type ItemDefinition,
  type AllowedLaps,
  type GameInput,
  type KartState,
  type RaceProgress,
} from "@print-rush/game-core";
import { CharacterPresets, KartPresets, type CharacterDefinition, type KartDefinition } from "@print-rush/3d-factory";
import { buildFlagshipStore, type BuiltTrack } from "./TrackBuilder";
import { animateKartWheels, createEmissiveMaterial, createKart, setKartPose } from "./createKart";
import { getDeviceReport, getHardwareScalingLevel } from "@/performance/PerformanceManager";
import type { StoredTrack } from "@/factory/TrackFactory";

export type HudState = {
  position: number;
  lap: number;
  laps: number;
  speedKph: number;
  timeMs: number;
  driftCharge: number;
  driftLevel: number;
  hasItem: boolean;
  itemName: string | null;
  countdown: number | null;
  banner: string | null;
  playerProgress: number;
  botProgress: number[];
};

export type RaceResult = {
  position: number;
  totalTimeMs: number;
  bestLapMs: number;
  boostsUsed: number;
};

type GameRuntimeOptions = {
  laps: AllowedLaps;
  muted: boolean;
  onHud: (state: HudState) => void;
  onFinish: (result: RaceResult) => void;
  character: CharacterDefinition;
  kartDefinition: KartDefinition;
  trackDefinition: StoredTrack;
};

type BotState = {
  node: TransformNode;
  totalProgress: number;
  speed: number;
  laneOffset: number;
};

const FIXED_STEP = 1 / 60;
const TRACK_LENGTH_APPROX = 154;

export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly input = new InputController();
  private readonly audio: ArcadeAudio;
  private readonly player: TransformNode;
  private readonly bots: BotState[];
  private readonly track: BuiltTrack;
  private readonly trails: Mesh[];
  private physicsWorld: World | null = null;
  private physicsBody: RigidBody | null = null;
  private kart: KartState;
  private progress: RaceProgress;
  private accumulator = 0;
  private elapsedMs = 0;
  private countdown = 3.4;
  private finished = false;
  private heldItem: ItemDefinition | null = null;
  private readonly itemRandom = new SeededRandom((Date.now() ^ 0x51f15e) >>> 0);
  private boostsUsed = 0;
  private wrongWayTime = 0;
  private banner: { text: string; until: number } | null = null;
  private lastHudAt = 0;
  private boostPadCooldown = 0;
  private disposed = false;
  private smoothedCameraTarget = new Vector3(0, 1, -19);
  private averageFrameMs = 16;
  private qualityCooldown = 0;

  private constructor(private readonly canvas: HTMLCanvasElement, private readonly options: GameRuntimeOptions) {
    this.engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true, preserveDrawingBuffer: false });
    const device = getDeviceReport();
    this.engine.setHardwareScalingLevel(getHardwareScalingLevel(device.profile));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(.025, .022, .032, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = .009;
    this.scene.fogColor = new Color3(.035, .03, .045);
    this.scene.collisionsEnabled = false;

    this.camera = new FreeCamera("chase-camera", new Vector3(-10, 7, -24), this.scene);
    this.camera.fov = .88;
    this.camera.minZ = .15;
    this.camera.maxZ = 180;

    const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
    ambient.intensity = .7;
    ambient.diffuse = Color3.FromHexString("#e3dcff");
    ambient.groundColor = Color3.FromHexString("#372333");
    const key = new DirectionalLight("key-light", new Vector3(-.45, -1, .2), this.scene);
    key.position.set(18, 28, -25);
    key.intensity = 2.7;
    key.diffuse = Color3.FromHexString("#ffe5f4");
    const shadows = new ShadowGenerator(1024, key);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 14;

    this.track = buildFlagshipStore(this.scene, options.trackDefinition);
    this.player = createKart(this.scene, "player", {
      body: Color3.FromHexString("#ff3da6"),
      accent: Color3.FromHexString("#b9ff45"),
      shirt: Color3.FromHexString("#f7f2e8"),
      skin: Color3.FromHexString("#d99b72"),
    }, true, { character: options.character, kart: options.kartDefinition, quality: window.innerWidth < 800 ? "MEDIUM" : "HIGH" });
    this.player.getChildMeshes().forEach((mesh) => shadows.addShadowCaster(mesh));

    const botPalettes = [
      ["#4db7ff", "#ffdd45"],
      ["#ff7b2f", "#7dffef"],
      ["#8f5cff", "#f7f2e8"],
    ];
    this.bots = botPalettes.map(([body, accent], index) => ({
      node: createKart(this.scene, `bot-${index}`, {
        body: Color3.FromHexString(body!),
        accent: Color3.FromHexString(accent!),
        shirt: Color3.FromHexString(index === 1 ? "#17141b" : "#f7f2e8"),
        skin: Color3.FromHexString(index === 2 ? "#70462e" : "#efb087"),
      }, true, { character: CharacterPresets[(index + 1) % CharacterPresets.length]!, kart: KartPresets[(index + 1) % KartPresets.length]!, quality: window.innerWidth < 800 ? "LOW" : "MEDIUM" }),
      totalProgress: -(.035 + index * .025),
      speed: 17.2 + index * .55,
      laneOffset: (index - 1) * 1.2,
    }));
    this.bots.forEach((bot) => bot.node.getChildMeshes().forEach((mesh) => shadows.addShadowCaster(mesh)));

    const glow = new GlowLayer("ink-glow", this.scene, { blurKernelSize: 28 });
    glow.intensity = .55;
    this.trails = [0, 1, 2].map((index) => {
      const trail = MeshBuilder.CreateBox(`drift-trail-${index}`, { width: .22, height: .13, depth: 2.8 }, this.scene);
      trail.material = createEmissiveMaterial(this.scene, `trail-mat-${index}`, ["#4db7ff", "#ff3da6", "#b9ff45"].map(Color3.FromHexString)[index]!);
      trail.isVisible = false;
      return trail;
    });

    this.kart = createKartState(0, -19, Math.PI / 2);
    this.progress = createRaceProgress(0);
    this.audio = new ArcadeAudio(options.muted);
  }

  static async create(canvas: HTMLCanvasElement, options: GameRuntimeOptions): Promise<GameRuntime> {
    const runtime = new GameRuntime(canvas, options);
    await runtime.initializePhysics();
    return runtime;
  }

  start(): void {
    this.input.attach();
    this.audio.start();
    const resize = () => this.engine.resize();
    const run = () => this.frame();
    const visibility = () => {
      if (document.hidden) { this.engine.stopRenderLoop(); this.audio.setPaused(true); }
      else if (!this.disposed) { this.engine.runRenderLoop(run); this.audio.setPaused(this.input.paused); }
    };
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    this.engine.onDisposeObservable.add(() => { window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", visibility); });
    this.engine.runRenderLoop(run);
  }

  setTouchControl(control: "left" | "right" | "throttle" | "brake" | "drift", active: boolean): void {
    this.input.setTouch(control, active);
  }

  useItem(): void { this.input.queueItem(); }
  respawn(): void { this.input.queueRespawn(); }
  setPaused(paused: boolean): void { this.input.paused = paused; this.audio.setPaused(paused); }
  setMuted(muted: boolean): void { this.audio.setMuted(muted); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.detach();
    this.audio.dispose();
    this.physicsWorld?.free();
    this.physicsWorld = null;
    this.scene.dispose();
    this.engine.dispose();
  }

  private async initializePhysics(): Promise<void> {
    const RAPIER = await import("@dimforge/rapier3d");
    this.physicsWorld = new RAPIER.World({ x: 0, y: -18, z: 0 });
    const floorBody = this.physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(56, .1, 42).setTranslation(0, -.1, 0), floorBody);
    this.physicsBody = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.kart.position.x, this.kart.position.y, this.kart.position.z),
    );
    this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(.92, .45, 1.4), this.physicsBody);
  }

  private frame(): void {
    if (this.disposed) return;
    const frameMs = Math.min(50, this.engine.getDeltaTime());
    this.averageFrameMs = this.averageFrameMs * .97 + frameMs * .03;
    this.adjustQuality(frameMs / 1_000);
    this.accumulator += frameMs / 1_000;
    while (this.accumulator >= FIXED_STEP) {
      this.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
    this.updateVisuals(frameMs / 1_000);
    this.scene.render();
  }

  private fixedUpdate(dt: number): void {
    if (this.input.paused || this.finished) return;
    this.track.itemBoxes.forEach((box) => {
      box.cooldown = Math.max(0, box.cooldown - dt);
      box.node.setEnabled(box.cooldown === 0);
      if (box.cooldown === 0 && !this.heldItem && Vector3.DistanceSquared(box.position, this.player.position) < 5.5) {
        this.heldItem = pickWeightedItem(this.estimatePosition(), this.itemRandom);
        box.cooldown = 6;
        box.node.setEnabled(false);
        this.banner = { text: `${this.heldItem.name.toUpperCase()} READY`, until: this.elapsedMs + 1_100 };
        this.audio.pickup();
      }
    });

    if (this.countdown > 0) {
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown === 0) {
        this.progress.currentLapStartedAt = performance.now();
        this.banner = { text: "GO!", until: this.elapsedMs + 700 };
        this.audio.go();
      }
      return;
    }

    this.elapsedMs += dt * 1_000;
    const input = this.input.snapshot();
    if (input.useItem && this.heldItem) {
      this.activateItem(this.heldItem);
      this.heldItem = null;
      this.boostsUsed += 1;
      this.audio.boost();
    }
    if (input.respawn) this.recover();

    const previousBoost = this.kart.boostRemaining;
    this.kart = simulateKart(this.kart, input, dt);
    if (previousBoost === 0 && this.kart.boostRemaining > 0) {
      this.boostsUsed += 1;
      this.audio.boost();
    }
    this.applyTrackSurface(dt);
    this.physicsBody?.setNextKinematicTranslation(this.kart.position);
    this.physicsWorld?.step();

    this.progress = advanceRaceProgress(
      this.progress,
      this.kart.position,
      this.track.definition,
      this.options.laps,
      performance.now(),
    );
    if (this.progress.finishedAt !== null) this.finishRace();

    const wrong = isWrongWay(this.kart.rotation, this.kart.position, this.track.definition);
    this.wrongWayTime = wrong ? this.wrongWayTime + dt : Math.max(0, this.wrongWayTime - dt * 2);
    if (this.wrongWayTime > 1.6) this.banner = { text: "DIRECCIÓN INCORRECTA", until: this.elapsedMs + 300 };

    this.boostPadCooldown = Math.max(0, this.boostPadCooldown - dt);
    if (this.boostPadCooldown === 0 && this.track.boostPads.some((pad) => Vector3.DistanceSquared(pad, this.player.position) < 11)) {
      this.kart = applyBoost(this.kart, .8);
      this.boostsUsed += 1;
      this.boostPadCooldown = 1.2;
      this.audio.boost();
    }

    this.updateBots(dt);
    this.audio.update(this.kart.speed / VehicleConfig.boostedMaxSpeed);
  }

  private applyTrackSurface(dt: number): void {
    let nearest = this.track.definition.racingSpline[0]!;
    let distanceSquared = Number.POSITIVE_INFINITY;
    for (const point of this.track.definition.racingSpline) {
      const distance = (point.x - this.kart.position.x) ** 2 + (point.z - this.kart.position.z) ** 2;
      if (distance < distanceSquared) { distanceSquared = distance; nearest = point; }
    }
    const offRoad = distanceSquared > (this.track.width * .62) ** 2;
    if (offRoad) {
      this.kart.speed *= Math.max(.94, 1 - dt * 3.6);
      this.kart.position.x += (nearest.x - this.kart.position.x) * dt * .36;
      this.kart.position.z += (nearest.z - this.kart.position.z) * dt * .36;
    }
    const bounds = this.track.definition.bounds;
    if (
      this.kart.position.x < bounds.minX || this.kart.position.x > bounds.maxX ||
      this.kart.position.z < bounds.minZ || this.kart.position.z > bounds.maxZ
    ) this.recover();
  }

  private recover(): void {
    const checkpointIndex = Math.max(0, Math.min(this.track.definition.recoveryPoints.length - 1, this.progress.checkpoint - 1));
    const recovery = this.track.definition.recoveryPoints[checkpointIndex]!;
    this.kart = createKartState(recovery.position.x, recovery.position.z, recovery.rotation);
    this.banner = { text: "BACK IN PRINT", until: this.elapsedMs + 800 };
  }

  private updateBots(dt: number): void {
    this.bots.forEach((bot, index) => {
      const catchup = Math.max(-1.2, Math.min(1.4, (this.totalPlayerProgress() - bot.totalProgress) * 2));
      const variation = Math.sin(this.elapsedMs * .0008 + index * 2.2) * .45;
      bot.totalProgress += ((bot.speed + catchup + variation) / TRACK_LENGTH_APPROX) * dt;
      const normalized = ((bot.totalProgress % 1) + 1) % 1;
      const pointIndex = Math.floor(normalized * this.track.definition.racingSpline.length);
      const nextIndex = (pointIndex + 1) % this.track.definition.racingSpline.length;
      const point = this.track.definition.racingSpline[pointIndex]!;
      const next = this.track.definition.racingSpline[nextIndex]!;
      const local = normalized * this.track.definition.racingSpline.length - pointIndex;
      const tangent = new Vector3(next.x - point.x, 0, next.z - point.z).normalize();
      const normal = new Vector3(-tangent.z, 0, tangent.x);
      const position = new Vector3(
        point.x + (next.x - point.x) * local + normal.x * bot.laneOffset,
        .72,
        point.z + (next.z - point.z) * local + normal.z * bot.laneOffset,
      );
      setKartPose(bot.node, position, Math.atan2(tangent.x, tangent.z));
      animateKartWheels(bot.node, bot.speed * dt, 0);
    });
  }

  private updateVisuals(dt: number): void {
    setKartPose(this.player, new Vector3(this.kart.position.x, this.kart.position.y, this.kart.position.z), this.kart.rotation);
    animateKartWheels(this.player, this.kart.speed * dt, this.input.steerValue);

    const forward = new Vector3(Math.sin(this.kart.rotation), 0, Math.cos(this.kart.rotation));
    const desiredTarget = this.player.position.add(new Vector3(0, 1.25, 0));
    const speedRatio = Math.min(1, Math.abs(this.kart.speed) / VehicleConfig.maxSpeed);
    const distance = 8.7 + speedRatio * 2.8 + (this.kart.boostRemaining > 0 ? 1.5 : 0);
    const desiredCamera = desiredTarget.subtract(forward.scale(distance)).add(new Vector3(0, 4.5 + speedRatio, 0));
    this.smoothedCameraTarget = Vector3.Lerp(this.smoothedCameraTarget, desiredTarget, 1 - Math.exp(-dt * 8));
    this.camera.position = Vector3.Lerp(this.camera.position, desiredCamera, 1 - Math.exp(-dt * 6));
    this.camera.setTarget(this.smoothedCameraTarget.add(forward.scale(3 + speedRatio * 2)));
    this.camera.fov += ((this.kart.boostRemaining > 0 ? 1.02 : .88) - this.camera.fov) * (1 - Math.exp(-dt * 5));

    const right = new Vector3(Math.cos(this.kart.rotation), 0, -Math.sin(this.kart.rotation));
    this.trails.forEach((trail, index) => {
      const active = this.kart.driftLevel > index;
      trail.isVisible = active;
      if (!active) return;
      trail.position = this.player.position.subtract(forward.scale(1.8 + index * .3)).add(right.scale((index % 2 ? 1 : -1) * .72));
      trail.position.y = .28;
      trail.rotation.y = this.kart.rotation;
      trail.scaling.z = .6 + Math.sin(performance.now() * .018 + index) * .23;
    });

    this.track.itemBoxes.forEach((box, index) => {
      box.node.rotation.y += dt * (1.6 + index * .08);
      box.node.position.y = 1.18 + Math.sin(performance.now() * .002 + index) * .18;
    });
    this.emitHud();
  }

  private emitHud(): void {
    const now = performance.now();
    if (now - this.lastHudAt < 60) return;
    this.lastHudAt = now;
    const playerEntry = { id: "player", progress: this.progress };
    const botEntries = this.bots.map((bot, index) => ({
      id: `bot-${index}`,
      progress: {
        ...createRaceProgress(),
        lap: Math.floor(Math.max(0, bot.totalProgress)) + 1,
        checkpoint: Math.floor((((bot.totalProgress % 1) + 1) % 1) * 5),
        progress: ((bot.totalProgress % 1) + 1) % 1,
      },
    }));
    const position = rankPlayers([playerEntry, ...botEntries]).findIndex((entry) => entry.id === "player") + 1;
    const banner = this.banner && this.banner.until > this.elapsedMs ? this.banner.text : null;
    this.options.onHud({
      position,
      lap: Math.min(this.options.laps, this.progress.lap),
      laps: this.options.laps,
      speedKph: Math.round(Math.abs(this.kart.speed) * 6.1),
      timeMs: this.elapsedMs,
      driftCharge: this.kart.driftCharge,
      driftLevel: this.kart.driftLevel,
      hasItem: this.heldItem !== null,
      itemName: this.heldItem?.name ?? null,
      countdown: this.countdown > 0 ? Math.ceil(this.countdown) : null,
      banner,
      playerProgress: this.totalPlayerProgress(),
      botProgress: this.bots.map((bot) => bot.totalProgress),
    });
  }

  private totalPlayerProgress(): number {
    return Math.max(0, this.progress.lap - 1 + this.progress.progress);
  }

  private estimatePosition(): number {
    return 1 + this.bots.filter((bot) => bot.totalProgress > this.totalPlayerProgress()).length;
  }

  private activateItem(item: ItemDefinition): void {
    if (item.category === "BOOST") this.kart = applyBoost(this.kart, item.duration);
    if (item.category === "PROJECTILE") {
      const target = [...this.bots].filter((bot) => bot.totalProgress >= this.totalPlayerProgress()).sort((a, b) => a.totalProgress - b.totalProgress)[0] ?? this.bots[0];
      if (target) target.totalProgress -= .025 + item.duration * .008;
    }
    if (item.category === "TRAP") {
      const target = [...this.bots].sort((a, b) => Math.abs(a.totalProgress - this.totalPlayerProgress()) - Math.abs(b.totalProgress - this.totalPlayerProgress()))[0];
      if (target) target.totalProgress -= .018;
    }
    if (item.category === "DEFENSE") this.kart = applyBoost(this.kart, Math.min(.7, item.duration * .12));
    this.banner = { text: item.name.toUpperCase(), until: this.elapsedMs + 760 };
  }

  private finishRace(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.finish();
    const allProgress = [this.totalPlayerProgress(), ...this.bots.map((bot) => bot.totalProgress)];
    const position = 1 + allProgress.slice(1).filter((value) => value > allProgress[0]!).length;
    const result: RaceResult = {
      position,
      totalTimeMs: Math.round(this.elapsedMs),
      bestLapMs: Math.round(this.progress.bestLapMs ?? this.elapsedMs),
      boostsUsed: this.boostsUsed,
    };
    window.setTimeout(() => this.options.onFinish(result), 950);
  }

  private adjustQuality(dt: number): void {
    this.qualityCooldown = Math.max(0, this.qualityCooldown - dt);
    if (this.qualityCooldown > 0) return;
    const current = this.engine.getHardwareScalingLevel();
    if (this.averageFrameMs > 25 && current < 2) {
      this.engine.setHardwareScalingLevel(Math.min(2, current + .18));
      this.qualityCooldown = 4;
    } else if (this.averageFrameMs < 17.5 && current > 1) {
      this.engine.setHardwareScalingLevel(Math.max(1, current - .12));
      this.qualityCooldown = 6;
    }
  }
}

class InputController {
  paused = false;
  steerValue = 0;
  private sequence = 0;
  private itemQueued = false;
  private respawnQueued = false;
  private readonly keys = new Set<string>();
  private readonly touch = new Map<string, boolean>();
  private gamepadItemHeld = false;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
    if (event.code === "KeyE") this.itemQueued = true;
    if (event.code === "KeyR") this.respawnQueued = true;
  };
  private readonly onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private readonly onBlur = () => { this.keys.clear(); this.touch.clear(); };

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }
  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }
  setTouch(control: string, active: boolean): void { this.touch.set(control, active); }
  queueItem(): void { this.itemQueued = true; }
  queueRespawn(): void { this.respawnQueued = true; }
  snapshot(): GameInput {
    const gamepad = typeof navigator !== "undefined" ? navigator.getGamepads?.()[0] : null;
    const axis = Math.abs(gamepad?.axes[0] ?? 0) > .16 ? gamepad!.axes[0]! : 0;
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft") || this.touch.get("left") === true || axis < -.16;
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight") || this.touch.get("right") === true || axis > .16;
    this.steerValue = axis !== 0 ? Math.max(-1, Math.min(1, axis)) : left === right ? 0 : left ? -1 : 1;
    const gamepadItem = gamepad?.buttons[2]?.pressed === true || gamepad?.buttons[3]?.pressed === true;
    if (gamepadItem && !this.gamepadItemHeld) this.itemQueued = true;
    this.gamepadItemHeld = gamepadItem;
    const input = sanitizeInput({
      sequence: ++this.sequence,
      steer: this.steerValue,
      throttle: this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.touch.get("throttle") || gamepad?.buttons[7]?.value ? Math.max(gamepad?.buttons[7]?.value ?? 0, 1) : 0,
      brake: this.keys.has("KeyS") || this.keys.has("ArrowDown") || this.touch.get("brake") || gamepad?.buttons[6]?.value ? Math.max(gamepad?.buttons[6]?.value ?? 0, 1) : 0,
      drift: this.keys.has("Space") || this.touch.get("drift") === true || gamepad?.buttons[0]?.pressed === true,
      useItem: this.itemQueued,
      respawn: this.respawnQueued,
    });
    this.itemQueued = false;
    this.respawnQueued = false;
    return input;
  }
}

class ArcadeAudio {
  private context: AudioContext | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private muted: boolean;
  constructor(muted: boolean) { this.muted = muted; }
  start(): void {
    if (this.muted || this.context) return;
    this.context = new AudioContext();
    this.engineOscillator = this.context.createOscillator();
    this.engineGain = this.context.createGain();
    this.engineOscillator.type = "sawtooth";
    this.engineOscillator.frequency.value = 52;
    this.engineGain.gain.value = .018;
    this.engineOscillator.connect(this.engineGain).connect(this.context.destination);
    this.engineOscillator.start();
  }
  update(speedRatio: number): void {
    if (!this.context || !this.engineOscillator || !this.engineGain) return;
    const now = this.context.currentTime;
    this.engineOscillator.frequency.setTargetAtTime(52 + speedRatio * 105, now, .05);
    this.engineGain.gain.setTargetAtTime(.014 + speedRatio * .024, now, .07);
  }
  setMuted(muted: boolean): void { this.muted = muted; if (!muted) this.start(); if (this.engineGain) this.engineGain.gain.value = muted ? 0 : .02; }
  setPaused(paused: boolean): void { if (this.context) void (paused ? this.context.suspend() : this.context.resume()); }
  pickup(): void { this.tone(420, 690, .12); }
  boost(): void { this.tone(160, 580, .2); }
  go(): void { this.tone(320, 880, .3); }
  finish(): void { this.tone(360, 980, .6); }
  dispose(): void { this.engineOscillator?.stop(); if (this.context) void this.context.close(); this.context = null; }
  private tone(from: number, to: number, duration: number): void {
    if (this.muted) return;
    this.start();
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(.07, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}
