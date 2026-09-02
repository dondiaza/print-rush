/**
 * AUDIO DIRECTOR V5.
 *
 * V4's audio was one sawtooth oscillator whose frequency tracked speed, plus fifteen square-wave
 * beeps. There was no engine load, no wind, no surface, no ambience and no music.
 *
 * There are still no audio files — the project ships as a static export and adding a sample set
 * would mean megabytes and a loading screen — but everything here is synthesised in layers rather
 * than as single tones. The engine has a body, a harmonic and a boost layer that cross-fade on load;
 * wind rises with speed; drift has its own scrub; and each theme gets an ambient bed. That is the
 * difference between "a beep happened" and "the kart is working".
 */

export type AudioTheme = string;

type EngineLayer = {
  oscillator: OscillatorNode;
  gain: GainNode;
  baseFrequency: number;
};

export type AudioDirectorOptions = {
  muted: boolean;
  theme: AudioTheme;
};

/** Ambient bed per theme: a filtered noise floor plus a slow drone. */
const THEME_AMBIENCE: Record<string, { droneHz: number; noiseHz: number; level: number }> = {
  FLAGSHIP: { droneHz: 82, noiseHz: 900, level: 0.016 },
  WAREHOUSE: { droneHz: 58, noiseHz: 1_400, level: 0.024 },
  PRINT_FACTORY: { droneHz: 47, noiseHz: 1_900, level: 0.03 },
  OFFICE: { droneHz: 104, noiseHz: 620, level: 0.012 },
  MANGA: { droneHz: 68, noiseHz: 1_100, level: 0.022 },
  GREYBOX: { droneHz: 90, noiseHz: 800, level: 0.008 },
};

/** Which music layer set is playing. */
export type MusicPhase = "NONE" | "RACE" | "FINAL_LAP" | "VICTORY" | "DEFEAT";

/**
 * Adaptive music.
 *
 * There are no audio files — the project ships as a static export and a soundtrack would mean
 * megabytes and a loading screen — so the music is synthesised as three layers over a shared
 * transport: a bass pulse, an arpeggio and a lead. The final lap does not cross-fade to a different
 * track; it raises the tempo of the same transport and unmutes the lead, so the change lands on the
 * beat rather than cutting across it.
 *
 * Each theme gets its own key and mode, which is what stops five circuits sounding like one.
 */
type MusicLayer = {
  oscillator: OscillatorNode;
  gain: GainNode;
};

