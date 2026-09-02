import { Color3, Mesh, Scene, Vector2, Vector3 } from "@babylonjs/core";
import { ItemDefinitions, type ItemDefinition, type KartState } from "@print-rush/game-core";
import { beveledBox, ellipsoid, revolve, mergeParts } from "@/render/Geometry";
import { MaterialLibrary } from "@/render/MaterialLibrary";
import type { VFXSystem } from "@/render/VFXSystem";

/**
 * ITEM MANAGER.
 *
 * One system owns pickups, projectiles, traps, area effects and status effects. The V2 brief is
 * explicit that each power must not be an improvised component of its own, and the previous
 * implementation had drifted past that in the worst way: `activateItem` applied damage to the
 * nearest opponent *instantly*, with no projectile in the world at all. That makes a power an icon
 * and a number — nothing to aim, nothing to dodge, nothing to block, which the brief lists under
 * things not to do.
 *
 * Everything fired here is a real object with a position and a velocity. That single change is what
 * creates the counterplay the brief asks for in 6.4: a projectile can be out-run or side-stepped
 * because it takes time to arrive, a shield can consume one because there is something to consume,
 * and a dropped trap can be seen and avoided because it sits on the track.
 *
 * Meshes are pooled. Nothing is created or destroyed during a race.
 */

export type ItemTarget = {
  id: string;
  kart: KartState;
  /** Race progress, used to pick who a homing shot chases. */
  progress: number;
  /** Set by the manager when this target is hit. */
  onHit: (item: ItemDefinition, severity: number) => void;
  /** True while a shield is up. The manager consumes it rather than dealing damage. */
  shielded: () => boolean;
  /** Called when a shield absorbed a hit, so the owner can clear it. */
  onShieldBreak: () => void;
};

type Projectile = {
  mesh: Mesh;
  active: boolean;
  item: ItemDefinition;
  ownerId: string;
  velocity: Vector3;
  age: number;
  /** Homing shots steer toward this target; straight shots leave it null. */
  targetId: string | null;
  /** A boomerang turns around and comes back to its owner. */
  returning: boolean;
};

type Trap = {
  mesh: Mesh;
  active: boolean;
  item: ItemDefinition;
  ownerId: string;
  age: number;
  /** Area traps have a larger trigger radius than solid ones. */
  radius: number;
};

const PROJECTILE_POOL = 12;
const TRAP_POOL = 10;

/** Grace period after spawning, so a shot cannot immediately hit its own thrower. */
const SELF_HIT_GRACE = 0.28;

export class ItemManager {
  private readonly projectiles: Projectile[] = [];
  private readonly traps: Trap[] = [];
  private readonly scratch = new Vector3();

  constructor(
    private readonly scene: Scene,
    materials: MaterialLibrary,
    private readonly vfx: VFXSystem,
    accentA: string,
    accentB: string,
  ) {
    // ---------------------------------------------------------------- projectile pool
    // One shared shape, tinted per shot. A folded-shirt bundle: on-theme, and readable in the air.
    const projectileSource = this.buildProjectile(materials, accentB);
    for (let index = 0; index < PROJECTILE_POOL; index += 1) {
      const mesh = index === 0 ? projectileSource : (projectileSource.clone(`projectile-${index}`) as Mesh);
      mesh.setEnabled(false);
      mesh.isPickable = false;
      this.projectiles.push({
        mesh,
        active: false,
        item: ItemDefinitions.expressPackage,
        ownerId: "",
        velocity: new Vector3(),
        age: 0,
        targetId: null,
        returning: false,
      });
    }

    // ---------------------------------------------------------------- trap pool
    const trapSource = this.buildTrap(materials, accentA);
    for (let index = 0; index < TRAP_POOL; index += 1) {
      const mesh = index === 0 ? trapSource : (trapSource.clone(`trap-${index}`) as Mesh);
      mesh.setEnabled(false);
      mesh.isPickable = false;
      this.traps.push({
        mesh,
        active: false,
        item: ItemDefinitions.stickerMine,
        ownerId: "",
        age: 0,
        radius: 2.2,
      });
    }
  }

  private buildProjectile(materials: MaterialLibrary, color: string): Mesh {
    const parts: Mesh[] = [];
    const bundle = beveledBox(this.scene, "projectile-bundle", {
      width: 0.8,
      height: 0.42,
      depth: 0.8,
      bevel: 0.07,
    });
    bundle.material = materials.get({ materialClass: "FABRIC", color, tile: 0.3 });
    parts.push(bundle);
    // A band around it so the spin is readable in flight; a plain box in the air reads as a glitch.
    const band = beveledBox(this.scene, "projectile-band", {
      width: 0.86,
      height: 0.1,
      depth: 0.16,
      bevel: 0.03,
    });
    band.material = materials.glow("projectile-band-glow", color, 1);
    parts.push(band);
    const merged = mergeParts("projectile", parts, true);
    merged.receiveShadows = false;
    return merged;
  }

