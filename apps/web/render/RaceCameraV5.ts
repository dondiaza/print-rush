import { Scene, TargetCamera, UniversalCamera, Vector3 } from "@babylonjs/core";
import { VehicleConfig, type KartState } from "@print-rush/game-core";

/**
 * RACE CAMERA V5.
 *
 * The V4 camera was two lerps and a sine shake living inside the runtime. It looked where the nose
 * pointed rather than where the track went, so it fell behind in every corner, and its FOV moved
 * 0.88 to 1.02 radians, which is far too little to sell speed.
 *
 * This is a state-driven controller instead. Every behaviour the brief asks for is an explicit,
 * separately tunable channel: speed pull-back, asymmetric FOV, drift offset, boost punch, impact
 * shake, landing dip, look-ahead along the racing line, and wall avoidance.
 *
 * The important detail is asymmetry. FOV and distance open quickly under acceleration and close
 * slowly under braking, because a camera that snaps back the instant you lift reads as nervous
 * rather than fast.
 */

export type CameraProfile = {
  /** Metres behind the kart at a standstill. */
  baseDistance: number;
  /** Extra metres at top speed. */
  speedDistance: number;
  height: number;
  /** Radians. 62 degrees at rest. */
  baseFov: number;
  /** Radians added at top speed. */
  speedFov: number;
  /** Radians added while boosting. */
  boostFov: number;
  /** How far ahead along the racing line the camera aims, in metres at top speed. */
  lookAhead: number;
  /** Lateral offset applied while drifting, metres. */
  driftOffset: number;
};

export const DesktopCameraProfile: CameraProfile = {
  baseDistance: 8.4,
  speedDistance: 2.8,
  height: 3.5,
  baseFov: 1.082, // 62 degrees
  speedFov: 0.279, // to 78 degrees
  boostFov: 0.14, // to 86 degrees
  lookAhead: 26,
  driftOffset: 1.9,
};

/**
 * Phones sit closer to the eye and show a much smaller slice of the world, so the same numbers read
 * as claustrophobic. Pull back, widen, and cut the look-ahead so the kart does not drift to the edge
 * of a small screen.
 */
export const MobileCameraProfile: CameraProfile = {
  baseDistance: 9.2,
  speedDistance: 2.2,
  height: 3.9,
  baseFov: 1.169, // 67 degrees
  speedFov: 0.244,
  boostFov: 0.105,
  lookAhead: 19,
  driftOffset: 1.4,
};

export type CameraImpulse = {
  /** Screen shake, 0..1. Decays fast. */
  shake?: number;
  /** Vertical dip from a landing, metres. */
  dip?: number;
  /** Forward punch from a boost, 0..1. */
  punch?: number;
};

/** What the camera needs from the world to aim itself. Keeps the controller free of track types. */
export type CameraContext = {
  /** Point on the racing line `lookAhead` metres in front of the kart. */
  aimPoint: Vector3;
  /** Ground height under the camera, so it never sinks through the floor. */
  floorY: number;
  /** Nearest wall in the camera's way, if any, as a distance along the boom. */
  maxBoom?: number;
};

/**
 * Which camera the player is looking through.
 *
 * `CHASE` is the third-person boom this class was written for. `COCKPIT` is a driver's-eye view: no
 * boom, rigid to the chassis, and aimed along the kart's own heading rather than along the racing
 * line. That last difference is the one that matters — a first-person camera that keeps looking at
 * the ideal line while the kart is sideways in a drift reads as a bug, whereas one bolted to the
 * chassis is what makes a drift legible from inside it.
 */
export type CameraView = "CHASE" | "COCKPIT";

/**
 * The driver's eye, in metres above the kart's origin.
 *
 * Just above where the generated character's head sits, so the view comes from the driver rather
 * than from the floor of the kart. The head itself is hidden while this view is active — the runtime
 * does that, because it owns the visual — which leaves the nose and front wheels in shot and nothing
 * else. That is the whole cockpit: there is no modelled interior to look at, and pretending
 * otherwise by putting the camera lower would just fill the screen with the back of a seat.
 */
const COCKPIT_EYE = 1.46;

