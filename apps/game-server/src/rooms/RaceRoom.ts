import { CloseCode, type Client, Room } from "@colyseus/core";
import {
  GameplayConfig,
  InputRateLimiter,
  NetworkConfig,
  RacePhase,
  advanceRaceProgress,
  createFlagshipStoreTrack,
  createKartState,
  createRaceProgress,
  isAllowedLaps,
  rankPlayers,
  sanitizeInput,
  simulateKart,
  type GameInput,
  type KartState,
  type RaceProgress,
} from "@print-rush/game-core";
import { PlayerStateSchema, RaceStateSchema } from "./RaceState.js";
import {
  createDefaultCharacter, createDefaultKart, hashDefinition, migrateCharacter, migrateKart,
  validateCharacter, validateKart,
} from "@print-rush/3d-factory";

type RoomOptions = { laps?: number; nickname?: string; maxPlayers?: number; character?: unknown; kart?: unknown };

type InternalPlayer = {
  input: GameInput;
  kart: KartState;
  progress: RaceProgress;
  limiter: InputRateLimiter;
};

const idleInput = (): GameInput => ({
  sequence: 0,
  steer: 0,
  throttle: 0,
  brake: 0,
  drift: false,
  useItem: false,
  respawn: false,
});

export class RaceRoom extends Room<{ state: RaceStateSchema }> {
  maxClients: number = GameplayConfig.maxPlayers;
  private readonly track = createFlagshipStoreTrack();
  private readonly internal = new Map<string, InternalPlayer>();
  private countdownTimer: number = GameplayConfig.countdownSeconds;

  onCreate(options: RoomOptions): void {
    const state = new RaceStateSchema();
    state.roomId = this.roomId;
    state.lapsRequired = isAllowedLaps(options.laps ?? 3) ? options.laps ?? 3 : 3;
    this.maxClients = Math.max(1, Math.min(GameplayConfig.maxPlayers, Math.floor(options.maxPlayers ?? 4)));
    this.setState(state);
    this.setPatchRate(1_000 / NetworkConfig.statePatchRateHz);
    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1_000), 1_000 / NetworkConfig.simulationRateHz);

    this.onMessage("input", (client, payload) => {
      const internal = this.internal.get(client.sessionId);
      if (!internal || !internal.limiter.accept(Date.now())) return;
      const input = sanitizeInput(payload);
      if (input.sequence <= internal.input.sequence) return;
      internal.input = input;
    });

    this.onMessage("ready", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== RacePhase.LOBBY) return;
      player.ready = true;
      this.tryStart();
    });
  }

  onJoin(client: Client, options: RoomOptions): void {
    const slot = this.state.players.size;
    const spawn = this.track.spawnPoints[slot] ?? this.track.spawnPoints[0]!;
    const player = new PlayerStateSchema();
    player.id = client.sessionId;
    player.nickname = this.cleanNickname(options.nickname);
    const customization = this.cleanCustomization(options.character, options.kart);
    player.characterDefinition = JSON.stringify(customization.character);
    player.kartDefinition = JSON.stringify(customization.kart);
    player.characterHash = hashDefinition(customization.character);
    player.kartHash = hashDefinition(customization.kart);
    player.kart.x = spawn.position.x;
    player.kart.y = spawn.position.y;
    player.kart.z = spawn.position.z;
    player.kart.rotation = spawn.rotation;
    player.racePosition = slot + 1;
    this.state.players.set(client.sessionId, player);
    this.internal.set(client.sessionId, {
      input: idleInput(),
      kart: createKartState(spawn.position.x, spawn.position.z, spawn.rotation),
      progress: createRaceProgress(Date.now()),
      limiter: new InputRateLimiter(NetworkConfig.maxInputsPerSecond),
    });
  }

  async onLeave(client: Client, code: number): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.connected = false;
    if (code !== CloseCode.CONSENTED) {
      try {
        await this.allowReconnection(client, NetworkConfig.reconnectSeconds);
        player.connected = true;
        return;
      } catch {
        // The reserved seat expired; authoritative cleanup continues below.
      }
    }
    this.state.players.delete(client.sessionId);
    this.internal.delete(client.sessionId);
  }

  onDispose(): void {
    this.internal.clear();
  }

  private tryStart(): void {
    if (this.state.players.size === 0) return;
    const allReady = [...this.state.players.values()].every((player) => player.ready);
    if (!allReady) return;
    this.state.phase = RacePhase.COUNTDOWN;
    this.countdownTimer = GameplayConfig.countdownSeconds;
  }

  private update(dt: number): void {
    this.state.serverTime = Date.now();
    if (this.state.phase === RacePhase.COUNTDOWN) {
      this.countdownTimer = Math.max(0, this.countdownTimer - dt);
      this.state.countdown = this.countdownTimer;
      if (this.countdownTimer === 0) {
        this.state.phase = RacePhase.RACING;
        const startedAt = Date.now();
        this.internal.forEach((player) => { player.progress.currentLapStartedAt = startedAt; });
      }
      return;
    }
    if (this.state.phase !== RacePhase.RACING) return;

    const now = Date.now();
    this.internal.forEach((internal, id) => {
      const schema = this.state.players.get(id);
      if (!schema) return;
      const input = schema.connected ? internal.input : { ...idleInput(), throttle: 0.55 };
      internal.kart = simulateKart(internal.kart, input, dt);
      internal.progress = advanceRaceProgress(internal.progress, internal.kart.position, this.track, this.state.lapsRequired, now);
      schema.kart.x = internal.kart.position.x;
      schema.kart.y = internal.kart.position.y;
      schema.kart.z = internal.kart.position.z;
      schema.kart.rotation = internal.kart.rotation;
      schema.kart.speed = internal.kart.speed;
      schema.kart.boostRemaining = internal.kart.boostRemaining;
      schema.lap = internal.progress.lap;
      schema.checkpoint = internal.progress.checkpoint;
      schema.lastProcessedInput = internal.input.sequence;
    });

    const ranked = rankPlayers([...this.internal.entries()].map(([id, value]) => ({ id, progress: value.progress })));
    ranked.forEach((entry, index) => {
      const schema = this.state.players.get(entry.id);
      if (schema) schema.racePosition = index + 1;
    });
    if (ranked.length > 0 && ranked.every((entry) => entry.progress.finishedAt !== null)) {
      this.state.phase = RacePhase.RESULTS;
    }
  }

  private cleanNickname(value: unknown): string {
    if (typeof value !== "string") return "Rider";
    const cleaned = value.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 18);
    return cleaned || "Rider";
  }

  private cleanCustomization(characterInput: unknown, kartInput: unknown) {
    try {
      if (JSON.stringify(characterInput ?? "").length > 12_000 || JSON.stringify(kartInput ?? "").length > 5_000) throw new Error("Customization payload too large");
      const character = migrateCharacter(characterInput);
      const kart = migrateKart(kartInput);
      if (validateCharacter(character).some((issue) => issue.severity === "ERROR")) throw new Error("Invalid character");
      if (validateKart(kart).some((issue) => issue.severity === "ERROR")) throw new Error("Invalid kart");
      return { character, kart };
    } catch {
      return { character: createDefaultCharacter(), kart: createDefaultKart() };
    }
  }
}
