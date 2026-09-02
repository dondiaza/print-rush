import {
  Color3,
  Engine,
  Mesh,
  Scene,
  SceneInstrumentation,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  ItemDefinitions,
  SeededRandom,
  VehicleConfig,
  advanceRaceProgress,
  applyBoost,
  createKartState,
  createRaceProgress,
  isWrongWay,
  launch,
  pickWeightedItem,
  queryWall,
  rankPlayers,
  raceProgress,
  resolveGround,
  resolveKartPair,
  resolveWall,
  sampleTrack,
  setVelocityAlongHeading,
  simulateKart,
  surfaceGrip,
  travelSpeed,
  type AllowedLaps,
  type ItemDefinition,
  type KartState,
  type RaceProgress,
  type TrackSample,
} from "@print-rush/game-core";
import type { CharacterDefinition, KartDefinition } from "@print-rush/3d-factory";
import { CharacterPresets, KartPresets } from "@print-rush/3d-factory";
import { buildTrack, visualsForTheme, type BuiltTrack } from "./TrackBuilder";
import { BotDriver, BotSkills } from "./BotDriver";
import { InputControllerV5, type TouchState } from "./InputControllerV5";
import { ItemManager, type ItemTarget } from "./ItemManager";
import { AudioDirector } from "@/render/AudioDirector";
import { VFXSystem } from "@/render/VFXSystem";
import {
  DesktopCameraProfile,
  MobileCameraProfile,
  RaceCameraV5,
  type CameraContext,
} from "@/render/RaceCameraV5";
import { animateKartWheels, createKart, setKartPose } from "./createKart";
import { animateCharacter, type CharacterVisual } from "@/render/CharacterBuilder";
import { characterVisualOf } from "@/factory/GeneratedCharacter";
import { getDeviceReport, getHardwareScalingLevel, qualityForProfile } from "@/performance/PerformanceManager";
import type { StoredTrack } from "@/factory/TrackFactory";
import { AssetCatalog, circuitKeyForTheme } from "@/render/AssetCatalog";
import { FAMILIES_BY_THEME } from "@/render/DecalScatter";

/**
 * GAME RUNTIME V5.
 *
 * Rebuilt on the new foundations rather than adapted to them. What used to live inside this class as
 * inline code now lives in modules that the server can also use or that can be tested on their own:
 * the vehicle model and collision in `game-core`, the camera in `RaceCameraV5`, lighting and
 * materials in the render layer, opponents in `BotDriver`.
 *
 * Rapier is gone. V4 loaded the whole WASM runtime to create a flat floor collider and a kinematic
 * body that copied the kart's position, resolving nothing; collision is now analytic against the
 * track's own geometry, which is faster and gives the client and the authoritative server the same
 * answer.
 */

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
  /** The held item's id, for the HUD's icon lookup. Null when empty-handed. */
  itemId: string | null;
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
  /** V5 additions. */
  slipAngleDeg: number;
  drifting: boolean;
  boostTier: number;
  lapDistance: number;
  lapLength: number;
  fps: number;
  /** Drift chaining: the reserve bank, the chain length and the last grade. */
  boostReserve: number;
  driftChain: number;
  driftGrade: string;
  /** 1 while an execution window is open, so the HUD can flash the tap cue. */
  driftWindowOpen: boolean;
  /** Short-lived grade text, separate from the main banner so both can show at once. */
  driftCue: string | null;
  perfectDrifts: number;
  maxSpeedKph: number;
};

export type RaceResult = {
  position: number;
  totalTimeMs: number;
  bestLapMs: number;
  boostsUsed: number;
  /** Drift windows hit perfectly across the race. The skill statistic. */
  perfectDrifts: number;
  maxSpeedKph: number;
};

type GameRuntimeOptions = {
  laps: AllowedLaps;
  muted: boolean;
  onHud: (state: HudState) => void;
  onFinish: (result: RaceResult) => void;
  character: CharacterDefinition;
  kartDefinition: KartDefinition;
  trackDefinition: StoredTrack;
  /**
   * Real download progress, for the loading screen. Fires once per settled asset — there is no
   * timer behind it, so if it stops moving something is genuinely still in flight.
   */
  onProgress?: (progress: LoadProgress) => void;
};

/**
 * Turns an asset id into something a loading screen can show.
 *
 * Not decoration: the id is the only thing that identifies what a stalled download is waiting for,
 * and `mat_paintedmetal_press_normal` in front of a player is worse than a category name.
 */
function labelForAsset(id: string): string {
  if (id.startsWith("backdrop_")) return "Fondo del circuito";
  if (id.startsWith("kart_wrap_")) return "Vinilo del kart";
  if (id.startsWith("decal_")) return "Marcas y desgaste";
  if (id.startsWith("poster_")) return "Carteles y gráfica";
  if (id.startsWith("sprite_")) return "Público y ambiente";
  if (id.startsWith("ui_")) return "Iconos";
  return "Materiales";
}

export type LoadProgress = {
  loaded: number;
  total: number;
  /** What is being waited on, for a loading screen that says something true. */
  label: string;
};

/**
 * Everything that has to exist before the track can be built.
 *
 * The engine and scene are created here rather than in the constructor because textures need a
 * scene to load into, and they must be loaded *before* `buildTrack` runs — a material cannot pick up
 * a texture that arrives after it was created. So boot is: engine, scene, download, then build.
 */
type Boot = {
  engine: Engine;
  scene: Scene;
  quality: ReturnType<typeof qualityForProfile>;
  mobile: boolean;
  hardwareScaling: number;
  catalog: AssetCatalog | null;
};

/**
 * The assets one race needs: the shared material set plus this circuit's own, the panorama, and the
 * player's livery.
 *
 * Ids are filtered against the manifest inside `preload`, so a name that the bake does not carry is
 * dropped from the total rather than stalling the bar. That is why this can list what the race wants
 * without first checking what exists.
 */