/** Root note and scale per theme, in semitones from A. Minor keys for the darker spaces. */
const THEME_MUSIC: Record<string, { root: number; scale: readonly number[]; tempo: number }> = {
  // Bright and major: a shop should feel welcoming.
  FLAGSHIP: { root: 4, scale: [0, 2, 4, 7, 9], tempo: 124 },
  // Driving and modal: industrial but not grim.
  WAREHOUSE: { root: 0, scale: [0, 3, 5, 7, 10], tempo: 132 },
  // Minor and mechanical.
  PRINT_FACTORY: { root: -2, scale: [0, 3, 5, 6, 10], tempo: 128 },
  // Light and playful.
  OFFICE: { root: 7, scale: [0, 2, 4, 7, 9], tempo: 118 },
  // High energy, minor: the convention hall at night.
  MANGA: { root: 2, scale: [0, 3, 5, 7, 10], tempo: 140 },
  GREYBOX: { root: 0, scale: [0, 2, 4, 7, 9], tempo: 120 },
};

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private readonly musicLayers: Record<"bass" | "arp" | "lead", MusicLayer | null> = {
    bass: null,
    arp: null,
    lead: null,
  };
  private musicPhase: MusicPhase = "NONE";
  private musicTimer: number | null = null;
  private musicStep = 0;
  private readonly engine: EngineLayer[] = [];
  private windGain: GainNode | null = null;
  private driftGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted: boolean;
  private started = false;

  constructor(private readonly options: AudioDirectorOptions) {
    this.muted = options.muted;
  }

  start(): void {
    if (this.started || this.muted) return;
    this.started = true;
    try {
      this.context = new AudioContext();
    } catch {
      this.context = null;
      return;
    }
    const context = this.context;

    this.master = context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(context.destination);

    // ---------------------------------------------------------------- engine
    this.engineBus = context.createGain();
    this.engineBus.gain.value = 1;
    // A gentle low-pass keeps the sawtooth from being fatiguing over a two-minute lap.
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 2_200;
    engineFilter.Q.value = 0.6;
    this.engineBus.connect(engineFilter).connect(this.master);

    // Three layers: body, harmonic and a boost-only top. Cross-fading them with load is what makes
    // the engine sound like it is doing work rather than changing pitch.
    const layers: Array<{ type: OscillatorType; frequency: number; gain: number }> = [
      { type: "sawtooth", frequency: 46, gain: 0.05 },
      { type: "square", frequency: 92, gain: 0.014 },
      { type: "sawtooth", frequency: 138, gain: 0 },
    ];
    for (const layer of layers) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = layer.type;
      oscillator.frequency.value = layer.frequency;
      gain.gain.value = layer.gain;
      oscillator.connect(gain).connect(this.engineBus);
      oscillator.start();
      this.engine.push({ oscillator, gain, baseFrequency: layer.frequency });
    }

    this.noiseBuffer = this.createNoise(context);

    // ---------------------------------------------------------------- wind
    // Band-passed noise that opens above 60 % of top speed. The brief lists this explicitly as one
    // of the seven factors in speed perception.
    const wind = context.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.8;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;
    wind.connect(windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // ---------------------------------------------------------------- drift scrub
    const drift = context.createBufferSource();
    drift.buffer = this.noiseBuffer;
    drift.loop = true;
    const driftFilter = context.createBiquadFilter();
    driftFilter.type = "bandpass";
    driftFilter.frequency.value = 2_400;
    driftFilter.Q.value = 2.4;
    this.driftGain = context.createGain();
    this.driftGain.gain.value = 0;
    drift.connect(driftFilter).connect(this.driftGain).connect(this.master);
    drift.start();

    // ---------------------------------------------------------------- ambience
    const ambience = THEME_AMBIENCE[this.options.theme] ?? THEME_AMBIENCE.FLAGSHIP!;
    this.ambienceGain = context.createGain();
    this.ambienceGain.gain.value = ambience.level;
    this.ambienceGain.connect(this.master);

    const drone = context.createOscillator();
    drone.type = "triangle";
    drone.frequency.value = ambience.droneHz;
    const droneGain = context.createGain();
    droneGain.gain.value = 0.6;
    drone.connect(droneGain).connect(this.ambienceGain);
    drone.start();

    const room = context.createBufferSource();
    room.buffer = this.noiseBuffer;
    room.loop = true;
    const roomFilter = context.createBiquadFilter();
    roomFilter.type = "lowpass";
    roomFilter.frequency.value = ambience.noiseHz;
    const roomGain = context.createGain();
    roomGain.gain.value = 0.35;
    room.connect(roomFilter).connect(roomGain).connect(this.ambienceGain);
    room.start();

    // ---------------------------------------------------------------- music
    this.musicBus = context.createGain();
    this.musicBus.gain.value = 0.5;
    const musicFilter = context.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 4_200;
    this.musicBus.connect(musicFilter).connect(this.master);

    const layerSpec: Array<[keyof typeof this.musicLayers, OscillatorType, number]> = [
      ["bass", "triangle", 0],
      ["arp", "square", 0],
      ["lead", "sawtooth", 0],
    ];
    for (const [name, type, gainValue] of layerSpec) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = 110;
      gain.gain.value = gainValue;
      oscillator.connect(gain).connect(this.musicBus);
      oscillator.start();
      this.musicLayers[name] = { oscillator, gain };
    }
  }

  /** Semitone offset to frequency, A2 as the reference. */
  private note(semitones: number): number {
    return 110 * 2 ** (semitones / 12);
  }

  /**
   * Starts or changes the music phase. The transport keeps running across a phase change, so the
   * final lap arrives as a tempo and arrangement shift rather than as a new track starting.
   */
  setMusicPhase(phase: MusicPhase, theme: string): void {
    if (this.muted || !this.context || this.musicPhase === phase) return;
    this.musicPhase = phase;
    const music = THEME_MUSIC[theme] ?? THEME_MUSIC.FLAGSHIP!;
    const now = this.context.currentTime;

    const level: Record<MusicPhase, [number, number, number]> = {
      NONE: [0, 0, 0],
      RACE: [0.05, 0.028, 0],
      // The lead comes in for the final lap and everything lifts.
      FINAL_LAP: [0.062, 0.04, 0.035],
      VICTORY: [0.06, 0.045, 0.05],
      DEFEAT: [0.04, 0.016, 0.012],
    };
    const [bass, arp, lead] = level[phase];
    this.musicLayers.bass?.gain.gain.setTargetAtTime(bass, now, 0.35);
    this.musicLayers.arp?.gain.gain.setTargetAtTime(arp, now, 0.35);
    this.musicLayers.lead?.gain.gain.setTargetAtTime(lead, now, 0.5);

    if (phase === "NONE") {
      if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
      this.musicTimer = null;
      return;
    }

    // Final lap runs the same material 14 % faster. Victory and defeat slow to a resolve.
    const tempo = phase === "FINAL_LAP" ? music.tempo * 1.14 : phase === "RACE" ? music.tempo : music.tempo * 0.82;
    const stepMs = 60_000 / tempo / 4;
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = window.setInterval(() => this.musicStepTick(music, phase), stepMs);
  }

  /** One sixteenth of the transport. Advances the bass, arpeggio and lead independently. */
  private musicStepTick(
    music: { root: number; scale: readonly number[] },
    phase: MusicPhase,
  ): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    this.musicStep += 1;

    // Bass: root on the beat, fifth on the off-beat of every other bar.
    if (this.musicStep % 4 === 0) {
      const bar = Math.floor(this.musicStep / 16) % 4;
      const degree = [0, 0, 3, 4][bar]!;
      const semis = music.root + (music.scale[degree % music.scale.length] ?? 0) - 12;
      this.musicLayers.bass?.oscillator.frequency.setTargetAtTime(this.note(semis), now, 0.02);
    }

    // Arpeggio: walks the scale, direction reversing every two bars.
    const up = Math.floor(this.musicStep / 32) % 2 === 0;
    const index = up ? this.musicStep % music.scale.length : music.scale.length - 1 - (this.musicStep % music.scale.length);
    this.musicLayers.arp?.oscillator.frequency.setTargetAtTime(
      this.note(music.root + music.scale[index]! + 12),
      now,
      0.01,
    );

    // Lead: sparse, and only present when the arrangement calls for it.
    if (phase !== "RACE" && this.musicStep % 8 === 0) {
      const leadDegree = (Math.floor(this.musicStep / 8) * 2) % music.scale.length;
      this.musicLayers.lead?.oscillator.frequency.setTargetAtTime(
        this.note(music.root + music.scale[leadDegree]! + 24),
        now,
        0.03,
      );
    }
  }

  private createNoise(context: AudioContext): AudioBuffer {
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic noise, so the loop point never clicks differently between sessions.
    let seed = 0x2f6e2b1;
    for (let index = 0; index < length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[index] = ((seed >>> 0) / 4_294_967_295) * 2 - 1;
    }
    return buffer;
  }

  /**
   * Called every frame with normalised speed. `load` is the fraction of maximum speed, so the pitch
   * and the layer balance both follow the same value the player can see on the HUD.
   */
  update(load: number, boosting: boolean, drifting: boolean): void {
    const context = this.context;
    if (!context || this.muted) return;
    const now = context.currentTime;
    const clamped = Math.max(0, Math.min(1, load));

    this.engine.forEach((layer, index) => {
      // Slight per-layer detune spread keeps the stack from sounding like a single oscillator.
      const ratio = 1 + clamped * (2.1 + index * 0.12);
      layer.oscillator.frequency.setTargetAtTime(layer.baseFrequency * ratio, now, 0.04);
      const target =
        index === 0 ? 0.036 + clamped * 0.03
        : index === 1 ? 0.008 + clamped * 0.02
        : boosting ? 0.018 + clamped * 0.014 : 0;
      layer.gain.gain.setTargetAtTime(target, now, 0.08);
    });

    if (this.windGain) {
      // Nothing below 60 %; then it climbs fast, which is where the sense of speed comes from.
      const wind = clamped < 0.6 ? 0 : ((clamped - 0.6) / 0.4) ** 1.6 * 0.05;
      this.windGain.gain.setTargetAtTime(wind, now, 0.12);
    }
    if (this.driftGain) {
      this.driftGain.gain.setTargetAtTime(drifting ? 0.03 + clamped * 0.025 : 0, now, 0.05);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!muted) {
      this.start();
      void this.context?.resume();
    }
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.context.currentTime, 0.05);
    }
  }

  setPaused(paused: boolean): void {
    if (!this.context) return;
    void (paused ? this.context.suspend() : this.context.resume());
  }

  // ------------------------------------------------------------------ one-shots

  countdownTick(remaining: number): void {
    this.tone(remaining === 1 ? 660 : 440, remaining === 1 ? 760 : 440, 0.16, "square", 0.06);
  }

  go(): void {
    this.chord([523, 659, 784], 0.45);
  }

  /** Boost tier changes the interval, so the ear can tell a micro-boost from a super. */
  boost(tier: number): void {
    const top = [420, 620, 780, 980][Math.max(0, Math.min(3, tier))] ?? 620;
    this.tone(180, top, 0.24, "sawtooth", 0.07);
  }

  driftRelease(level: number): void {
    this.tone(320, 520 + level * 180, 0.2, "triangle", 0.06);
  }

  /** Impact timbre differs by what was hit, which the brief asks for explicitly. */
  impact(surface: string, severity: number): void {
    const amount = Math.max(0.15, Math.min(1, severity));
    switch (surface) {
      case "CARDBOARD":
        this.thud(150, 0.16, amount * 0.07);
        break;
      case "METAL":
      case "RAW_METAL":
        this.tone(720, 240, 0.16, "square", amount * 0.05);
        break;
      case "WOOD":
        this.thud(220, 0.13, amount * 0.06);
        break;
      case "KART":
        this.thud(180, 0.12, amount * 0.06);
        break;
      default:
        this.thud(120, 0.2, amount * 0.075);
    }
  }

  jump(): void {
    this.tone(280, 560, 0.15, "triangle", 0.05);
  }

  land(impact: number): void {
    this.thud(96, 0.16, Math.min(0.09, impact / 200));
  }

  pickup(): void {
    this.tone(520, 880, 0.13, "triangle", 0.05);
  }

  roulette(): void {
    this.tone(620, 700, 0.04, "square", 0.03);
  }

  launch(): void {
    this.tone(300, 820, 0.15, "sawtooth", 0.055);
  }

  drop(): void {
    this.tone(240, 110, 0.14, "square", 0.05);
  }

  shield(): void {
    this.chord([392, 523], 0.3);
  }

  shieldBreak(): void {
    this.tone(880, 180, 0.3, "square", 0.06);
  }

  finalLap(): void {
    this.chord([523, 698, 880], 0.6);
  }

  finish(): void {
    this.chord([523, 659, 784, 1_047], 0.9);
  }

  /** The result sting. Distinct enough that a player knows the outcome before reading the screen. */
  resultSting(won: boolean): void {
    if (won) this.chord([523, 659, 784, 1_047], 1.2);
    else this.chord([392, 466, 587], 1.1);
  }

  dispose(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    for (const layer of Object.values(this.musicLayers)) {
      try {
        layer?.oscillator.stop();
      } catch {
        // Already stopped.
      }
    }
    this.engine.forEach((layer) => {
      try {
        layer.oscillator.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    });
    this.engine.length = 0;
    if (this.context) void this.context.close();
    this.context = null;
  }

  private tone(from: number, to: number, duration: number, type: OscillatorType, level: number): void {
    const context = this.context;
    if (!context || this.muted || !this.master) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  /** A filtered noise burst with a pitched body: reads as a hit rather than as a beep. */
  private thud(frequency: number, duration: number, level: number): void {
    const context = this.context;
    if (!context || this.muted || !this.master || !this.noiseBuffer) return;
    const now = context.currentTime;

    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(frequency * 6, now);
    filter.frequency.exponentialRampToValueAtTime(frequency, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration);

    this.tone(frequency, frequency * 0.6, duration, "sine", level * 0.7);
  }

  private chord(frequencies: number[], duration: number): void {
    frequencies.forEach((frequency, index) => {
      this.tone(frequency, frequency, duration - index * 0.04, "triangle", 0.045);
    });
  }
}