  private buildTrap(materials: MaterialLibrary, color: string): Mesh {
    const parts: Mesh[] = [];
    // A sticker roll lying on the track: low, wide and visible from a distance.
    const roll = revolve(
      this.scene,
      "trap-roll",
      [
        new Vector2(0.001, 0),
        new Vector2(0.62, 0.04),
        new Vector2(0.66, 0.2),
        new Vector2(0.6, 0.26),
        new Vector2(0.001, 0.26),
      ],
      14,
    );
    roll.material = materials.get({ materialClass: "PAPER", color: "#f7f2e8" });
    parts.push(roll);
    const ring = ellipsoid(this.scene, "trap-ring", { x: 0.9, y: 0.05, z: 0.9 }, 14, 4);
    ring.position.y = 0.03;
    ring.material = materials.glow("trap-ring-glow", color, 0.9);
    parts.push(ring);
    return mergeParts("trap", parts, true);
  }

  /**
   * Fires or drops an item. Returns false when nothing happened, so the caller can keep the item in
   * the player's inventory rather than silently consuming it.
   */
  use(
    item: ItemDefinition,
    owner: ItemTarget,
    backwards: boolean,
    targets: readonly ItemTarget[],
  ): boolean {
    const origin = new Vector3(owner.kart.position.x, owner.kart.position.y + 0.5, owner.kart.position.z);

    if (item.category === "TRAP" || item.category === "AREA") {
      return this.dropTrap(item, owner, origin);
    }
    if (item.category === "PROJECTILE" || item.id === "design-shuffle") {
      return this.fireProjectile(item, owner, backwards, targets, origin);
    }
    // BOOST, DEFENSE and the remaining UTILITY items act on the owner and are handled by the caller,
    // which owns the boost and status state.
    return false;
  }

  private fireProjectile(
    item: ItemDefinition,
    owner: ItemTarget,
    backwards: boolean,
    targets: readonly ItemTarget[],
    origin: Vector3,
  ): boolean {
    const slot = this.projectiles.find((entry) => !entry.active);
    if (!slot) return false;

    const heading = owner.kart.rotation;
    const direction = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(backwards ? -1 : 1);

    /**
     * Only some shots home, and only forwards. A backward throw is always a straight shot, so
     * defending your position is a matter of placement rather than of a guaranteed hit — and a
     * homing shot still has to travel, so it can be out-run.
     */
    const homing = !backwards && (item.id === "express-package" || item.id === "hanger-boomerang");
    let targetId: string | null = null;
    if (homing) {
      const ahead = targets
        .filter((candidate) => candidate.id !== owner.id && candidate.progress > owner.progress)
        .sort((a, b) => a.progress - b.progress);
      targetId = ahead[0]?.id ?? null;
    }

    slot.active = true;
    slot.item = item;
    slot.ownerId = owner.id;
    slot.age = 0;
    slot.targetId = targetId;
    slot.returning = false;
    slot.velocity.copyFrom(direction.scale(item.speed || 30));
    // Launched ahead of the nose so it never clips the kart that fired it.
    slot.mesh.position.copyFrom(origin.add(direction.scale(2.2)));
    slot.mesh.setEnabled(true);
    return true;
  }

  private dropTrap(item: ItemDefinition, owner: ItemTarget, origin: Vector3): boolean {
    const slot = this.traps.find((entry) => !entry.active);
    if (!slot) return false;

    const heading = owner.kart.rotation;
    const behind = new Vector3(Math.sin(heading), 0, Math.cos(heading)).scale(-2.6);

    slot.active = true;
    slot.item = item;
    slot.ownerId = owner.id;
    slot.age = 0;
    // An area effect covers more ground but does less; a solid trap is small and hurts.
    slot.radius = item.category === "AREA" ? 4.4 : 2.2;
    slot.mesh.position.copyFrom(origin.add(behind));
    slot.mesh.position.y = owner.kart.position.y + 0.05;
    slot.mesh.scaling.setAll(item.category === "AREA" ? 2 : 1);
    slot.mesh.setEnabled(true);
    return true;
  }