function assetIdsForRace(catalog: AssetCatalog, theme: string, liveries: readonly string[]): string[] {
  const circuit = circuitKeyForTheme(theme);
  // Only the decal families this theme actually scatters. Downloading all seven would add weight for
  // marks that would never be placed — an office floor is not going to get an ink splash.
  const families = new Set(FAMILIES_BY_THEME[theme] ?? []);
  const ids = catalog.manifest.assets
    .filter((asset) => {
      if (asset.category === "decal") {
        return [...families].some((family) => asset.id.startsWith(`decal_${family}_`));
      }
      // Shared assets, plus this circuit's. Another circuit's set is not downloaded until it is
      // selected, which is what keeps the per-race weight inside the budget.
      return asset.circuit === undefined || asset.circuit === circuit;
    })
    .map((asset) => asset.id);
  // Every livery on the grid, not just the player's. Four wraps is under a megabyte and it is the
  // difference between a field of four distinct karts and one painted kart plus three plain ones.
  for (const livery of new Set(liveries)) {
    const wrap = catalog.wrap(livery);
    if (wrap) ids.push(wrap.id);
  }
  return ids;
}

type Racer = {
  id: string;
  kart: KartState;
  visual: TransformNode;
  /** The driver's animation nodes, so head, arms, lean and blink can be driven from kart state. */
  driverVisual: CharacterVisual | null;
  /** Raised by an impact and decayed, so the driver flinches rather than sitting rigid. */
  flinch: number;
  sample: TrackSample;
  cursor: number;
  progress: RaceProgress;
  driver: BotDriver | null;
};

/** 120 Hz simulation. Doubling V4's rate makes wall response and drift entry far more consistent. */
const FIXED_STEP = 1 / 120;
const MAX_STEPS = 10;

export class GameRuntime {
  private readonly engine: Engine;
  private readonly scene: Scene;
  /** Baked assets for this race, or null when the manifest could not be read. */
  private readonly catalog: AssetCatalog | null;
  private readonly instrumentation: SceneInstrumentation;
  private readonly camera: RaceCameraV5;
  private readonly input = new InputControllerV5();
  private readonly audio: AudioDirector;
  private readonly vfx: VFXSystem;
  private readonly items: ItemManager;
  private readonly track: BuiltTrack;
  private readonly racers: Racer[] = [];
  private readonly player: Racer;
  private readonly shieldMesh: Mesh;

  private accumulator = 0;
  private elapsedMs = 0;
  private countdown = 3.6;
  private frameMs = 16.7;
  private disposed = false;
  private finished = false;
  private finishDelay = 0;
  private finishReported = false;
  private pendingResult: RaceResult | null = null;

  private heldItem: ItemDefinition | null = null;
  private roulette: { item: ItemDefinition; until: number; nextTick: number } | null = null;
  private readonly random = new SeededRandom((Date.now() ^ 0x51f15e) >>> 0);
  private boostsUsed = 0;
  private launchCharge = 0;
  private banner: { text: string; until: number } | null = null;
  private lastLapAnnounced = false;
  private wrongWayTime = 0;
  private shieldUntil = 0;
  private inkedUntil = 0;
  private shuffledUntil = 0;
  private hitImmunityUntil = 0;
  private incomingUntil = 0;
  private lastHudAt = 0;
  /** Short-lived drift grade text, shown separately from the main banner. */
  private driftCue: { text: string; until: number } | null = null;
  private perfectDrifts = 0;
  private maxSpeedReached = 0;
  /** Angle of the finish orbit, radians. */
  private finishOrbit = 0;

  private readonly cameraContext: CameraContext = { aimPoint: new Vector3(), floorY: 0 };
  private readonly scratch = new Vector3();

  private constructor(private readonly options: GameRuntimeOptions, boot: Boot) {
    const { quality, mobile, catalog } = boot;
    this.engine = boot.engine;
    this.scene = boot.scene;
    this.catalog = catalog;
    this.instrumentation = new SceneInstrumentation(this.scene);

    const baked = options.trackDefinition.baked;

    // The camera exists before the lighting rig so the post-processing pipeline can attach to it.
    this.camera = new RaceCameraV5(this.scene, mobile ? MobileCameraProfile : DesktopCameraProfile);

    this.track = buildTrack(this.scene, baked, {
      quality,
      density: quality === "LOW" ? 0.45 : quality === "MEDIUM" ? 0.7 : 1,
      catalog,
    });
    this.track.lighting.attachCamera(this.camera.camera);

    const visuals = visualsForTheme(baked.blueprint.theme);
    this.vfx = new VFXSystem(this.scene, { quality, accentA: visuals.accentA, accentB: visuals.accentB });
    this.items = new ItemManager(
      this.scene,
      this.track.materials,
      this.vfx,
      visuals.accentA,
      visuals.accentB,
    );
    this.audio = new AudioDirector({ muted: options.muted, theme: baked.blueprint.theme });

    // ---------------------------------------------------------------- player
    const spawn = baked.definition.spawnPoints[0]!;
    const playerVisual = createKart(this.scene, "player", {
      body: Color3.FromHexString(visuals.accentA),
      accent: Color3.FromHexString(visuals.accentB),
      shirt: Color3.FromHexString("#f7f2e8"),
      skin: Color3.FromHexString("#d99b72"),
    }, true, {
      character: options.character,
      kart: options.kartDefinition,
      quality: quality === "LOW" ? "LOW" : quality === "MEDIUM" ? "MEDIUM" : "HIGH",
      wrap: catalog?.wrapTexture(options.kartDefinition.livery ?? "NONE") ?? null,
    });
    playerVisual.getChildMeshes().forEach((mesh) => this.track.lighting.addShadowCaster(mesh));

    this.player = this.createRacer("player", spawn, playerVisual, null);
    this.racers.push(this.player);

    // ---------------------------------------------------------------- opponents
    BotSkills.forEach((skill, index) => {
      const botSpawn = baked.definition.spawnPoints[index + 1] ?? spawn;
      const botKart = KartPresets[(index + 1) % KartPresets.length]!;
      const visual = createKart(this.scene, `bot-${index}`, {
        body: Color3.FromHexString(["#4db7ff", "#ff7b2f", "#8f5cff"][index] ?? "#4db7ff"),
        accent: Color3.FromHexString(["#ffdd45", "#7dffef", "#f7f2e8"][index] ?? "#ffdd45"),
        shirt: Color3.FromHexString(index === 1 ? "#17141b" : "#f7f2e8"),
        skin: Color3.FromHexString(index === 2 ? "#70462e" : "#efb087"),
      }, true, {
        character: CharacterPresets[(index + 1) % CharacterPresets.length]!,
        kart: botKart,
        quality: quality === "HIGH" || quality === "ULTRA" ? "MEDIUM" : "LOW",
        // Preloaded alongside the player's, so the grid is four distinct karts.
        wrap: catalog?.wrapTexture(botKart.livery ?? "NONE") ?? null,
      });
      // Only the player casts into the shadow map on lower tiers; four full karts of casters was one
      // of the measured problems with the V4 scene.
      if (quality === "HIGH" || quality === "ULTRA") {
        visual.getChildMeshes().forEach((mesh) => this.track.lighting.addShadowCaster(mesh));
      }
      // Seeded per slot so a race replays identically rather than depending on Math.random.
      this.racers.push(this.createRacer(`bot-${index}`, botSpawn, visual, new BotDriver(skill, index + 1)));
    });

    this.shieldMesh = this.vfx.createShield(playerVisual);
  }

