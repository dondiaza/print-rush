import { sanitizeInput, type GameInput } from "@print-rush/game-core";

/**
 * INPUT V5.
 *
 * The V4 controller had no analogue steering at all: touch and keyboard both produced `steer = ±1`
 * smoothed at a fixed rate, and the gamepad stick was read with a hard 0.16 dead zone and no curve.
 * On a phone that meant every corner was taken at full lock.
 *
 * This version keeps one analogue steering value fed from whichever source is active, applies a
 * response curve, and lets the bindings be remapped. Keyboard steering is ramped — it has to be,
 * since a key is binary — but the ramp is short and speed-independent so it stays predictable.
 */

export type SteeringMode = "STICK" | "WHEEL" | "GYRO";

export type Bindings = {
  throttle: string[];
  brake: string[];
  left: string[];
  right: string[];
  drift: string[];
  item: string[];
  lookBack: string[];
  respawn: string[];
  pause: string[];
  /** Switches between the chase camera and the cockpit. */
  view: string[];
};

export const DefaultBindings: Bindings = {
  throttle: ["KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  /**
   * Space is the hop *and* the drift, on purpose.
   *
   * They were going to collide — space was already the drift button, and the hop was asked for on
   * space — and the resolution is the one this genre settled on long ago: it is one button whose
   * meaning comes from what the kart is doing. Tap it on the ground and the kart hops. Hold it while
   * steering hard enough and fast enough and the hop turns into a drift, which is *why* a drift
   * starts with a little jump. Tap it just after leaving a ramp and it arms a trick.
   *
   * That works here without any arbitration because the three readers want different things from
   * the key: `drift` is the held state, `hop` is the key-down edge, and `armTrick` only looks at the
   * held state while airborne. Drift entry already required steering past `driftEntrySteer` and a
   * minimum speed, so a standing tap was doing nothing before this.
   */
  drift: ["Space", "ShiftLeft"],
  item: ["KeyE"],
  lookBack: ["KeyQ"],
  respawn: ["KeyR"],
  pause: ["Escape"],
  view: ["KeyV", "KeyC"],
};

const PREVENT_DEFAULT = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
]);

/** Seconds for keyboard steering to travel from centre to full lock. */
const KEYBOARD_RAMP_SECONDS = 0.16;
/** Seconds to return to centre once the key is released. Faster than the ramp, so it feels crisp. */
const KEYBOARD_RETURN_SECONDS = 0.1;

export type TouchState = {
  /** Analogue stick vector, -1..1 on each axis. */
  stickX: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  /**
   * One-frame hop pulse from the touch layer.
   *
   * A pulse rather than a held flag, and unlike the others it is *cleared by the reader*: the HUD
   * button raises it on press and `snapshot` lowers it, because a finger held on a button would
   * otherwise hop on every touchdown. The keyboard gets the same behaviour from `event.repeat`.
   */
  hop?: boolean;
  autoAccelerate: boolean;
};

export class InputControllerV5 {
  paused = false;
  steeringMode: SteeringMode = "STICK";
  bindings: Bindings = { ...DefaultBindings };

  /** The single analogue steering value every source feeds into. Exposed for the visual model. */
  steer = 0;