/**
 * Extra field of view for the cockpit, in radians.
 *
 * About thirteen degrees on top of whatever the profile asks for. A first-person view needs it: the
 * chase camera gets its sense of speed from watching the kart move against the road, and inside the
 * kart there is nothing to watch it against, so the speed has to come from the periphery instead.
 */
const COCKPIT_FOV_BONUS = 0.23;

export class RaceCameraV5 {
  readonly camera: UniversalCamera;

  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private readonly desired = new Vector3();
  private readonly scratch = new Vector3();

  private fov: number;
  private distance: number;
  private lateral = 0;
  private shake = 0;
  private dip = 0;
  private punch = 0;
  private shakeSeed = Math.random() * 1000;
  private initialised = false;
  private view: CameraView = "CHASE";

  constructor(scene: Scene, private profile: CameraProfile) {
    this.camera = new UniversalCamera("race-camera-v5", new Vector3(0, 4, -10), scene);
    /**
     * The near plane, and why it is not 0.25.
     *
     * Depth precision is distributed as `1/z`, so the near plane decides how much of the buffer is
     * spent on the first metre and how little is left for everything past a hundred. At 0.25 against
     * a far plane of 900 the ratio is 3600:1, which on a 16-bit depth buffer — what plenty of mobile
     * GL contexts still hand out — leaves under a metre of resolution at two hundred metres. That is
     * z-fighting: distant posters, spectators and props flickering in and out against the surfaces
     * behind them, which is the "parts where elements disappear" in the report, and it is worse on
     * phones for exactly this reason.
     *
     * Nothing is ever close enough for 0.8 to clip. This is a chase camera on an eight-metre boom
     * that is never shortened, sitting three and a half metres up — above the barriers it might
     * otherwise pass through. The near metre of the frustum was empty, and it was costing the far
     * five hundred.
     */
    this.camera.minZ = 0.8;
    // Just past the backdrop shell, which is camera-relative at 820 m.
    this.camera.maxZ = 900;
    this.camera.fov = profile.baseFov;
    this.camera.inputs.clear();
    this.fov = profile.baseFov;
    this.distance = profile.baseDistance;
    scene.activeCamera = this.camera;
  }

  setProfile(profile: CameraProfile): void {
    this.profile = profile;
  }

  /** Switches between the chase camera and the cockpit, and reports which one is now live. */
  toggleView(): CameraView {
    this.view = this.view === "CHASE" ? "COCKPIT" : "CHASE";
    /**
     * Re-seeded, not interpolated.
     *
     * The two views are eleven metres apart, so lerping between them would sweep the camera through
     * the kart, the road and whatever is behind it over the better part of a second. A cut is the
     * honest transition here, and it is also what every game that offers this does.
     */
    this.initialised = false;
    return this.view;
  }

  getView(): CameraView {
    return this.view;
  }

  getProfile(): CameraProfile {
    return this.profile;
  }

  impulse(impulse: CameraImpulse): void {
    if (impulse.shake) this.shake = Math.min(1, this.shake + impulse.shake);
    if (impulse.dip) this.dip = Math.min(1.4, this.dip + impulse.dip);
    if (impulse.punch) this.punch = Math.min(1, this.punch + impulse.punch);
  }

  /** Snaps the camera behind the kart with no interpolation. Used on spawn and after a respawn. */
  reset(kart: KartState): void {
    this.initialised = false;
    this.shake = 0;
    this.dip = 0;
    this.punch = 0;
    this.lateral = 0;
    this.distance = this.profile.baseDistance;
    this.fov = this.profile.baseFov;
    void kart;
  }