  private createRacer(
    id: string,
    spawn: { position: { x: number; y: number; z: number }; rotation: number },
    visual: TransformNode,
    driver: BotDriver | null,
  ): Racer {
    const kart = createKartState(spawn.position.x, spawn.position.z, spawn.rotation, spawn.position.y);
    const definition = this.track.baked.definition;
    const sample = sampleTrack(definition, kart.position, -1);
    setKartPose(visual, new Vector3(kart.position.x, kart.position.y, kart.position.z), kart.rotation);
    // The driver was parented to the kart at build time; find its animation nodes once here rather
    // than searching the hierarchy every frame.
    const driverNode = visual.getChildTransformNodes(true).find((node) => node.name.endsWith("-driver"));
    return {
      id,
      kart,
      visual,
      driverVisual: driverNode ? characterVisualOf(driverNode) : null,
      flinch: 0,
      sample,
      cursor: sample.index,
      progress: createRaceProgress(),
      driver,
    };
  }

  /**
   * Boots a race: engine, scene, asset download, then the world.
   *
   * The await is the point. Materials are created synchronously during `buildTrack`, so every
   * texture they might use has to be resident first; loading them afterwards would leave the first
   * race of a session running on the procedural fallback while the files sat unused in cache.
   */
  static async create(canvas: HTMLCanvasElement, options: GameRuntimeOptions): Promise<GameRuntime> {
    const device = getDeviceReport();
    const quality = qualityForProfile(device.profile);
    const mobile = device.profile === "LOW" || window.matchMedia("(pointer: coarse)").matches;

    const engine = new Engine(canvas, quality !== "LOW", {
      antialias: quality !== "LOW",
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    const hardwareScaling = getHardwareScalingLevel(device.profile);
    engine.setHardwareScalingLevel(hardwareScaling);

    const scene = new Scene(engine);
    scene.skipPointerMovePicking = true;

    options.onProgress?.({ loaded: 0, total: 1, label: "Catálogo de assets" });
    const catalog = await AssetCatalog.load();

    if (catalog) {
      const theme = options.trackDefinition.baked.blueprint.theme;
      const liveries = [
        options.kartDefinition.livery ?? "NONE",
        ...BotSkills.map((_skill, index) => KartPresets[(index + 1) % KartPresets.length]!.livery ?? "NONE"),
      ];
      const ids = assetIdsForRace(catalog, theme, liveries);
      await catalog.preload(scene, ids, (loaded, total, id) => {
        options.onProgress?.({ loaded, total, label: labelForAsset(id) });
      });
    } else {
      // Not an error: the procedural generator covers every surface. Worth saying out loud, though,
      // because "the game looks flatter than it should" is otherwise a mystery.
      console.warn("[assets] manifest unavailable; falling back to procedural textures");
    }

    options.onProgress?.({ loaded: 1, total: 1, label: "Construyendo circuito" });
    return new GameRuntime(options, { engine, scene, quality, mobile, hardwareScaling, catalog });
  }

  start(): void {
    this.input.attach();
    this.audio.start();
    const resize = (): void => this.engine.resize();
    const run = (): void => this.frame();
    const visibility = (): void => {
      if (document.hidden) {
        this.engine.stopRenderLoop();
        this.audio.setPaused(true);
      } else if (!this.disposed) {
        this.engine.runRenderLoop(run);
        this.audio.setPaused(this.input.paused);
      }
    };
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    this.engine.onDisposeObservable.add(() => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    });
    this.engine.runRenderLoop(run);
  }

  setTouchControl(control: "left" | "right" | "throttle" | "brake" | "drift", active: boolean): void {
    // Kept for the existing HUD. The analogue path is `setTouchState`.
    if (control === "left") this.input.setTouch({ stickX: active ? -1 : 0 });
    else if (control === "right") this.input.setTouch({ stickX: active ? 1 : 0 });
    else this.input.setTouch({ [control]: active } as Partial<TouchState>);
  }

  setTouchState(patch: Partial<TouchState>): void {
    this.input.setTouch(patch);
  }

  useItem(): void {
    this.input.queueItem();
  }

  respawn(): void {
    this.input.queueRespawn();
  }

  setPaused(paused: boolean): void {
    this.input.paused = paused;
    this.audio.setPaused(paused);
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.detach();
    this.audio.setMusicPhase("NONE", this.track.baked.blueprint.theme);
    this.items.dispose();
    this.audio.dispose();
    this.instrumentation.dispose();
    this.vfx.dispose();
    this.track.dispose();
    this.catalog?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  // ------------------------------------------------------------------ loop

  private frame(): void {
    if (this.disposed) return;
    const delta = Math.min(80, this.engine.getDeltaTime());
    this.frameMs = this.frameMs * 0.92 + delta * 0.08;

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
    this.emitHud();
  }

  private fixedUpdate(dt: number): void {
    if (this.input.paused) return;

    const definition = this.track.baked.definition;

    // ---------------------------------------------------------------- countdown
    if (this.countdown > 0) {
      const gridInput = this.input.snapshot(dt);
      // The launch window rewards releasing into the lights rather than mashing from the start.
      if (this.countdown < 0.85 && gridInput.throttle > 0.5) this.launchCharge += dt;
      const previous = Math.ceil(this.countdown);
      this.countdown = Math.max(0, this.countdown - dt);
      const now = Math.ceil(this.countdown);
      if (now !== previous && now > 0) this.audio.countdownTick(now);
      if (this.countdown === 0) {
        this.player.progress.currentLapStartedAt = performance.now();
        if (this.launchCharge >= 0.16 && this.launchCharge <= 0.72) {
          this.player.kart = applyBoost(this.player.kart, VehicleConfig.launchBoostSeconds, 2);
          this.banner = { text: "PERFECT PRINT!", until: this.elapsedMs + 1_100 };
          this.camera.impulse({ punch: 0.8 });
          this.vfx.burst("BOOST_FIRE", this.vectorOf(this.player.kart), 1);
        } else {
          this.banner = { text: "GO!", until: this.elapsedMs + 800 };
        }
        this.audio.go();
        this.audio.setMusicPhase("RACE", this.track.baked.blueprint.theme);
      }
      return;
    }

    this.elapsedMs += dt * 1_000;

    // ---------------------------------------------------------------- inputs and simulation
    for (const racer of this.racers) {
      const grip = surfaceGrip(racer.sample.offRoad ? "OFFROAD" : racer.sample.surface);

      let input;
      if (racer.driver) {
        // Rubber band from the player's relative position, applied to the bot's target speed only.
        const gap = this.totalProgress(this.player) - this.totalProgress(racer);
        input = racer.driver.update(racer.kart, racer.sample, definition, dt, Math.max(-1, Math.min(1, gap * 3)));
        // Physical recovery is attempted by the driver itself; a respawn is the last resort, and it
        // is the runtime's call because the runtime owns the track's recovery points.
        if (racer.driver.needsRespawn) {
          this.recover(racer);
          racer.driver.clearStuck();
          continue;
        }
      } else if (this.finished) {
        input = this.autopilot(racer, dt);
      } else {
        input = this.input.snapshot(dt);
        if (input.useItem && this.heldItem) {
          this.activateItem(this.heldItem, input.brake > 0.15);
          this.heldItem = null;
        }
        if (input.respawn) {
          this.recover(racer);
          continue;
        }
      }

      racer.kart = simulateKart(racer.kart, input, dt, grip);

      // The drift system reports what it did this step; feedback is driven from that rather than
      // from the runtime re-deriving the same transitions.
      const drift = racer.kart.lastDriftEvent;
      if (racer === this.player) this.reactToDrift(drift);

      racer.sample = sampleTrack(definition, racer.kart.position, racer.cursor);
      racer.cursor = racer.sample.index;

      const landing = resolveGround(racer.kart, racer.sample.groundY + 0.42, dt);
      if (landing.landed && racer === this.player) {
        this.camera.impulse({ shake: Math.min(0.5, landing.impact / 26), dip: Math.min(0.9, landing.impact / 18) });
        if (landing.impact > 4) this.audio.land(landing.impact);
        this.vfx.burst("LANDING", this.vectorOf(racer.kart), Math.min(1, landing.impact / 14));
      }
      if (landing.boostSeconds > 0) {
        racer.kart = applyBoost(racer.kart, landing.boostSeconds, landing.trickLanded ? 2 : 1);
        if (racer === this.player) {
          this.banner = {
            text: landing.trickLanded ? "TRICK LANDED!" : "CLEAN LANDING",
            until: this.elapsedMs + 800,
          };
          if (landing.trickLanded) {
            this.camera.impulse({ punch: 0.55 });
            this.vfx.burst("BOOST_FIRE", this.vectorOf(racer.kart), 1);
          }
        }
      }

      const wall = queryWall(racer.sample, VehicleConfig.collisionRadius);
      if (wall) {
        const hit = resolveWall(racer.kart, wall.normal, wall.penetration);
        if (hit && racer === this.player) {
          /**
           * Response scales with the kind of impact rather than being one effect at one strength.
           * A scrape is sparks and a nudge; a heavy hit shakes the camera hard and throws debris.
           * The impact cooldown inside `resolveWall` is what stops a grind reporting this every step.
           */
          const weight = hit.kind === "HEAVY" ? 1 : hit.kind === "FRONTAL" ? 0.7 : 0.3;
          this.camera.impulse({ shake: hit.severity * weight });
          this.audio.impact(hit.kind === "SCRAPE" ? racer.sample.surface : "KART", hit.severity * weight);
          this.vfx.burst(hit.kind === "SCRAPE" ? "SPARK" : "IMPACT", this.vectorOf(racer.kart), hit.severity);
          if (hit.kind === "HEAVY") this.banner = { text: "OUCH", until: this.elapsedMs + 500 };
        }
      }

      // Falling out of the world is always recoverable, and quickly.
      if (racer.kart.position.y < definition.bounds.minY + 2) this.recover(racer);
    }

    // ---------------------------------------------------------------- kart-to-kart contact
    for (let a = 0; a < this.racers.length; a += 1) {
      for (let b = a + 1; b < this.racers.length; b += 1) {
        const severity = resolveKartPair(this.racers[a]!.kart, this.racers[b]!.kart);
        if (severity > 0.12 && (this.racers[a] === this.player || this.racers[b] === this.player)) {
          this.camera.impulse({ shake: severity * 0.5 });
          this.audio.impact("KART", severity);
        }
      }
    }

    // ---------------------------------------------------------------- items and features
    this.items.update(dt, this.itemTargets());
    const threat = this.items.incomingThreat(this.player.kart.position, this.player.id);
    if (threat !== null && threat < 22) this.incomingUntil = this.elapsedMs + 220;
    this.updateFeatures(dt);
    this.updateRoulette();

    // ---------------------------------------------------------------- race progress
    for (const racer of this.racers) {
      racer.progress = advanceRaceProgress(
        racer.progress,
        racer.kart.position,
        definition,
        this.options.laps,
        performance.now(),
        racer.cursor,
      );
    }

    if (this.player.progress.finishedAt !== null && !this.finished) this.finishRace();
    if (this.finished) {
      this.finishDelay += dt;
      if (this.finishDelay >= 2.6) this.completeFinish();
    }

    if (this.player.progress.lap === this.options.laps && !this.lastLapAnnounced && this.options.laps > 1) {
      this.lastLapAnnounced = true;
      this.banner = { text: "FINAL LAP / FULL SEND", until: this.elapsedMs + 1_900 };
      this.audio.finalLap();
      // The same transport, 14 % faster with the lead unmuted, so the lift lands on the beat.
      this.audio.setMusicPhase("FINAL_LAP", this.track.baked.blueprint.theme);
    }

    const wrong = isWrongWay(this.player.kart.rotation, this.player.kart.position, definition, this.player.cursor);
    this.wrongWayTime = wrong ? this.wrongWayTime + dt : Math.max(0, this.wrongWayTime - dt * 2);
    if (this.wrongWayTime > 1.6) this.banner = { text: "DIRECCIÓN INCORRECTA", until: this.elapsedMs + 300 };

    // ---------------------------------------------------------------- audio
    // Boost feedback is fired by whatever granted the boost — `reactToDrift` for a drift payout,
    // `updateFeatures` for a pad, `activateItem` for an item. Detecting it again from the state here
    // is what made the boost sound play twice and double-counted the boost statistic.
    const kart = this.player.kart;
    this.maxSpeedReached = Math.max(this.maxSpeedReached, travelSpeed(kart));
    this.audio.update(travelSpeed(kart) / VehicleConfig.boostedMaxSpeed, kart.boostRemaining > 0, kart.driftActive);
  }

  private autopilot(racer: Racer, dt: number) {
    const definition = this.track.baked.definition;
    const nodes = definition.nodes;
    const target = nodes[(racer.cursor + 10) % nodes.length]!;
    const desired = Math.atan2(target.x - racer.kart.position.x, target.z - racer.kart.position.z);
    let delta = desired - racer.kart.rotation;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    void dt;
    return {
      sequence: 0,
      steer: Math.max(-1, Math.min(1, delta * 1.7)),
      throttle: 0.7,
      brake: 0,
      drift: false,
      useItem: false,
      respawn: false,
    };
  }

  private updateFeatures(dt: number): void {
    const playerPosition = this.vectorOf(this.player.kart);

    for (const pad of this.track.boostPads) {
      pad.cooldown = Math.max(0, pad.cooldown - dt);
      for (const racer of this.racers) {
        if (Vector3.DistanceSquared(pad.position, this.vectorOf(racer.kart)) > 30) continue;
        if (racer === this.player && pad.cooldown > 0) continue;
        racer.kart = applyBoost(racer.kart, VehicleConfig.boostSeconds, 2);
        if (racer === this.player) {
          // A pad grants its own feedback now that the state-diff boost detector is gone.
          pad.cooldown = 1.1;
          this.boostsUsed += 1;
          this.audio.boost(2);
          this.camera.impulse({ punch: 0.55 });
          this.vfx.burst("BOOST_FIRE", this.vectorOf(racer.kart), 1);
        }
      }
    }

    for (const ramp of this.track.jumpPads) {
      ramp.cooldown = Math.max(0, ramp.cooldown - dt);
      for (const racer of this.racers) {
        if (!racer.kart.grounded) continue;
        if (Vector3.DistanceSquared(ramp.position, this.vectorOf(racer.kart)) > 44) continue;
        if (travelSpeed(racer.kart) < 12) continue;
        launch(racer.kart, 8.8 * ramp.power);
        if (racer === this.player) {
          this.camera.impulse({ shake: 0.16 });
          this.audio.jump();
        }
      }
    }

    for (const box of this.track.itemBoxes) {
      box.cooldown = Math.max(0, box.cooldown - dt);
      box.node?.setEnabled(box.cooldown === 0);
      if (box.cooldown > 0 || this.heldItem || this.roulette) continue;
      if (Vector3.DistanceSquared(box.position, playerPosition) > 9) continue;
      const leader = Math.min(...this.racers.map((racer) => -this.totalProgress(racer)));
      const gap = Math.max(0, -leader - this.totalProgress(this.player)) * this.track.baked.definition.lengthMeters;
      const item = pickWeightedItem(this.estimatePosition(), this.random, gap);
      this.roulette = { item, until: this.elapsedMs + 900, nextTick: this.elapsedMs };
      box.cooldown = 6;
      box.node?.setEnabled(false);
      this.audio.pickup();
      this.vfx.burst("ITEM_PICKUP", box.position, 1);
    }

    for (const hazard of this.track.hazards) {
      hazard.cooldown = Math.max(0, hazard.cooldown - dt);
      const active = Math.sin(this.elapsedMs * 0.0017 + hazard.progress * 11) > 0.6;
      if (!active || hazard.cooldown > 0) continue;
      if (Vector3.DistanceSquared(hazard.position, playerPosition) > 14) continue;
      this.receiveHit({ ...ItemDefinitions.stickerMine, shortName: "HAZARD" });
      hazard.cooldown = 2.4;
    }

    // Shortcuts pay a small, continuous boost while the player commits to the risky line.
    for (const shortcut of this.track.shortcuts) {
      for (const pad of shortcut.pads) {
        if (Vector3.DistanceSquared(pad, playerPosition) > 24) continue;
        this.player.kart = applyBoost(this.player.kart, 0.1, 1);
        break;
      }
    }
  }

  private updateRoulette(): void {
    if (!this.roulette) return;
    if (this.elapsedMs >= this.roulette.until) {
      this.heldItem = this.roulette.item;
      this.banner = { text: `${this.heldItem.name.toUpperCase()} READY`, until: this.elapsedMs + 1_000 };
      this.roulette = null;
    } else if (this.elapsedMs >= this.roulette.nextTick) {
      this.roulette.nextTick += 90;
      this.audio.roulette();
    }
  }

  /**
   * Builds the view of the field the item system needs. Rebuilt per use rather than cached, because
   * it closes over the hit handlers and there are at most four racers.
   */
  private itemTargets(): ItemTarget[] {
    return this.racers.map((racer) => ({
      id: racer.id,
      kart: racer.kart,
      progress: this.totalProgress(racer),
      onHit: (item, severity) => {
        if (racer === this.player) this.receiveHit(item);
        else this.applyBotHit(racer, item, severity);
      },
      shielded: () => racer === this.player && this.elapsedMs < this.shieldUntil,
      onShieldBreak: () => {
        if (racer !== this.player) return;
        this.shieldUntil = 0;
        this.banner = { text: "SHIELD BREAK", until: this.elapsedMs + 760 };
        this.audio.shieldBreak();
      },
    }));
  }

  /** An opponent taking a hit. Same shape of penalty the player gets, without the screen effects. */
  private applyBotHit(racer: Racer, item: ItemDefinition, severity: number): void {
    if (racer.kart.impactCooldown > 0) return;
    racer.kart.impactCooldown = 0.9;
    const loss = Math.max(0.45, 1 - item.power * 0.5 * severity);
    racer.kart.speed *= loss;
    racer.kart.velocity.x *= loss;
    racer.kart.velocity.z *= loss;
    racer.kart.rotation += (this.random.next() - 0.5) * item.power * 0.6;
  }

  private activateItem(item: ItemDefinition, backwards: boolean): void {
    const position = this.vectorOf(this.player.kart);
    const targets = this.itemTargets();
    const owner = targets.find((target) => target.id === this.player.id)!;

    // Projectiles, traps and areas become real objects in the world. Everything else acts on the
    // owner, which is state this runtime holds rather than something the item system can touch.
    const spawned = this.items.use(item, owner, backwards, targets);

    if (spawned) {
      this.audio.launch();
    } else if (item.category === "BOOST") {
      this.player.kart = applyBoost(this.player.kart, item.duration, 3);
      this.camera.impulse({ punch: 0.7 });
      this.vfx.burst("BOOST_FIRE", position, 1);
      this.audio.boost(3);
    } else if (item.id === "package-shield" || item.id === "size-tag") {
      this.shieldUntil = this.elapsedMs + item.duration * 1_000;
      this.vfx.burst("SHIELD", position, 1);
      this.audio.shield();
    } else if (item.id === "magnetic-tag") {
      // Catch-up: a short tow toward whoever is next up the road, not a free hit on them.
      this.player.kart = applyBoost(this.player.kart, 0.55, 2);
      this.camera.impulse({ punch: 0.4 });
      this.audio.boost(2);
    } else if (item.id === "mega-print") {
      // An area burst around the player: everyone nearby is shoved, which is its counterplay —
      // stay out of range.
      for (const target of targets) {
        if (target.id === this.player.id) continue;
        const distance = Math.hypot(
          target.kart.position.x - this.player.kart.position.x,
          target.kart.position.z - this.player.kart.position.z,
        );
        if (distance < 12) target.onHit(item, 1);
      }
      this.vfx.burst("IMPACT", position, 1);
      this.camera.impulse({ shake: 0.5 });
      this.audio.impact("KART", 1);
    } else {
      this.player.kart = applyBoost(this.player.kart, 0.35, 1);
      this.audio.launch();
    }

    this.banner = {
      text: `${backwards ? "BACKSHOT / " : ""}${item.name.toUpperCase()}`,
      until: this.elapsedMs + 900,
    };
  }

  /**
   * Feedback for the drift chaining system. The grade is the whole point of the mechanic, so it has
   * to be unmistakable the instant it lands — a window cue, a distinct sound per grade, and a colour
   * on the kart's own smoke rather than a number in a corner of the HUD.
   */
  private reactToDrift(drift: KartState["lastDriftEvent"]): void {
    if (drift.started) {
      this.audio.jump();
      this.camera.impulse({ shake: 0.1 });
    }
    if (drift.windowOpened) {
      this.audio.roulette();
      this.driftCue = { text: "TAP", until: this.elapsedMs + 240 };
    }
    if (drift.grade === "PERFECT") {
      this.perfectDrifts += 1;
      this.audio.driftRelease(3);
      this.camera.impulse({ punch: 0.22 });
      this.vfx.burst("ITEM_PICKUP", this.vectorOf(this.player.kart), 1);
      this.driftCue = { text: "PERFECT", until: this.elapsedMs + 620 };
    } else if (drift.grade === "GOOD") {
      this.audio.driftRelease(1);
      this.driftCue = { text: "GOOD", until: this.elapsedMs + 500 };
    } else if (drift.grade === "MISS") {
      this.driftCue = { text: "MISS", until: this.elapsedMs + 420 };
    }
    if (drift.released && drift.boostSeconds > 0) {
      this.boostsUsed += 1;
      this.audio.boost(drift.tier);
      this.camera.impulse({ punch: 0.35 + drift.tier * 0.16 });
      this.vfx.burst("BOOST_FIRE", this.vectorOf(this.player.kart), 1);
      if (drift.chain >= 2) {
        this.driftCue = { text: `CHAIN x${drift.chain}`, until: this.elapsedMs + 900 };
      }
    }
  }

  private receiveHit(item: ItemDefinition): void {
    if (this.elapsedMs < this.hitImmunityUntil) return;
    if (this.elapsedMs < this.shieldUntil) {
      this.shieldUntil = 0;
      this.banner = { text: "SHIELD BREAK", until: this.elapsedMs + 760 };
      this.vfx.burst("SHIELD", this.vectorOf(this.player.kart), 1);
      this.audio.shieldBreak();
      return;
    }
    this.hitImmunityUntil = this.elapsedMs + 1_250;
    this.player.flinch = 1;
    const kart = this.player.kart;
    const loss = Math.max(0.5, 1 - item.power * 0.45);
    kart.speed *= loss;
    kart.velocity.x *= loss;
    kart.velocity.z *= loss;
    kart.rotation += (this.random.next() - 0.5) * item.power * 0.7;
    this.camera.impulse({ shake: 0.7 });
    this.vfx.burst("IMPACT", this.vectorOf(kart), 1);
    if (item.id === "ink-blast") this.inkedUntil = this.elapsedMs + 2_400;
    if (item.id === "design-shuffle") this.shuffledUntil = this.elapsedMs + 3_200;
    this.banner = { text: `${item.shortName} HIT!`, until: this.elapsedMs + 760 };
    this.audio.impact("KART", 1);
  }

  private recover(racer: Racer): void {
    const nodes = this.track.baked.definition.nodes;
    const node = nodes[racer.cursor]!;
    const ahead = nodes[(racer.cursor + 6) % nodes.length]!;
    const heading = Math.atan2(ahead.x - node.x, ahead.z - node.z);
    racer.kart = createKartState(node.x, node.z, heading, node.y + 0.42);
    setVelocityAlongHeading(racer.kart, 12);
    racer.sample = sampleTrack(this.track.baked.definition, racer.kart.position, racer.cursor);
    if (racer === this.player) {
      this.camera.reset(racer.kart);
      this.banner = { text: "BACK IN PRINT", until: this.elapsedMs + 800 };
    }
  }

  // ------------------------------------------------------------------ visuals

  private updateVisuals(dt: number): void {
    const now = performance.now();
    const seconds = now / 1_000;

    for (const racer of this.racers) {
      const kart = racer.kart;
      setKartPose(racer.visual, this.vectorOf(kart), kart.rotation);
      racer.visual.rotation.z = kart.lean + kart.trickRotation * 0.35;
      // Pitch is the sense of mass: nose down under braking, up under power.
      racer.visual.rotation.x = kart.pitch + kart.suspension * 0.08;
      // Metres travelled this frame, so the wheels roll at the speed the kart is actually moving.
      animateKartWheels(racer.visual, kart.speed * dt, kart.steerVisual, kart.suspension);

      racer.flinch = Math.max(0, racer.flinch - dt * 3.2);
      if (racer.driverVisual) {
        /**
         * The driver is driven by the same numbers the physics produced: the head turns into the
         * corner, the torso leans with the slide, the arms follow the wheel and the eyes blink.
         * These are the five cheap animations the art bible calls out, and V4 had none of them.
         */
        animateCharacter(racer.driverVisual, {
          steer: kart.steerVisual,
          lean: kart.lean,
          time: seconds,
          flinch: racer.flinch,
        });
      }
    }

    const kart = this.player.kart;
    const position = this.vectorOf(kart);
    const speedRatio = Math.min(1, travelSpeed(kart) / VehicleConfig.maxSpeed);

    this.shieldMesh.isVisible = this.elapsedMs < this.shieldUntil;
    if (this.shieldMesh.isVisible) this.shieldMesh.rotation.y += dt * 1.8;

    // ---------------------------------------------------------------- VFX driven by state
    this.vfx.update(dt, {
      position,
      heading: kart.rotation,
      speedRatio,
      drifting: kart.driftActive,
      driftLevel: kart.driftLevel,
      boosting: kart.boostRemaining > 0,
      grounded: kart.grounded,
      slip: Math.abs(kart.lateralSpeed),
      surface: this.player.sample.surface,
    });

    // ---------------------------------------------------------------- lighting zones
    // Blending the whole lighting state along the lap is what makes the shop window, the stairwell
    // and the stockroom read as different places.
    this.track.lighting.update(this.player.sample.progress);
    this.track.lighting.setBoostEmphasis(kart.boostRemaining > 0 ? Math.min(1, kart.boostRemaining) : 0);

    // ---------------------------------------------------------------- animated dressing
    const time = now;
    for (const entry of this.track.animated) {
      if (entry.kind === "ITEM") {
        entry.mesh.rotation.y += dt * 1.7;
        entry.mesh.position.y += Math.sin(time * 0.002 + entry.phase) * 0.004;
      } else if (entry.kind === "HAZARD") {
        entry.mesh.position.y = Math.max(0, Math.sin(time * 0.0017 + entry.phase)) * 2.6;
      } else if (entry.kind === "BOOST") {
        entry.mesh.scaling.z = 1 + Math.sin(time * 0.006 + entry.phase) * 0.06;
      } else if (entry.kind === "SCREEN") {
        entry.mesh.rotation.y += Math.sin(time * 0.0008 + entry.phase) * 0.0008;
      } else if (entry.kind === "START_LAMP") {
        /**
         * The five gantry lamps light left to right as the countdown runs and all go out on GO,
         * which is what a start line does. The countdown existed only as a HUD number in V4.
         */
        const lit = this.countdown > 0
          ? entry.phase < (1 - this.countdown / 3.6) * 5
          : this.elapsedMs < 900;
        entry.mesh.scaling.setAll(lit ? 1.18 : 1);
        const lampMaterial = (entry.mesh as unknown as Mesh).material as StandardMaterial | null;
        if (lampMaterial) {
          const green = this.countdown === 0;
          lampMaterial.emissiveColor.set(
            lit && !green ? 1 : 0.16,
            lit && green ? 1 : 0.05,
            0.05,
          );
        }
      }
    }

    // ---------------------------------------------------------------- camera
    if (this.finished) {
      this.updateFinishCamera(dt);
    } else {
      const nodes = this.track.baked.definition.nodes;
      const profile = this.camera.getProfile();
      const aheadNodes = Math.round((8 + profile.lookAhead * speedRatio) / 2.5);
      const aim = nodes[(this.player.cursor + aheadNodes) % nodes.length]!;
      this.cameraContext.aimPoint.set(aim.x, aim.y + 1.7, aim.z);
      this.cameraContext.floorY = this.player.sample.groundY;
      this.camera.update(kart, this.cameraContext, dt);
    }
  }

  // ------------------------------------------------------------------ HUD and results

  private emitHud(): void {
    const now = performance.now();
    if (now - this.lastHudAt < 60) return;
    this.lastHudAt = now;

    const ranked = rankPlayers(this.racers.map((racer) => ({ id: racer.id, progress: racer.progress })));
    const position = ranked.findIndex((entry) => entry.id === "player") + 1;
    const kart = this.player.kart;
    const banner = this.banner && this.banner.until > this.elapsedMs ? this.banner.text : null;

    this.options.onHud({
      position: position || 1,
      lap: Math.min(this.options.laps, this.player.progress.lap),
      laps: this.options.laps,
      speedKph: Math.round(travelSpeed(kart) * 3.6),
      timeMs: this.elapsedMs,
      driftCharge: kart.driftCharge,
      driftLevel: kart.driftLevel,
      hasItem: this.heldItem !== null,
      itemName: this.heldItem?.name ?? null,
      itemId: this.heldItem?.id ?? null,
      countdown: this.countdown > 0 ? Math.ceil(this.countdown) : null,
      banner,
      playerProgress: this.totalProgress(this.player),
      botProgress: this.racers.filter((racer) => racer.driver).map((racer) => this.totalProgress(racer)),
      phase: this.finished ? "FINISH" : this.countdown > 0 ? "GRID" : "RACE",
      trackName: this.track.baked.blueprint.name,
      sector: this.player.sample.node.sector,
      rouletteName: this.roulette ? this.roulette.item.shortName : null,
      shield: this.elapsedMs < this.shieldUntil,
      inked: this.elapsedMs < this.inkedUntil,
      shuffled: this.elapsedMs < this.shuffledUntil,
      incoming: this.elapsedMs < this.incomingUntil,
      surface: this.player.sample.offRoad ? "OFFROAD" : this.player.sample.surface,
      lastLap: this.lastLapAnnounced,
      slipAngleDeg: Math.round((kart.slipAngle * 180) / Math.PI),
      drifting: kart.driftActive,
      boostTier: kart.boostTier,
      lapDistance: Math.round(this.player.sample.node.distance),
      lapLength: this.track.baked.definition.lengthMeters,
      fps: Math.round(1_000 / this.frameMs),
      boostReserve: Number(kart.boostReserve.toFixed(2)),
      driftChain: kart.driftChain,
      driftGrade: kart.lastDriftGrade,
      driftWindowOpen: kart.driftTapWindow > 0,
      driftCue: this.driftCue && this.driftCue.until > this.elapsedMs ? this.driftCue.text : null,
      perfectDrifts: this.perfectDrifts,
      maxSpeedKph: Math.round(this.maxSpeedReached * 3.6),
    });
  }

  /**
   * How far through the race a kart is. Delegates to `game-core` so ordering, the item balance and
   * the rubber band all read the same checkpoint-gated number — a kart that cuts the course does not
   * get credit for the lap here either.
   */
  private totalProgress(racer: Racer): number {
    return raceProgress(racer.progress);
  }

  private estimatePosition(): number {
    const mine = this.totalProgress(this.player);
    return 1 + this.racers.filter((racer) => racer !== this.player && this.totalProgress(racer) > mine).length;
  }

  private closestAhead(): Racer | null {
    const mine = this.totalProgress(this.player);
    return (
      this.racers
        .filter((racer) => racer !== this.player && this.totalProgress(racer) > mine)
        .sort((a, b) => this.totalProgress(a) - this.totalProgress(b))[0] ?? null
    );
  }

  private closestBehind(): Racer | null {
    const mine = this.totalProgress(this.player);
    return (
      this.racers
        .filter((racer) => racer !== this.player && this.totalProgress(racer) < mine)
        .sort((a, b) => this.totalProgress(b) - this.totalProgress(a))[0] ?? null
    );
  }

  private vectorOf(kart: KartState): Vector3 {
    return this.scratch.set(kart.position.x, kart.position.y, kart.position.z).clone();
  }

  private finishRace(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.finish();
    this.vfx.burst("CONFETTI", this.vectorOf(this.player.kart), 1);
    const mine = this.totalProgress(this.player);
    const position = 1 + this.racers.filter((racer) => racer !== this.player && this.totalProgress(racer) > mine).length;
    this.pendingResult = {
      position,
      totalTimeMs: Math.round(this.elapsedMs),
      bestLapMs: Math.round(this.player.progress.bestLapMs ?? this.elapsedMs),
      boostsUsed: this.boostsUsed,
      perfectDrifts: this.perfectDrifts,
      maxSpeedKph: Math.round(this.maxSpeedReached * 3.6),
    };
    this.banner = {
      text: position === 1 ? "PHOTO FINISH / P1" : `FINISH / P${position}`,
      until: Number.POSITIVE_INFINITY,
    };

    /**
     * The finish is a presentation, not a frozen HUD. The kart keeps rolling under autopilot, the
     * camera swings out to a wider, higher, slower orbit, and the music resolves to a win or a loss
     * sting. Nothing here touches the simulation, so it is safe under multiplayer: the race clock
     * has already stopped for this player and the others carry on unaffected.
     */
    this.audio.setMusicPhase(position === 1 ? "VICTORY" : "DEFEAT", this.track.baked.blueprint.theme);
    this.audio.resultSting(position === 1);
    this.camera.setProfile({
      ...this.camera.getProfile(),
      baseDistance: 14,
      speedDistance: 1.2,
      height: 6.4,
      baseFov: 0.96,
      speedFov: 0.08,
      boostFov: 0,
      lookAhead: 8,
      driftOffset: 0,
    });
    this.camera.impulse({ punch: 0.9 });
    this.vfx.burst("CONFETTI", this.vectorOf(this.player.kart), 1);
  }

  /** Slow orbit around the finishing kart. Driven from the render loop, so it is frame-rate free. */
  private updateFinishCamera(dt: number): void {
    this.finishOrbit += dt * 0.55;
    const radius = 15;
    const kart = this.player.kart;
    this.cameraContext.aimPoint.set(kart.position.x, kart.position.y + 1.6, kart.position.z);
    this.cameraContext.floorY = this.player.sample.groundY;
    // Nudging the camera's own boom target round the kart produces the orbit without a second
    // camera or a cut, which keeps the transition continuous.
    this.camera.orbit(
      kart,
      this.cameraContext,
      dt,
      Math.sin(this.finishOrbit) * radius,
      Math.cos(this.finishOrbit) * radius,
    );
  }

  private completeFinish(): void {
    if (this.finishReported || !this.pendingResult) return;
    this.finishReported = true;
    this.options.onFinish(this.pendingResult);
  }
}
