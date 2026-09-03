"use client";

import { useCallback, useRef, useState } from "react";

/**
 * THE THUMBSTICK.
 *
 * What replaced two arrow buttons. `TouchState` has carried an analogue `stickX` since V5 and
 * `InputControllerV5` reads it as a continuous −1…1 axis, but the only thing that ever wrote to it
 * was `setTouchControl("left" | "right", active)` — which sets it to exactly −1 or +1. So a phone
 * player had full lock or nothing: no way to hold a long corner at a third of the wheel, which is
 * most of driving. The analogue path existed and had no input device attached to it.
 *
 * Three decisions worth stating.
 *
 * **It follows the thumb rather than living in a fixed circle.** The stick's centre is set wherever
 * the finger lands inside the pad, so there is nothing to find and nothing to miss — a fixed stick
 * on a phone means looking down at the screen, which in a race means not looking at the race.
 *
 * **Horizontal only.** Steering is one axis, and a two-axis stick invites a player to hold a
 * diagonal that does nothing. The vertical component is ignored rather than mapped to the throttle,
 * because throttle and brake are their own buttons on the other side and doubling them up would make
 * every steering input a small accidental lift.
 *
 * **A dead zone at the centre, and a curve.** The dead zone stops a resting thumb from crawling; the
 * curve puts fine control near the middle where a player holds a line and leaves full lock reachable
 * at the edge. Both are the same shape `InputControllerV5` applies to a gamepad, so the two feel
 * alike.
 */

type Props = {
  /** −1…1. Called on every change, including the release back to zero. */
  onChange: (value: number) => void;
  /** How far the thumb travels for full lock, in CSS pixels. */
  travel?: number;
};

/** Fraction of `travel` ignored at the centre. */
const DEAD_ZONE = 0.12;

/**
 * Steering response curve.
 *
 * Squared with the sign kept, which halves the sensitivity around the centre and reaches full lock at
 * the edge unchanged. A linear axis on a 90 px travel is twitchy in exactly the region where a player
 * is trying to hold a constant angle.
 */
function curve(value: number): number {
  return Math.sign(value) * value * value;
}

export function TouchStick({ onChange, travel = 78 }: Props) {
  const origin = useRef<{ x: number; id: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

  const release = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (origin.current?.id !== event.pointerId) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      origin.current = null;
      setKnob(null);
      // Centred on release, always. A stick that keeps its last value when the thumb leaves is a
      // kart that keeps turning after the player has stopped asking it to.
      onChange(0);
    },
    [onChange],
  );

  const move = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = origin.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const raw = Math.max(-1, Math.min(1, dx / travel));
      const magnitude = Math.abs(raw);
      const live = magnitude < DEAD_ZONE ? 0 : Math.sign(raw) * ((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE));
      onChange(curve(live));
      // The knob is drawn at the raw offset, not the curved value: the thumb and the visual have to
      // agree, or the control feels like it is lagging.
      const rect = event.currentTarget.getBoundingClientRect();
      setKnob({ x: start.x - rect.left + raw * travel, y: event.clientY - rect.top });
    },
    [onChange, travel],
  );

  return (
    <div
      className="touch-stick"
      role="slider"
      aria-label="Dirección"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { x: event.clientX, id: event.pointerId };
        const rect = event.currentTarget.getBoundingClientRect();
        setKnob({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        // No steering on touchdown: the finger has not moved yet, and jumping to a value on contact
        // would twitch the kart every time a thumb is repositioned.
        onChange(0);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {knob === null ? (
        <span className="touch-stick__hint" aria-hidden="true">DESLIZA</span>
      ) : (
        <>
          {/* The track the thumb is moving along, anchored where the finger landed. */}
          <span className="touch-stick__rail" style={{ left: knob.x - travel, top: knob.y - 2, width: travel * 2 }} aria-hidden="true" />
          <span className="touch-stick__knob" style={{ left: knob.x, top: knob.y }} aria-hidden="true" />
        </>
      )}
    </div>
  );
}
