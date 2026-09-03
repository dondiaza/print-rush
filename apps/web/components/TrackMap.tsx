"use client";

import { useMemo } from "react";
import type { TrackNode } from "@print-rush/game-core";

/**
 * THE TRACK MAP.
 *
 * What the minimap should always have been. The old one drew a **fixed ellipse** — the same shape on
 * every circuit — and placed the dots around it by lap progress:
 *
 * ```
 * const angle = -Math.PI / 2 + normalized * Math.PI * 2;
 * return { x: 70 + Math.cos(angle) * 48, y: 47 + Math.sin(angle) * 29 };
 * ```
 *
 * So a hairpin looked like a bend, a chicane looked like nothing, and a rival two corners ahead
 * appeared at an angle that had no relationship to where they were. It was a decoration shaped like
 * an instrument, which is exactly the kind of simulated functionality the brief rules out — and it
 * was the reason the minimap could not be used to make a decision.
 *
 * This projects the real baked centreline. The lap's own outline, oriented so its longest axis runs
 * horizontally, with every marker placed at the node its progress actually points to. Which means a
 * dot on the inside of a hairpin is genuinely on the inside of that hairpin.
 *
 * One component for two jobs — the in-race HUD and the circuit cards — because a circuit that looks
 * like itself in the menu and like an ellipse in the race is worse than either alone.
 */

const VIEW = 148;
const PADDING = 11;

export type TrackMarker = {
  /** Lap progress, 0..1. Wrapped, so a value past the line is fine. */
  progress: number;
  /** CSS colour. */
  color: string;
  /** Radius in view units. The player is drawn larger than the field. */
  radius: number;
  label?: string;
};

type Props = {
  nodes: readonly TrackNode[];
  markers?: readonly TrackMarker[];
  /** Where the start line sits, as lap progress. Defaults to the line itself. */
  startProgress?: number;
  className?: string;
};

export type Projection = {
  path: string;
  /** Point on the projected outline for a given lap progress. */
  at: (progress: number) => { x: number; y: number };
  width: number;
  height: number;
};

/**
 * Projects the centreline onto the view box.
 *
 * The rotation is the part worth explaining. A circuit's bounding box is whatever the layout happens
 * to be, and a tall circuit squeezed into a wide box wastes most of it — the map ends up a thin
 * vertical squiggle. So the outline is rotated by the angle of its own longest axis before it is
 * fitted, which makes every circuit fill the space it is given regardless of how it was authored.
 * The aspect ratio is preserved throughout: stretching to fill would change the shape, and the shape
 * is the entire information content of this drawing.
 */
export function projectTrack(nodes: readonly TrackNode[]): Projection {
  const count = nodes.length;
  if (count < 3) {
    return { path: "", at: () => ({ x: VIEW / 2, y: VIEW / 2 }), width: VIEW, height: VIEW };
  }

  // The longest axis, from the covariance of the point cloud. Cheaper and steadier than trying
  // every rotation, and for a closed loop it lands on the circuit's natural orientation.
  let meanX = 0;
  let meanZ = 0;
  for (const node of nodes) {
    meanX += node.x;
    meanZ += node.z;
  }
  meanX /= count;
  meanZ /= count;

  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const node of nodes) {
    const dx = node.x - meanX;
    const dz = node.z - meanZ;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);

  const rotated = nodes.map((node) => {
    const dx = node.x - meanX;
    const dz = node.z - meanZ;
    return { x: dx * cos - dz * sin, y: dx * sin + dz * cos };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of rotated) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((VIEW - PADDING * 2) / spanX, (VIEW - PADDING * 2) / spanY);
  const width = spanX * scale + PADDING * 2;
  const height = spanY * scale + PADDING * 2;

  const place = (point: { x: number; y: number }) => ({
    x: (point.x - minX) * scale + PADDING,
    // Flipped: world Z grows away from the camera, and a map reads with that running up the page.
    y: height - PADDING - (point.y - minY) * scale,
  });

  const screen = rotated.map(place);
  const path = `${screen.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")} Z`;

  const at = (progress: number) => {
    const wrapped = ((progress % 1) + 1) % 1;
    /**
     * Interpolated between nodes, not snapped to one.
     *
     * A circuit has around a thousand nodes over a 148-unit map, so snapping would be invisible on
     * the outline — but a marker that snaps visibly stutters as a kart drives, and the whole point of
     * this component is that the dots mean something.
     */
    const exact = wrapped * count;
    const index = Math.floor(exact) % count;
    const next = (index + 1) % count;
    const t = exact - Math.floor(exact);
    const a = screen[index]!;
    const b = screen[next]!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  return { path, at, width, height };
}

export function TrackMap({ nodes, markers = [], startProgress = 0, className }: Props) {
  // Memoised on the node array: the projection is a couple of thousand operations and the in-race
  // HUD re-renders on every frame of the race.
  const projection = useMemo(() => projectTrack(nodes), [nodes]);
  const start = projection.at(startProgress);

  return (
    <svg
      className={className ?? "track-map"}
      viewBox={`0 0 ${projection.width.toFixed(1)} ${projection.height.toFixed(1)}`}
      role="img"
      aria-label="Trazado del circuito"
    >
      {/* Drawn twice: a wide dark stroke for the tarmac, a thin bright one for the racing line. Two
          strokes on one path rather than two paths, so they cannot drift apart. */}
      <path d={projection.path} fill="none" stroke="rgba(11,11,15,0.72)" strokeWidth="9" strokeLinejoin="round" />
      <path d={projection.path} fill="none" stroke="rgba(247,242,232,0.82)" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={start.x} cy={start.y} r="4.2" fill="none" stroke="#b9ff45" strokeWidth="2.4" />
      {markers.map((marker, index) => {
        const point = projection.at(marker.progress);
        return (
          <circle
            key={marker.label ?? index}
            cx={point.x}
            cy={point.y}
            r={marker.radius}
            fill={marker.color}
            stroke="rgba(11,11,15,0.66)"
            strokeWidth="1.4"
          />
        );
      })}
    </svg>
  );
}