  private sequence = 0;
  private readonly held = new Set<string>();
  private itemQueued = false;
  private respawnQueued = false;
  private lookBack = false;
  private gamepadItemHeld = false;
  private gamepadDriftHeld = false;
  private hopQueued = false;
  private viewQueued = false;
  private gyroTilt = 0;
  private gyroCentre: number | null = null;
  private readonly touch: TouchState = {
    stickX: 0,
    throttle: false,
    brake: false,
    drift: false,
    autoAccelerate: true,
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
    this.held.add(event.code);
    if (event.repeat) return;
    if (this.bindings.item.includes(event.code)) this.itemQueued = true;
    if (this.bindings.respawn.includes(event.code)) this.respawnQueued = true;
    /**
     * Hop and view are queued on the key-*down* edge, not read as held state, and the repeat guard
     * is what makes that true. Holding a key fires `keydown` over and over at the OS repeat rate, so
     * without this a held space would hop every few frames the moment the kart touched down, and a
     * held V would strobe between cameras.
     */
    if (!event.repeat && this.bindings.drift.includes(event.code)) this.hopQueued = true;
    if (!event.repeat && this.bindings.view.includes(event.code)) this.viewQueued = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.touch.stickX = 0;
    this.touch.throttle = false;
    this.touch.brake = false;
    this.touch.drift = false;
  };

  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.gamma === null) return;
    // In landscape, gamma is the roll axis. The first reading becomes the neutral position so the
    // player can hold the phone however is comfortable.
    this.gyroCentre ??= event.gamma;
    this.gyroTilt = Math.max(-1, Math.min(1, (event.gamma - this.gyroCentre) / 28));
  };

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("deviceorientation", this.onOrientation);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("deviceorientation", this.onOrientation);
  }

  setTouch(patch: Partial<TouchState>): void {
    Object.assign(this.touch, patch);
  }

  queueItem(): void {
    this.itemQueued = true;
  }

  /**
   * Hands over a pending camera-view toggle, if there is one, and clears it.
   *
   * Deliberately not part of `GameInput`. That type is the networked, sanitised, replayed simulation
   * input, and which camera a player is looking through changes nothing about the simulation — it
   * must not be in the packet, must not be recorded, and must not have to be agreed on between
   * clients. So it leaves the input layer by its own door.
   */
  consumeViewToggle(): boolean {
    const queued = this.viewQueued;
    this.viewQueued = false;
    return queued;
  }

  queueHop(): void {
    this.hopQueued = true;
  }

  queueViewToggle(): void {
    this.viewQueued = true;
  }

  queueRespawn(): void {
    this.respawnQueued = true;
  }

  isLookingBack(): boolean {
    return this.lookBack;
  }

  /** Recentres gyro steering. Called when the player asks, or when a race restarts. */
  recentreGyro(): void {
    this.gyroCentre = null;
    this.gyroTilt = 0;
  }

  private anyHeld(codes: readonly string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }

  snapshot(dt: number): GameInput {
    const pad = typeof navigator === "undefined" ? null : (navigator.getGamepads?.()[0] ?? null);

    // ---------------------------------------------------------------- steering
    const padAxis = applyDeadZone(pad?.axes[0] ?? 0, 0.12);
    const touchAxis = this.steeringMode === "GYRO" ? this.gyroTilt : this.touch.stickX;

    if (Math.abs(padAxis) > 0.001) {
      // A stick is already analogue; a mild curve gives fine control near centre without dulling lock.
      this.steer = shapeAxis(padAxis);
    } else if (Math.abs(touchAxis) > 0.001) {
      this.steer = shapeAxis(Math.max(-1, Math.min(1, touchAxis)));
    } else {
      const left = this.anyHeld(this.bindings.left);
      const right = this.anyHeld(this.bindings.right);
      const target = left === right ? 0 : left ? -1 : 1;
      const seconds = target === 0 ? KEYBOARD_RETURN_SECONDS : KEYBOARD_RAMP_SECONDS;
      const step = dt / seconds;
      if (target === 0) {
        this.steer -= Math.sign(this.steer) * Math.min(Math.abs(this.steer), step);
      } else {
        this.steer += (target - this.steer) * Math.min(1, step);
      }
      if (Math.abs(this.steer) < 0.008) this.steer = 0;
    }

    // ---------------------------------------------------------------- pedals
    const keyThrottle = this.anyHeld(this.bindings.throttle) ? 1 : 0;
    const keyBrake = this.anyHeld(this.bindings.brake) ? 1 : 0;
    const padThrottle = pad?.buttons[7]?.value ?? 0;
    const padBrake = pad?.buttons[6]?.value ?? 0;
    const touchThrottle = this.touch.throttle || (this.touch.autoAccelerate && !this.touch.brake) ? 1 : 0;

    // ---------------------------------------------------------------- buttons
    const padItem = pad?.buttons[2]?.pressed === true || pad?.buttons[3]?.pressed === true;
    if (padItem && !this.gamepadItemHeld) this.itemQueued = true;
    this.gamepadItemHeld = padItem;
    // The pad's drift button hops on its own rising edge, for the same reason the keyboard does.
    const padDrift = pad?.buttons[0]?.pressed === true || pad?.buttons[5]?.pressed === true;
    if (padDrift && !this.gamepadDriftHeld) this.hopQueued = true;
    this.gamepadDriftHeld = padDrift;
    this.lookBack = this.anyHeld(this.bindings.lookBack) || pad?.buttons[4]?.pressed === true;

    const input = sanitizeInput({
      sequence: ++this.sequence,
      steer: this.steer,
      throttle: Math.max(keyThrottle, padThrottle, touchThrottle),
      brake: Math.max(keyBrake, padBrake, this.touch.brake ? 1 : 0),
      drift: this.anyHeld(this.bindings.drift) || this.touch.drift || pad?.buttons[0]?.pressed === true || pad?.buttons[5]?.pressed === true,
      useItem: this.itemQueued,
      hop: this.hopQueued || this.touch.hop === true,
      respawn: this.respawnQueued,
    });

    this.itemQueued = false;
    this.hopQueued = false;
    this.touch.hop = false;
    this.respawnQueued = false;
    return input;
  }
}

function applyDeadZone(value: number, zone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < zone) return 0;
  // Rescale so the usable range still reaches full lock rather than stopping short.
  return Math.sign(value) * ((magnitude - zone) / (1 - zone));
}

/** Gentle expo curve: precision around centre, full authority at the edges. */
function shapeAxis(value: number): number {
  const magnitude = Math.abs(value);
  return Math.sign(value) * (0.62 * magnitude + 0.38 * magnitude * magnitude);
}