  /** Steps every live projectile and trap, resolving hits. Called from the fixed update. */
  update(dt: number, targets: readonly ItemTarget[]): void {
    for (const projectile of this.projectiles) {
      if (!projectile.active) continue;
      projectile.age += dt;

      const owner = targets.find((candidate) => candidate.id === projectile.ownerId);

      // ------------------------------------------------------------ steering
      if (projectile.item.id === "hanger-boomerang" && projectile.age > projectile.item.duration * 0.45) {
        // The boomerang turns around and comes home, so a miss is not simply wasted.
        projectile.returning = true;
      }

      const chaseId = projectile.returning ? projectile.ownerId : projectile.targetId;
      const chase = chaseId ? targets.find((candidate) => candidate.id === chaseId) : null;
      if (chase) {
        this.scratch.set(
          chase.kart.position.x - projectile.mesh.position.x,
          0,
          chase.kart.position.z - projectile.mesh.position.z,
        );
        const distance = this.scratch.length();
        if (distance > 0.001) {
          this.scratch.scaleInPlace(projectile.item.speed / distance);
          // Deliberately a soft turn rate. A shot that snaps onto its target cannot be dodged, and
          // an undodgeable shot is what the brief means by an inevitable death.
          const turn = projectile.returning ? 3.2 : 1.9;
          Vector3.LerpToRef(projectile.velocity, this.scratch, Math.min(1, dt * turn), projectile.velocity);
        }
      }

      projectile.mesh.position.addInPlace(this.scratch.copyFrom(projectile.velocity).scaleInPlace(dt));
      projectile.mesh.rotation.x += dt * 8;
      projectile.mesh.rotation.y += dt * 5;

      // ------------------------------------------------------------ hits
      let consumed = false;
      for (const target of targets) {
        const isOwner = target.id === projectile.ownerId;
        // A boomerang on the way home is caught by its owner and does nothing; on the way out it
        // cannot hit them either, which is what the grace period is for.
        if (isOwner && (projectile.returning || projectile.age < SELF_HIT_GRACE)) {
          if (projectile.returning) {
            const distance = Vector3.Distance(
              projectile.mesh.position,
              this.scratch.set(target.kart.position.x, projectile.mesh.position.y, target.kart.position.z),
            );
            if (distance < 2.4) consumed = true;
          }
          continue;
        }
        if (isOwner) continue;

        const distance = Vector3.Distance(
          projectile.mesh.position,
          this.scratch.set(target.kart.position.x, projectile.mesh.position.y, target.kart.position.z),
        );
        if (distance > 2.3) continue;

        if (target.shielded()) {
          // The shield is spent absorbing the hit. That is the counterplay: a defensive item is
          // worth holding precisely because it can eat the one shot that matters.
          target.onShieldBreak();
          this.vfx.burst("SHIELD", projectile.mesh.position.clone(), 1);
        } else {
          target.onHit(projectile.item, 1);
          this.vfx.burst("IMPACT", projectile.mesh.position.clone(), 1);
        }
        consumed = true;
        break;
      }

      if (consumed || projectile.age >= projectile.item.duration) {
        projectile.active = false;
        projectile.mesh.setEnabled(false);
      }
      void owner;
    }

    // ---------------------------------------------------------------- traps
    for (const trap of this.traps) {
      if (!trap.active) continue;
      trap.age += dt;
      trap.mesh.rotation.y += dt * 0.8;

      for (const target of targets) {
        // The owner is immune only briefly, so dropping a trap under yourself is still a mistake.
        if (target.id === trap.ownerId && trap.age < 1.2) continue;
        const distance = Math.hypot(
          target.kart.position.x - trap.mesh.position.x,
          target.kart.position.z - trap.mesh.position.z,
        );
        if (distance > trap.radius) continue;

        if (target.shielded()) {
          target.onShieldBreak();
        } else {
          target.onHit(trap.item, trap.item.category === "AREA" ? 0.6 : 1);
        }
        this.vfx.burst(trap.item.id === "dye-cloud" ? "INK_SPLASH" : "IMPACT", trap.mesh.position.clone(), 1);
        // An area cloud lingers and can catch several karts; a solid trap is spent on the first.
        if (trap.item.category !== "AREA") {
          trap.age = trap.item.duration;
        }
        break;
      }

      if (trap.age >= trap.item.duration) {
        trap.active = false;
        trap.mesh.setEnabled(false);
      }
    }
  }

  /** Closest live threat to a position, so the HUD can warn about an incoming shot. */
  incomingThreat(position: { x: number; z: number }, ownId: string): number | null {
    let nearest: number | null = null;
    for (const projectile of this.projectiles) {
      if (!projectile.active || projectile.ownerId === ownId) continue;
      const distance = Math.hypot(
        projectile.mesh.position.x - position.x,
        projectile.mesh.position.z - position.z,
      );
      if (nearest === null || distance < nearest) nearest = distance;
    }
    return nearest;
  }

  get liveCount(): number {
    return (
      this.projectiles.filter((entry) => entry.active).length + this.traps.filter((entry) => entry.active).length
    );
  }

  dispose(): void {
    for (const projectile of this.projectiles) projectile.mesh.dispose();
    for (const trap of this.traps) trap.mesh.dispose();
    this.projectiles.length = 0;
    this.traps.length = 0;
  }
}

/** Convenience for the runtime: the accent colours a theme uses for its projectiles. */
export function projectileColors(accentA: string, accentB: string): { a: Color3; b: Color3 } {
  return { a: Color3.FromHexString(accentA), b: Color3.FromHexString(accentB) };
}