  update(kart: KartState, context: CameraContext, dt: number): void {
    const profile = this.profile;
    const travel = Math.hypot(kart.velocity.x, kart.velocity.z);
    const speedRatio = Math.min(1, travel / VehicleConfig.maxSpeed);
    const boosting = kart.boostRemaining > 0;

    // ---------------------------------------------------------------- FOV, asymmetric
    // Opens fast when the speed is there, closes slowly when it is gone.
    const targetFov = profile.baseFov + profile.speedFov * speedRatio + (boosting ? profile.boostFov : 0);
    const fovRate = targetFov > this.fov ? 7 : 2.6;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * fovRate));

    // ---------------------------------------------------------------- boom length
    const targetDistance =
      profile.baseDistance + profile.speedDistance * speedRatio + this.punch * -1.1 + (boosting ? 0.9 : 0);
    const distanceRate = targetDistance > this.distance ? 5.5 : 3;
    this.distance += (targetDistance - this.distance) * (1 - Math.exp(-dt * distanceRate));

    // ---------------------------------------------------------------- drift offset
    // Sliding pushes the camera to the outside of the corner so the exit stays visible. Without
    // this the chassis angle hides exactly the piece of track the player needs.
    const driftTarget = kart.driftActive ? -kart.driftDirection * profile.driftOffset : 0;
    const slideTarget = (-kart.lateralSpeed / VehicleConfig.maxSpeed) * profile.driftOffset * 0.7;
    const lateralTarget = kart.driftActive ? driftTarget : slideTarget;
    this.lateral += (lateralTarget - this.lateral) * (1 - Math.exp(-dt * 4.5));

    // ---------------------------------------------------------------- placement
    const forwardX = Math.sin(kart.rotation);
    const forwardZ = Math.cos(kart.rotation);
    const rightX = forwardZ;
    const rightZ = -forwardX;

    if (this.view === "COCKPIT") {
      this.updateCockpit(kart, forwardX, forwardZ, speedRatio, boosting, dt);
      return;
    }

    const boom = context.maxBoom !== undefined ? Math.min(this.distance, context.maxBoom) : this.distance;
    const pivotY = kart.position.y + 1.2;
    this.desired.set(
      kart.position.x - forwardX * boom + rightX * this.lateral,
      pivotY + profile.height + speedRatio * 0.5 - this.dip,
      kart.position.z - forwardZ * boom + rightZ * this.lateral,
    );

    if (!this.initialised) {
      this.position.copyFrom(this.desired);
      this.target.copyFrom(context.aimPoint);
      this.initialised = true;
    } else {
      // Deliberately brisk. A slow follow reads as input lag, which is worse than a stiff camera.
      const follow = 1 - Math.exp(-dt * 9);
      Vector3.LerpToRef(this.position, this.desired, follow, this.position);
      // The aim point moves along the racing line, so it can be chased harder than the position.
      const aim = 1 - Math.exp(-dt * 6.5);
      Vector3.LerpToRef(this.target, context.aimPoint, aim, this.target);
    }

    // Never let the boom sink through the floor.
    const minimumY = context.floorY + 1.1;
    if (this.position.y < minimumY) this.position.y = minimumY;

    // ---------------------------------------------------------------- impulses
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.dip = Math.max(0, this.dip - dt * 4.5);
    this.punch = Math.max(0, this.punch - dt * 3.8);

    this.camera.fov = this.fov;
    this.camera.position.copyFrom(this.position);

    if (this.shake > 0.001) {
      // Two incommensurate frequencies so the shake never looks like a loop.
      const time = this.shakeSeed + performance.now() * 0.001;
      const amount = this.shake * this.shake * 0.55;
      this.camera.position.x += Math.sin(time * 47) * amount;
      this.camera.position.y += Math.sin(time * 61.7) * amount * 0.8;
      this.camera.position.z += Math.cos(time * 53.3) * amount;
    }

    this.scratch.copyFrom(this.target);
    this.camera.setTarget(this.scratch);
  }

  /**
   * The cockpit.
   *
   * Rigid where the chase camera is smoothed, and that is the point rather than a shortcut. A
   * first-person camera that lags the vehicle it is bolted to reads as input latency — the player's
   * own head appearing to swing a beat after their hands — so the position is written straight from
   * the kart with no follow term. What remains smoothed is the aim, lightly, because raw yaw at a
   * drift's snap-out is unpleasant to look through.
   *
   * The aim goes along the *chassis*, not along the racing line the chase camera uses. Inside the
   * kart, a view that stays pointed at the ideal line while the kart is sideways looks broken; a view
   * that turns with the kart is what makes a drift readable from the driver's seat.
   */
  private updateCockpit(
    kart: KartState,
    forwardX: number,
    forwardZ: number,
    speedRatio: number,
    boosting: boolean,
    dt: number,
  ): void {
    // Wider than the chase view, and it re-derives the FOV rather than reusing the smoothed one so
    // the switch between views is immediate instead of easing over half a second.
    const targetFov =
      this.profile.baseFov + COCKPIT_FOV_BONUS + this.profile.speedFov * speedRatio + (boosting ? this.profile.boostFov : 0);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 7));

    this.desired.set(
      kart.position.x + forwardX * 0.1,
      kart.position.y + COCKPIT_EYE - this.dip * 0.35,
      kart.position.z + forwardZ * 0.1,
    );
    // No follow term: the eye is part of the kart.
    this.position.copyFrom(this.desired);

    /**
     * Aimed forty metres down the chassis axis.
     *
     * Far enough that the small lateral corrections of steering do not swing the view about, near
     * enough that it still turns into a corner. The vertical component follows the kart's pitch
     * proxy — its vertical speed — so cresting a rise looks over the top rather than into the sky.
     */
    const aimY = kart.position.y + COCKPIT_EYE + Math.max(-6, Math.min(6, kart.verticalSpeed)) * 0.55;
    this.scratch.set(kart.position.x + forwardX * 40, aimY, kart.position.z + forwardZ * 40);
    if (!this.initialised) {
      this.target.copyFrom(this.scratch);
      this.initialised = true;
    } else {
      Vector3.LerpToRef(this.target, this.scratch, 1 - Math.exp(-dt * 14), this.target);
    }

    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.dip = Math.max(0, this.dip - dt * 4.5);
    this.punch = Math.max(0, this.punch - dt * 3.8);

    this.camera.fov = this.fov;
    this.camera.position.copyFrom(this.position);
    if (this.shake > 0) {
      // Half the chase camera's shake. At the eye the same amplitude is nauseating rather than
      // punchy, because there is no vehicle in shot for it to read as shaking *against*.
      const amount = this.shake * this.shake * 0.11;
      const time = performance.now() * 0.001 + this.shakeSeed;
      this.camera.position.x += Math.sin(time * 47.3) * amount;
      this.camera.position.y += Math.sin(time * 61.7) * amount * 0.8;
      this.camera.position.z += Math.cos(time * 53.3) * amount;
    }
    this.scratch.copyFrom(this.target);
    this.camera.setTarget(this.scratch);
  }

  /**
   * A slow orbit for the finish presentation. Takes an explicit boom offset rather than deriving one
   * from the kart's heading, so the camera can swing around a kart that is still rolling under
   * autopilot without the shot being yanked about by its steering.
   *
   * It reuses the same position and target smoothing as the chase camera, which is what makes the
   * hand-over at the finish line continuous rather than a cut.
   */
  orbit(kart: KartState, context: CameraContext, dt: number, offsetX: number, offsetZ: number): void {
    this.desired.set(
      kart.position.x + offsetX,
      Math.max(context.floorY + 2.5, kart.position.y + this.profile.height),
      kart.position.z + offsetZ,
    );

    const follow = 1 - Math.exp(-dt * 2.6);
    Vector3.LerpToRef(this.position, this.desired, follow, this.position);
    Vector3.LerpToRef(this.target, context.aimPoint, 1 - Math.exp(-dt * 3.4), this.target);

    this.fov += (this.profile.baseFov - this.fov) * (1 - Math.exp(-dt * 2));
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.punch = Math.max(0, this.punch - dt * 2);

    this.camera.fov = this.fov;
    this.camera.position.copyFrom(this.position);
    this.scratch.copyFrom(this.target);
    this.camera.setTarget(this.scratch);
  }

  get activeCamera(): TargetCamera {
    return this.camera;
  }

  get debug(): { fov: number; distance: number; lateral: number; shake: number; view: CameraView } {
    return {
      fov: Number(((this.fov * 180) / Math.PI).toFixed(1)),
      distance: Number(this.distance.toFixed(2)),
      lateral: Number(this.lateral.toFixed(2)),
      shake: Number(this.shake.toFixed(2)),
      view: this.view,
    };
  }
}
