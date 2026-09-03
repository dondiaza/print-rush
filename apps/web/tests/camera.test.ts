import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { createKartState, VehicleConfig, type KartState } from "@print-rush/game-core";
import { describe, expect, it } from "vitest";
import { DesktopCameraProfile, RaceCameraV5, type CameraContext } from "@/render/RaceCameraV5";

/**
 * THE TWO VIEWS.
 *
 * A chase camera on a boom and a driver's eye are not the same camera with a different offset, and
 * the assertions here are about the differences that actually matter to a player rather than about
 * where the numbers land.
 *
 * The one worth stating up front: the cockpit aims along the **chassis**, while the chase camera aims
 * along the **racing line**. Looking down the ideal line is right from behind — it keeps the corner
 * exit in shot while the kart is sideways — and wrong from inside, where a view that ignores which
 * way the kart is pointing reads as a bug rather than as a drift. That is the assertion at the bottom
 * of this file, and it is the one that would break if someone "simplified" the two paths into one.
 */

const scene = new Scene(new NullEngine());

function rig() {
  return new RaceCameraV5(scene, DesktopCameraProfile);
}

function kartAt(x: number, z: number, rotation: number, speed = 22): KartState {
  const kart = createKartState(x, z, rotation, 0.42);
  kart.speed = speed;
  kart.velocity.x = Math.sin(rotation) * speed;
  kart.velocity.z = Math.cos(rotation) * speed;
  return kart;
}

/** An aim point deliberately off to one side, so "aims at the racing line" is distinguishable. */
function context(kart: KartState, aim = new Vector3(60, 2, 0)): CameraContext {
  return { aimPoint: aim, floorY: kart.position.y - 0.42 };
}

/**
 * Where the camera is actually looking.
 *
 * `setTarget` does not store the point — it converts it to an euler rotation and throws it away. The
 * reconstructed target only appears in `_currentTarget` when the view matrix is built, which in a
 * headless test never happens on its own because nothing renders. So the matrix is forced first.
 * Reading `getTarget()` without that returns the origin, which is indistinguishable from a camera
 * genuinely aimed at nothing — a false failure that looks like a real one.
 */
function aimOf(camera: RaceCameraV5): Vector3 {
  camera.camera.getViewMatrix();
  return camera.camera.getTarget();
}

/** Runs enough steps for the smoothing to settle. */
function settle(camera: RaceCameraV5, kart: KartState, ctx: CameraContext, steps = 90) {
  for (let step = 0; step < steps; step += 1) camera.update(kart, ctx, 1 / 60);
}

describe("switching", () => {
  it("alternates and reports which view is live", () => {
    const camera = rig();
    expect(camera.getView()).toBe("CHASE");
    expect(camera.toggleView()).toBe("COCKPIT");
    expect(camera.getView()).toBe("COCKPIT");
    expect(camera.toggleView()).toBe("CHASE");
  });

  it("cuts rather than sweeping between them", () => {
    /**
     * The two positions are eleven metres apart, so an interpolated transition would fly the camera
     * through the kart, the road and whatever is behind it over most of a second. `toggleView` clears
     * the initialised flag, which makes the next frame a cut. Asserted by checking that a *single*
     * frame after the switch already puts the camera at the driver's eye rather than partway there.
     */
    const camera = rig();
    const kart = kartAt(0, 0, 0);
    const ctx = context(kart);
    settle(camera, kart, ctx);

    camera.toggleView();
    camera.update(kart, ctx, 1 / 60);
    const distance = Math.hypot(
      camera.camera.position.x - kart.position.x,
      camera.camera.position.z - kart.position.z,
    );
    expect(distance).toBeLessThan(0.5);
  });
});

