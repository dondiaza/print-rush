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

  constructor(scene: Scene, private profile: CameraProfile) {
    this.camera = new UniversalCamera("race-camera-v5", new Vector3(0, 4, -10), scene);
    this.camera.minZ = 0.25;
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

  get debug(): { fov: number; distance: number; lateral: number; shake: number } {
    return {
      fov: Number(((this.fov * 180) / Math.PI).toFixed(1)),
      distance: Number(this.distance.toFixed(2)),
      lateral: Number(this.lateral.toFixed(2)),
      shake: Number(this.shake.toFixed(2)),
    };
  }
}
