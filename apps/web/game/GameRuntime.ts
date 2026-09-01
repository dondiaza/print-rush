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
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { RigidBody, World } from "@dimforge/rapier3d";
import {
  VehicleConfig,
  ItemDefinitions,
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
  phase: "GRID" | "RACE" | "FINISH";
  trackName: string;
  sector: number;
  rouletteName: string | null;
  shield: boolean;
  inked: boolean;
  shuffled: boolean;
  incoming: boolean;
  surface: string;
  lastLap: boolean;
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

type ProjectileState = {
  node: Mesh;
  owner: "player" | "bot";
  item: ItemDefinition;
  velocity: Vector3;
  age: number;
  backwards: boolean;
  target: BotState | null;
};

type TrapState = { node: Mesh; item: ItemDefinition; age: number; position: Vector3 };
type PooledFx = { mesh: Mesh; life: number; velocity: Vector3 };

const FIXED_STEP = 1 / 60;

export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly input = new InputController();
  private readonly audio: ArcadeAudio;
  private readonly player: TransformNode;
  private readonly shieldMesh: Mesh;
  private readonly bots: BotState[];
  private readonly track: BuiltTrack;
  private readonly trails: Mesh[];
  private readonly projectiles: ProjectileState[] = [];
  private readonly traps: TrapState[] = [];
  private readonly fxPool: PooledFx[] = [];
  private readonly skidPool: Array<{ mesh: Mesh; life: number }> = [];
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
  private roulette: { item: ItemDefinition; until: number; nextTick: number } | null = null;
  private shieldUntil = 0;
  private sizeUntil = 0;
  private inkedUntil = 0;
  private shuffledUntil = 0;
  private hitImmunityUntil = 0;
  private incomingUntil = 0;
  private cameraShake = 0;
  private launchCharge = 0;
  private finishDelay = 0;
  private draftCharge = 0;
  private draftCooldown = 0;
  private lastLapAnnounced = false;
  private lastDrifting = false;
  private nearestTrackIndex = 0;
  private currentSurface = "ASPHALT";
  private lastSkidAt = 0;
  private nextBotAttackAt = 8_000;
  private pendingResult: RaceResult | null = null;
  private finishReported = false;

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
    this.shieldMesh = MeshBuilder.CreateSphere("player-shield", { diameter: 4.6, segments: 16 }, this.scene);
    this.shieldMesh.parent = this.player;
    this.shieldMesh.position.y = 1.05;
    const shieldMaterial = new StandardMaterial("player-shield-material", this.scene);
    shieldMaterial.diffuseColor = Color3.FromHexString("#65d8ff");
    shieldMaterial.emissiveColor = Color3.FromHexString("#238bb8");
    shieldMaterial.alpha = .18;
    shieldMaterial.wireframe = true;
    this.shieldMesh.material = shieldMaterial;
    this.shieldMesh.isVisible = false;

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
    this.bots.forEach((bot, index) => {
      bot.node.getChildMeshes().forEach((mesh) => shadows.addShadowCaster(mesh));
      const spawn = this.track.definition.spawnPoints[index + 1] ?? this.track.definition.spawnPoints[0]!;
      setKartPose(bot.node, new Vector3(spawn.position.x, spawn.position.y, spawn.position.z), spawn.rotation);
    });

    const glow = new GlowLayer("ink-glow", this.scene, { blurKernelSize: 28 });
    glow.intensity = .55;
    this.trails = [0, 1, 2].map((index) => {
      const trail = MeshBuilder.CreateBox(`drift-trail-${index}`, { width: .22, height: .13, depth: 2.8 }, this.scene);
      trail.material = createEmissiveMaterial(this.scene, `trail-mat-${index}`, ["#4db7ff", "#ff3da6", "#b9ff45"].map(Color3.FromHexString)[index]!);
      trail.isVisible = false;
      return trail;
    });

    for (let index = 0; index < 42; index += 1) {
      const fx = MeshBuilder.CreateSphere(`fx-${index}`, { diameter: .12 + index % 3 * .05, segments: 4 }, this.scene);
      fx.material = createEmissiveMaterial(this.scene, `fx-mat-${index}`, ["#f7f2e8", "#ff3da6", "#b9ff45", "#65d8ff"].map(Color3.FromHexString)[index % 4]!);
      fx.isVisible = false;
      this.fxPool.push({ mesh: fx, life: 0, velocity: Vector3.Zero() });
    }
    for (let index = 0; index < 54; index += 1) {
      const mark = MeshBuilder.CreateBox(`skid-${index}`, { width: .16, height: .018, depth: 1.15 }, this.scene);
      const markMaterial = new StandardMaterial(`skid-mat-${index}`, this.scene);
      markMaterial.diffuseColor = Color3.FromHexString("#050507");
      markMaterial.alpha = .52;
      mark.material = markMaterial;
      mark.isVisible = false;
      this.skidPool.push({ mesh: mark, life: 0 });
    }

    const spawn = this.track.definition.spawnPoints[0]!;
    this.kart = createKartState(spawn.position.x, spawn.position.z, spawn.rotation);
    this.kart.position.y = spawn.position.y;
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
    if (this.input.paused) return;
    if (this.finished) {
      this.elapsedMs += dt * 1_000;
      this.finishDelay += dt;
      const autopilot = sanitizeInput({ sequence: 0, throttle: .72, steer: this.autopilotSteer(), brake: 0, drift: false });
      this.kart = simulateKart(this.kart, autopilot, dt);
      this.applyTrackSurface(dt);
      this.updateBots(dt);
      if (this.finishDelay >= 2.4) this.completeFinish();
      return;
    }
    this.track.itemBoxes.forEach((box) => {
      box.cooldown = Math.max(0, box.cooldown - dt);
      box.node.setEnabled(box.cooldown === 0);
      if (box.cooldown === 0 && !this.heldItem && !this.roulette && Vector3.DistanceSquared(box.position, this.player.position) < 5.5) {
        const gap = Math.max(0, ...this.bots.map((bot) => bot.totalProgress - this.totalPlayerProgress())) * this.track.lengthMeters / 22;
        const item = pickWeightedItem(this.estimatePosition(), this.itemRandom, gap);
        this.roulette = { item, until: this.elapsedMs + 900, nextTick: this.elapsedMs };
        box.cooldown = 6;
        box.node.setEnabled(false);
        this.banner = { text: "PRINT PICKUP", until: this.elapsedMs + 620 };
        this.audio.pickup();
      }
    });

    if (this.countdown > 0) {
      const gridInput = this.input.snapshot();
      if (this.countdown < .82 && gridInput.throttle > .5) this.launchCharge += dt;
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown === 0) {
        this.progress.currentLapStartedAt = performance.now();
        if (this.launchCharge >= .16 && this.launchCharge <= .72) {
          this.kart = applyBoost(this.kart, .82);
          this.banner = { text: "PERFECT PRINT!", until: this.elapsedMs + 900 };
          this.burst(this.player.position, 12, 5.5);
        } else {
          this.banner = { text: "GO!", until: this.elapsedMs + 700 };
        }
        this.audio.go();
      }
      return;
    }

    this.elapsedMs += dt * 1_000;
    if (this.roulette) {
      if (this.elapsedMs >= this.roulette.until) {
        this.heldItem = this.roulette.item;
        this.banner = { text: `${this.heldItem.name.toUpperCase()} READY`, until: this.elapsedMs + 1_000 };
        this.roulette = null;
      } else if (this.elapsedMs >= this.roulette.nextTick) {
        this.roulette.nextTick += 90;
        this.audio.roulette();
      }
    }
    const input = this.input.snapshot();
    if (input.useItem && this.heldItem) {
      this.activateItem(this.heldItem, input.brake > .15);
      this.heldItem = null;
    }
    if (input.respawn) this.recover();

    const previousBoost = this.kart.boostRemaining;
    this.kart = simulateKart(this.kart, input, dt);
    if (previousBoost === 0 && this.kart.boostRemaining > 0) {
      this.boostsUsed += 1;
      this.audio.boost();
    }
    this.applyTrackSurface(dt);
    this.updateDrafting(dt);
    this.updateHazards(dt);
    this.updateProjectiles(dt);
    this.updateTraps(dt);
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
    if (this.progress.lap === this.options.laps && !this.lastLapAnnounced && this.options.laps > 1) {
      this.lastLapAnnounced = true;
      this.banner = { text: "FINAL LAP / FULL SEND", until: this.elapsedMs + 1_800 };
      this.audio.lastLap();
    }

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
    this.track.definition.racingSpline.forEach((point, index) => {
      const distance = (point.x - this.kart.position.x) ** 2 + (point.z - this.kart.position.z) ** 2;
      if (distance < distanceSquared) { distanceSquared = distance; nearest = point; this.nearestTrackIndex = index; }
    });
    const segment = this.track.stored.segments[this.nearestTrackIndex]!;
    this.currentSurface = segment.surface;
    const halfWidth = segment.width / 2;
    const onShortcut = this.track.shortcutPads.some((pad) => Vector3.DistanceSquared(pad, this.player.position) < 7.5);
    const offRoad = !onShortcut && distanceSquared > (halfWidth * .9) ** 2;
    if (!onShortcut && Math.abs(this.input.steerValue) < .12 && Math.abs(this.kart.speed) > 7) {
      const next = this.track.definition.racingSpline[(this.nearestTrackIndex + 3) % this.track.definition.racingSpline.length]!;
      const targetYaw = Math.atan2(next.x - nearest.x, next.z - nearest.z);
      let yawDelta = targetYaw - this.kart.rotation;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      const assist = offRoad ? 3.6 : distanceSquared > (halfWidth * .48) ** 2 ? 1.8 : .72;
      this.kart.rotation += yawDelta * Math.min(1, dt * assist);
    }
    if (offRoad) {
      this.kart.speed *= Math.max(.9, 1 - dt * 4.2);
      this.kart.position.x += (nearest.x - this.kart.position.x) * dt * .7;
      this.kart.position.z += (nearest.z - this.kart.position.z) * dt * .7;
      if (this.elapsedMs > this.hitImmunityUntil) {
        this.kart.speed *= .82;
        this.hitImmunityUntil = this.elapsedMs + 620;
        this.cameraShake = Math.max(this.cameraShake, .28);
        this.burst(this.player.position, 7, 3.2);
        this.audio.impact();
      }
    }
    const onRamp = this.track.jumpPads.some((pad) => Vector3.DistanceSquared(pad, this.player.position) < 10);
    const groundY = nearest.y + .72;
    if (onRamp && this.kart.verticalSpeed === 0 && Math.abs(this.kart.speed) > 12) {
      this.kart.verticalSpeed = 7.2;
      this.cameraShake = .12;
      this.audio.jump();
    }
    if (this.kart.verticalSpeed !== 0 || this.kart.position.y > groundY + .08) {
      this.kart.verticalSpeed -= 17 * dt;
      this.kart.position.y += this.kart.verticalSpeed * dt;
      if (this.kart.position.y <= groundY) {
        this.kart.position.y = groundY;
        if (this.kart.verticalSpeed < -3.8) {
          this.kart = applyBoost(this.kart, .24);
          this.cameraShake = .24;
          this.burst(this.player.position, 8, 2.5);
          this.audio.land();
        }
        this.kart.verticalSpeed = 0;
      }
    } else {
      this.kart.position.y += (groundY - this.kart.position.y) * Math.min(1, dt * 12);
    }
    if (this.track.shortcutPads.some((pad) => Vector3.DistanceSquared(pad, this.player.position) < 8)) {
      this.kart = applyBoost(this.kart, .12);
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
    this.kart.position.y = recovery.position.y;
    this.banner = { text: "BACK IN PRINT", until: this.elapsedMs + 800 };
  }

  private updateBots(dt: number): void {
    this.bots.forEach((bot, index) => {
      const catchup = Math.max(-1.2, Math.min(1.4, (this.totalPlayerProgress() - bot.totalProgress) * 2));
      const variation = Math.sin(this.elapsedMs * .0008 + index * 2.2) * .45;
      bot.totalProgress += ((bot.speed + catchup + variation) / this.track.lengthMeters) * dt;
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
        point.y + .72,
        point.z + (next.z - point.z) * local + normal.z * bot.laneOffset,
      );
      setKartPose(bot.node, position, Math.atan2(tangent.x, tangent.z));
      animateKartWheels(bot.node, bot.speed * dt, 0);
    });
  }

  private updateVisuals(dt: number): void {
    setKartPose(this.player, new Vector3(this.kart.position.x, this.kart.position.y, this.kart.position.z), this.kart.rotation);
    this.player.rotation.z = this.kart.driftLevel > 0 ? -this.input.steerValue * .13 : -this.input.steerValue * .025;
    const targetScale = this.elapsedMs < this.sizeUntil ? 1.14 : 1;
    const scale = this.player.scaling.x + (targetScale - this.player.scaling.x) * (1 - Math.exp(-dt * 8));
    this.player.scaling.setAll(scale);
    this.shieldMesh.isVisible = this.elapsedMs < this.shieldUntil;
    this.shieldMesh.rotation.y += dt * 1.7;
    animateKartWheels(this.player, this.kart.speed * dt, this.input.steerValue);

    const forward = new Vector3(Math.sin(this.kart.rotation), 0, Math.cos(this.kart.rotation));
    const desiredTarget = this.player.position.add(new Vector3(0, 1.25, 0));
    const speedRatio = Math.min(1, Math.abs(this.kart.speed) / VehicleConfig.maxSpeed);
    const distance = 8.7 + speedRatio * 2.8 + (this.kart.boostRemaining > 0 ? 1.5 : 0);
    const desiredCamera = desiredTarget.subtract(forward.scale(distance)).add(new Vector3(0, 4.5 + speedRatio, 0));
    this.smoothedCameraTarget = Vector3.Lerp(this.smoothedCameraTarget, desiredTarget, 1 - Math.exp(-dt * 8));
    this.cameraShake = Math.max(0, this.cameraShake - dt * 1.7);
    const shake = new Vector3(
      Math.sin(performance.now() * .07) * this.cameraShake,
      Math.cos(performance.now() * .09) * this.cameraShake * .65,
      0,
    );
    this.camera.position = Vector3.Lerp(this.camera.position, desiredCamera, 1 - Math.exp(-dt * 6)).add(shake);
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

    const drifting = this.kart.driftLevel > 0;
    if (drifting && this.elapsedMs - this.lastSkidAt > 72) {
      this.lastSkidAt = this.elapsedMs;
      [-1, 1].forEach((side) => this.placeSkid(this.player.position.subtract(forward.scale(1.25)).add(right.scale(side * .76)), this.kart.rotation));
      this.burst(this.player.position.subtract(forward.scale(1.35)), this.currentSurface === "INK" ? 3 : 2, 1.3);
    }
    if (this.lastDrifting && !drifting && this.kart.boostRemaining > 0) {
      this.cameraShake = Math.max(this.cameraShake, .15 + this.kart.driftLevel * .03);
      this.burst(this.player.position, 9, 4);
    }
    this.lastDrifting = drifting;

    this.fxPool.forEach((fx) => {
      if (fx.life <= 0) return;
      fx.life -= dt;
      fx.mesh.position.addInPlace(fx.velocity.scale(dt));
      fx.velocity.y -= dt * 3.5;
      fx.mesh.scaling.scaleInPlace(.97);
      if (fx.life <= 0) fx.mesh.isVisible = false;
    });
    this.skidPool.forEach((mark) => {
      if (mark.life <= 0) return;
      mark.life -= dt;
      const material = mark.mesh.material as StandardMaterial;
      material.alpha = Math.min(.5, mark.life * .12);
      if (mark.life <= 0) mark.mesh.isVisible = false;
    });

    this.track.hazards.forEach((hazard) => {
      const warning = hazard.node.getChildMeshes()[0];
      const obstacle = hazard.node.getChildMeshes()[1];
      if (warning) warning.scaling.setAll(1 + Math.sin(performance.now() * .006 + hazard.phase) * .08);
      if (obstacle) obstacle.position.y = 1.25 + Math.max(0, Math.sin(performance.now() * .0017 + hazard.phase)) * 2.4;
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
        checkpoint: bot.totalProgress < 0 ? 0 : Math.floor((bot.totalProgress % 1) * 5),
        progress: bot.totalProgress < 0 ? 0 : bot.totalProgress % 1,
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
      phase: this.finished ? "FINISH" : this.countdown > 0 ? "GRID" : "RACE",
      trackName: this.track.definition.name,
      sector: Math.min(5, this.progress.checkpoint + 1),
      rouletteName: this.roulette ? this.roulette.item.shortName : null,
      shield: this.elapsedMs < this.shieldUntil,
      inked: this.elapsedMs < this.inkedUntil,
      shuffled: this.elapsedMs < this.shuffledUntil,
      incoming: this.elapsedMs < this.incomingUntil,
      surface: this.currentSurface,
      lastLap: this.lastLapAnnounced,
    });
  }

  private totalPlayerProgress(): number {
    return Math.max(0, this.progress.lap - 1 + this.progress.progress);
  }

  private estimatePosition(): number {
    return 1 + this.bots.filter((bot) => bot.totalProgress > this.totalPlayerProgress()).length;
  }

  private activateItem(item: ItemDefinition, backwards: boolean): void {
    if (item.category === "BOOST") {
      this.kart = applyBoost(this.kart, item.duration);
      this.boostsUsed += 1;
      this.cameraShake = .22;
      this.burst(this.player.position, 14, 5);
      this.audio.boost();
    } else if (item.category === "PROJECTILE" || (item.category === "UTILITY" && item.id === "design-shuffle")) {
      this.spawnProjectile(item, backwards);
      this.audio.launch();
    } else if (item.category === "TRAP" || item.id === "dye-cloud") {
      this.spawnTrap(item);
      this.audio.drop();
    } else if (item.id === "package-shield") {
      this.shieldUntil = this.elapsedMs + item.duration * 1_000;
      this.audio.shield();
    } else if (item.id === "size-tag") {
      this.sizeUntil = this.elapsedMs + item.duration * 1_000;
      this.shieldUntil = Math.max(this.shieldUntil, this.elapsedMs + 3_200);
      this.audio.shield();
    } else if (item.id === "magnetic-tag") {
      const target = this.closestBotAhead();
      if (target) target.totalProgress -= Math.min(.025, Math.max(0, target.totalProgress - this.totalPlayerProgress()) * .2);
      this.kart = applyBoost(this.kart, .32);
      this.audio.launch();
    } else if (item.id === "mega-print") {
      this.bots.forEach((bot) => { if (Math.abs(bot.totalProgress - this.totalPlayerProgress()) < .16) bot.totalProgress -= .035; });
      this.burst(this.player.position, 28, 8);
      this.cameraShake = .5;
      this.audio.impact();
    }
    this.banner = { text: `${backwards ? "BACKSHOT / " : ""}${item.name.toUpperCase()}`, until: this.elapsedMs + 860 };
  }

  private spawnProjectile(item: ItemDefinition, backwards: boolean, owner: "player" | "bot" = "player", origin?: Vector3): void {
    const node = item.id === "hanger-boomerang"
      ? MeshBuilder.CreateTorus(`projectile-${item.id}-${this.elapsedMs}`, { diameter: .9, thickness: .13, tessellation: 12 }, this.scene)
      : MeshBuilder.CreateBox(`projectile-${item.id}-${this.elapsedMs}`, { size: item.id === "express-package" ? .72 : .92 }, this.scene);
    node.material = createEmissiveMaterial(this.scene, `projectile-material-${this.elapsedMs}`, Color3.FromHexString(owner === "player" ? "#b9ff45" : "#ff623d"));
    const start = origin?.clone() ?? this.player.position.clone();
    const yaw = owner === "player" ? this.kart.rotation : Math.atan2(this.player.position.x - start.x, this.player.position.z - start.z);
    const direction = new Vector3(Math.sin(yaw), .02, Math.cos(yaw)).scale(backwards ? -1 : 1);
    node.position.copyFrom(start.add(direction.scale(2.2)).add(new Vector3(0, .55, 0)));
    const target = owner === "player" && !backwards ? this.closestBotAhead() : null;
    this.projectiles.push({ node, owner, item, velocity: direction.scale(item.speed || 28), age: 0, backwards, target });
  }

  private updateProjectiles(dt: number): void {
    if (this.elapsedMs >= this.nextBotAttackAt && !this.finished) {
      const bot = this.bots[Math.floor(this.elapsedMs / 8_000) % this.bots.length]!;
      this.spawnProjectile(ItemDefinitions.expressPackage, false, "bot", bot.node.position);
      this.nextBotAttackAt = this.elapsedMs + 9_000 + this.itemRandom.next() * 5_000;
    }
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index]!;
      projectile.age += dt;
      if (projectile.item.id === "hanger-boomerang" && projectile.age > projectile.item.duration * .5) {
        const home = this.player.position.subtract(projectile.node.position).normalize();
        projectile.velocity = Vector3.Lerp(projectile.velocity, home.scale(projectile.item.speed), dt * 2.2);
      } else if (projectile.target && projectile.age > .16) {
        const aim = projectile.target.node.position.subtract(projectile.node.position).normalize().scale(projectile.item.speed);
        projectile.velocity = Vector3.Lerp(projectile.velocity, aim, dt * .72);
      }
      projectile.node.position.addInPlace(projectile.velocity.scale(dt));
      projectile.node.rotation.x += dt * 7;
      projectile.node.rotation.y += dt * 5;
      if (projectile.owner === "player") {
        const hit = this.bots.find((bot) => Vector3.DistanceSquared(bot.node.position, projectile.node.position) < 4);
        if (hit && projectile.age > .16) {
          hit.totalProgress -= .016 + projectile.item.power * .025;
          this.burst(projectile.node.position, 10, 4);
          this.audio.impact();
          this.removeProjectile(index);
          continue;
        }
      } else {
        const distance = Vector3.Distance(this.player.position, projectile.node.position);
        if (distance < 18) this.incomingUntil = this.elapsedMs + 320;
        if (distance < 2.2 && projectile.age > .2) {
          this.receiveHit(projectile.item);
          this.removeProjectile(index);
          continue;
        }
      }
      if (projectile.age >= projectile.item.duration || !this.insideBounds(projectile.node.position)) this.removeProjectile(index);
    }
  }

  private removeProjectile(index: number): void {
    this.projectiles[index]?.node.dispose();
    this.projectiles.splice(index, 1);
  }

  private spawnTrap(item: ItemDefinition): void {
    const forward = new Vector3(Math.sin(this.kart.rotation), 0, Math.cos(this.kart.rotation));
    const position = this.player.position.subtract(forward.scale(2.4));
    const node = item.id === "dye-cloud"
      ? MeshBuilder.CreateSphere(`trap-${item.id}-${this.elapsedMs}`, { diameter: 4.8, segments: 10 }, this.scene)
      : MeshBuilder.CreateCylinder(`trap-${item.id}-${this.elapsedMs}`, { height: .18, diameter: 2.1, tessellation: 20 }, this.scene);
    const trapMaterial = new StandardMaterial(`trap-material-${this.elapsedMs}`, this.scene);
    trapMaterial.diffuseColor = Color3.FromHexString(item.id === "dye-cloud" ? "#8f5cff" : item.id === "tape-trap" ? "#f7f2e8" : "#ff3da6");
    trapMaterial.emissiveColor = trapMaterial.diffuseColor.scale(.35);
    trapMaterial.alpha = item.id === "dye-cloud" ? .28 : .9;
    node.material = trapMaterial;
    node.position.copyFrom(position);
    node.position.y = item.id === "dye-cloud" ? position.y + 1.3 : position.y - .55;
    this.traps.push({ node, item, age: 0, position: node.position.clone() });
  }

  private updateTraps(dt: number): void {
    for (let index = this.traps.length - 1; index >= 0; index -= 1) {
      const trap = this.traps[index]!;
      trap.age += dt;
      trap.node.rotation.y += dt * .7;
      const hit = this.bots.find((bot) => Vector3.DistanceSquared(bot.node.position, trap.position) < (trap.item.id === "dye-cloud" ? 13 : 4));
      if (hit) {
        hit.totalProgress -= .018 + trap.item.power * .012;
        this.burst(trap.position, 8, 2.8);
        if (trap.item.id !== "dye-cloud") trap.age = trap.item.duration;
      }
      if (trap.age >= trap.item.duration) {
        trap.node.dispose();
        this.traps.splice(index, 1);
      }
    }
  }

  private receiveHit(item: ItemDefinition): void {
    if (this.elapsedMs < this.hitImmunityUntil) return;
    if (this.elapsedMs < this.shieldUntil) {
      this.shieldUntil = 0;
      this.banner = { text: "SHIELD BREAK", until: this.elapsedMs + 760 };
      this.burst(this.player.position, 18, 5);
      this.audio.shieldBreak();
      return;
    }
    this.hitImmunityUntil = this.elapsedMs + 1_250;
    this.kart.speed *= Math.max(.5, 1 - item.power * .48);
    this.kart.rotation += (this.itemRandom.next() - .5) * item.power * .8;
    this.cameraShake = .5;
    this.burst(this.player.position, 18, 6);
    if (item.id === "ink-blast") this.inkedUntil = this.elapsedMs + 2_400;
    if (item.id === "design-shuffle") this.shuffledUntil = this.elapsedMs + 3_200;
    this.banner = { text: `${item.shortName} HIT!`, until: this.elapsedMs + 720 };
    this.audio.impact();
  }

  private updateHazards(dt: number): void {
    this.track.hazards.forEach((hazard) => {
      hazard.cooldown = Math.max(0, hazard.cooldown - dt);
      const active = Math.sin(this.elapsedMs * .0017 + hazard.phase) > .62;
      if (active && hazard.cooldown === 0 && Vector3.DistanceSquared(hazard.position, this.player.position) < 10) {
        this.receiveHit({ ...ItemDefinitions.stickerMine, shortName: "HAZARD" });
        hazard.cooldown = 2.4;
      }
    });
  }

  private updateDrafting(dt: number): void {
    this.draftCooldown = Math.max(0, this.draftCooldown - dt);
    const ahead = this.bots.some((bot) => {
      const delta = bot.totalProgress - this.totalPlayerProgress();
      return delta > 0 && delta < .035 && Vector3.DistanceSquared(bot.node.position, this.player.position) < 180;
    });
    this.draftCharge = ahead ? Math.min(1, this.draftCharge + dt * .72) : Math.max(0, this.draftCharge - dt * 1.4);
    if (this.draftCharge >= 1 && this.draftCooldown === 0) {
      this.kart = applyBoost(this.kart, .45);
      this.draftCharge = 0;
      this.draftCooldown = 5;
      this.banner = { text: "SLIPSTREAM", until: this.elapsedMs + 650 };
      this.audio.boost();
    }
  }

  private burst(origin: Vector3, count: number, speed: number): void {
    let created = 0;
    for (const fx of this.fxPool) {
      if (fx.life > 0) continue;
      const angle = this.itemRandom.next() * Math.PI * 2;
      const force = speed * (.45 + this.itemRandom.next() * .55);
      fx.mesh.position.copyFrom(origin);
      fx.mesh.scaling.setAll(1);
      fx.mesh.isVisible = true;
      fx.life = .35 + this.itemRandom.next() * .55;
      fx.velocity.set(Math.cos(angle) * force, 1 + this.itemRandom.next() * speed * .65, Math.sin(angle) * force);
      created += 1;
      if (created >= count) break;
    }
  }

  private placeSkid(position: Vector3, yaw: number): void {
    const mark = this.skidPool.find((entry) => entry.life <= 0) ?? this.skidPool[0]!;
    mark.life = 4.5;
    mark.mesh.isVisible = true;
    mark.mesh.position.copyFrom(position);
    mark.mesh.position.y -= .68;
    mark.mesh.rotation.y = yaw;
    mark.mesh.scaling.setAll(1);
  }

  private closestBotAhead(): BotState | null {
    return [...this.bots].filter((bot) => bot.totalProgress >= this.totalPlayerProgress()).sort((a, b) => a.totalProgress - b.totalProgress)[0] ?? null;
  }

  private insideBounds(position: Vector3): boolean {
    const bounds = this.track.definition.bounds;
    return position.x >= bounds.minX && position.x <= bounds.maxX && position.z >= bounds.minZ && position.z <= bounds.maxZ;
  }

  private autopilotSteer(): number {
    const lookAhead = (this.nearestTrackIndex + 6) % this.track.definition.racingSpline.length;
    const target = this.track.definition.racingSpline[lookAhead]!;
    const targetYaw = Math.atan2(target.x - this.kart.position.x, target.z - this.kart.position.z);
    let delta = targetYaw - this.kart.rotation;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return Math.max(-1, Math.min(1, delta * 1.6));
  }

  private finishRace(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.finish();
    const allProgress = [this.totalPlayerProgress(), ...this.bots.map((bot) => bot.totalProgress)];
    const position = 1 + allProgress.slice(1).filter((value) => value > allProgress[0]!).length;
    this.pendingResult = {
      position,
      totalTimeMs: Math.round(this.elapsedMs),
      bestLapMs: Math.round(this.progress.bestLapMs ?? this.elapsedMs),
      boostsUsed: this.boostsUsed,
    };
    this.banner = { text: position === 1 ? "PHOTO FINISH / P1" : `FINISH / P${position}`, until: Number.POSITIVE_INFINITY };
    this.burst(this.player.position, 32, 8);
  }

  private completeFinish(): void {
    if (this.finishReported || !this.pendingResult) return;
    this.finishReported = true;
    this.options.onFinish(this.pendingResult);
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
    if (event.code === "KeyE" && !event.repeat) this.itemQueued = true;
    if (event.code === "KeyR" && !event.repeat) this.respawnQueued = true;
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
    const steerTarget = axis !== 0 ? Math.max(-1, Math.min(1, axis)) : left === right ? 0 : left ? -1 : 1;
    const response = axis !== 0 ? .34 : steerTarget === 0 ? .28 : .2;
    this.steerValue += (steerTarget - this.steerValue) * response;
    if (Math.abs(this.steerValue) < .012) this.steerValue = 0;
    const gamepadItem = gamepad?.buttons[2]?.pressed === true || gamepad?.buttons[3]?.pressed === true;
    if (gamepadItem && !this.gamepadItemHeld) this.itemQueued = true;
    this.gamepadItemHeld = gamepadItem;
    const input = sanitizeInput({
      sequence: ++this.sequence,
      steer: this.steerValue,
      throttle: this.keys.has("KeyW") || this.keys.has("ArrowUp") || this.touch.get("throttle") === true ? 1 : gamepad?.buttons[7]?.value ?? 0,
      brake: this.keys.has("KeyS") || this.keys.has("ArrowDown") || this.touch.get("brake") === true ? 1 : gamepad?.buttons[6]?.value ?? 0,
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
  roulette(): void { this.tone(520, 610, .045); }
  boost(): void { this.tone(160, 580, .2); }
  launch(): void { this.tone(240, 740, .16); }
  drop(): void { this.tone(210, 120, .12); }
  shield(): void { this.tone(360, 920, .22); }
  shieldBreak(): void { this.tone(780, 170, .28); }
  impact(): void { this.tone(145, 72, .18); }
  jump(): void { this.tone(260, 540, .14); }
  land(): void { this.tone(120, 80, .12); }
  lastLap(): void { this.tone(340, 1040, .5); }
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