describe("where each view puts the eye", () => {
  it("keeps the chase camera on its boom, behind and above", () => {
    const camera = rig();
    const kart = kartAt(0, 0, 0);
    const ctx = context(kart);
    settle(camera, kart, ctx);

    // Behind: the kart faces +Z at rotation 0, so the camera must be at negative Z.
    expect(camera.camera.position.z).toBeLessThan(-5);
    expect(camera.camera.position.y).toBeGreaterThan(kart.position.y + 3);
  });

  it("puts the cockpit at the driver's eye, not on a boom", () => {
    const camera = rig();
    const kart = kartAt(0, 0, 0);
    const ctx = context(kart);
    camera.toggleView();
    settle(camera, kart, ctx);

    const distance = Math.hypot(
      camera.camera.position.x - kart.position.x,
      camera.camera.position.z - kart.position.z,
    );
    expect(distance).toBeLessThan(0.5);
    // Head height: above the seat, below the roll bar.
    const eye = camera.camera.position.y - kart.position.y;
    expect(eye).toBeGreaterThan(1.1);
    expect(eye).toBeLessThan(1.9);
  });

  it("is rigid to the chassis rather than following it", () => {
    // A first-person camera that lags the vehicle it is bolted to reads as input latency — the
    // player's own head arriving a beat after their hands. So one frame of movement must move the
    // eye the whole way, not part of the way.
    const camera = rig();
    const kart = kartAt(0, 0, 0);
    const ctx = context(kart);
    camera.toggleView();
    settle(camera, kart, ctx);

    const moved = kartAt(0, 40, 0);
    camera.update(moved, context(moved), 1 / 60);
    expect(camera.camera.position.z).toBeGreaterThan(39);
  });

  it("never drops the eye below the floor", () => {
    const camera = rig();
    const kart = kartAt(0, 0, 0);
    camera.toggleView();
    settle(camera, kart, context(kart));
    expect(camera.camera.position.y).toBeGreaterThan(context(kart).floorY);
  });
});

describe("field of view", () => {
  it("opens up inside the kart", () => {
    /**
     * The chase camera gets its sense of speed from watching the kart move against the road. Inside
     * the kart there is nothing to watch it against, so the speed has to come from the periphery
     * instead — which means a wider lens, not the same one moved forward.
     */
    const chase = rig();
    const kart = kartAt(0, 0, 0);
    settle(chase, kart, context(kart));

    const cockpit = rig();
    cockpit.toggleView();
    settle(cockpit, kart, context(kart));

    expect(cockpit.debug.fov).toBeGreaterThan(chase.debug.fov + 8);
  });

  it("still opens further with speed in both views", () => {
    for (const view of ["CHASE", "COCKPIT"] as const) {
      const camera = rig();
      if (view === "COCKPIT") camera.toggleView();
      const crawling = kartAt(0, 0, 0, 2);
      settle(camera, crawling, context(crawling));
      const slow = camera.debug.fov;

      const flying = kartAt(0, 0, 0, VehicleConfig.maxSpeed);
      settle(camera, flying, context(flying));
      expect(camera.debug.fov, view).toBeGreaterThan(slow);
    }
  });
});

describe("what each view looks at", () => {
  it("aims the cockpit along the chassis and the chase along the racing line", () => {
    /**
     * The assertion this file exists for.
     *
     * The kart faces +Z; the racing line is off at +X. From behind, the camera should be looking
     * toward the line — that is what keeps a corner exit visible through a drift. From the driver's
     * seat it must look where the kart is pointing, because a first-person view that ignores the
     * chassis makes a drift unreadable.
     */
    const kart = kartAt(0, 0, 0);
    const aim = new Vector3(120, 2, 0);

    const chase = rig();
    settle(chase, kart, context(kart, aim));
    const chaseTarget = aimOf(chase);

    const cockpit = rig();
    cockpit.toggleView();
    settle(cockpit, kart, context(kart, aim));
    const cockpitTarget = aimOf(cockpit);

    // The chase camera has been pulled well off the chassis axis, toward the line.
    expect(chaseTarget.x).toBeGreaterThan(60);
    // The cockpit has not moved off it at all.
    expect(Math.abs(cockpitTarget.x)).toBeLessThan(1);
    expect(cockpitTarget.z).toBeGreaterThan(20);
  });

  it("turns the cockpit's view with the kart", () => {
    const camera = rig();
    camera.toggleView();
    const straight = kartAt(0, 0, 0);
    settle(camera, straight, context(straight));
    expect(aimOf(camera).z).toBeGreaterThan(20);

    // A quarter turn to the right: the view has to come with it.
    const turned = kartAt(0, 0, Math.PI / 2);
    settle(camera, turned, context(turned));
    const turnedAim = aimOf(camera);
    expect(turnedAim.x).toBeGreaterThan(20);
    expect(Math.abs(turnedAim.z)).toBeLessThan(2);
  });
});
