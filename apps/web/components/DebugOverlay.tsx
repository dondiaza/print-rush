"use client";

import { useEffect, useRef, useState } from "react";
import type { HudState } from "@/game/GameRuntime";

/**
 * DEBUG OVERLAY.
 *
 * The V2 brief asks for a development mode that is never shown to a normal player. It is gated on
 * an explicit toggle stored per browser, not on `NODE_ENV`, because the thing you most want to
 * inspect is a production build on a real device.
 *
 * Toggle with F3, or by setting `print-rush.debug` in localStorage. Values are written straight into
 * DOM nodes at the HUD's own rate rather than through React state — a diagnostics panel is the
 * easiest place in a game to accidentally re-render a tree every frame.
 */

const STORAGE_KEY = "print-rush.debug";

/** Reads the stored flag once. Safe during SSR, where there is no storage to read. */
function readStoredFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode or blocked storage: debug simply stays off.
    return false;
  }
}

export function useDebugEnabled(): boolean {
  // Read in the initialiser rather than in an effect: setting state synchronously inside an effect
  // triggers a second render pass for no reason, and this value never changes on its own.
  const [enabled, setEnabled] = useState(readStoredFlag);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== "F3") return;
      event.preventDefault();
      setEnabled((current) => {
        const next = !current;
        try {
          localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        } catch {
          // Not persisting is acceptable; the toggle still works for this session.
        }
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return enabled;
}

type Row = { key: keyof HudState; label: string; format?: (value: never) => string };

const GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: "Frame",
    rows: [
      { key: "fps", label: "fps" },
      { key: "phase", label: "phase" },
    ],
  },
  {
    title: "Vehicle",
    rows: [
      { key: "speedKph", label: "speed", format: ((value: number) => `${value} km/h`) as never },
      { key: "maxSpeedKph", label: "max", format: ((value: number) => `${value} km/h`) as never },
      { key: "slipAngleDeg", label: "slip", format: ((value: number) => `${value}°`) as never },
      { key: "surface", label: "surface" },
    ],
  },
  {
    title: "Drift",
    rows: [
      { key: "drifting", label: "active", format: ((value: boolean) => (value ? "yes" : "no")) as never },
      { key: "driftLevel", label: "tier" },
      { key: "driftCharge", label: "charge", format: ((value: number) => value.toFixed(2)) as never },
      { key: "driftWindowOpen", label: "window", format: ((value: boolean) => (value ? "OPEN" : "-")) as never },
      { key: "driftGrade", label: "last grade" },
      { key: "boostReserve", label: "reserve", format: ((value: number) => `${value.toFixed(2)} s`) as never },
      { key: "driftChain", label: "chain" },
      { key: "perfectDrifts", label: "perfects" },
    ],
  },
  {
    title: "Race",
    rows: [
      { key: "position", label: "position" },
      { key: "lap", label: "lap" },
      { key: "sector", label: "sector" },
      { key: "playerProgress", label: "raceProgress", format: ((value: number) => value.toFixed(3)) as never },
      { key: "lapDistance", label: "distance", format: ((value: number) => `${value} m`) as never },
      { key: "lapLength", label: "lap length", format: ((value: number) => `${value} m`) as never },
    ],
  },
];

export function DebugOverlay({ hudRef }: { hudRef: { current: HudState | null } }) {
  const nodes = useRef(new Map<string, HTMLSpanElement>());

  useEffect(() => {
    let frame = 0;
    // 10 Hz. Fast enough to read a transient like a drift window, slow enough to cost nothing.
    const tick = (): void => {
      const hud = hudRef.current;
      if (hud) {
        for (const group of GROUPS) {
          for (const row of group.rows) {
            const node = nodes.current.get(String(row.key));
            if (!node) continue;
            const value = hud[row.key];
            const text = row.format ? row.format(value as never) : String(value);
            if (node.textContent !== text) node.textContent = text;
          }
        }
      }
      frame = window.setTimeout(tick, 100);
    };
    tick();
    return () => window.clearTimeout(frame);
  }, [hudRef]);

  return (
    <aside className="debug-overlay" aria-hidden>
      <header>DEBUG · F3</header>
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h4>{group.title}</h4>
          {group.rows.map((row) => (
            <div key={String(row.key)}>
              <span>{row.label}</span>
              <span
                ref={(node) => {
                  if (node) nodes.current.set(String(row.key), node);
                }}
              >
                —
              </span>
            </div>
          ))}
        </section>
      ))}
      <style>{`
        .debug-overlay {
          position: absolute; top: 10px; left: 10px; z-index: 40;
          min-width: 208px; padding: 8px 10px 10px;
          background: rgba(8, 9, 12, 0.82); border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px; backdrop-filter: blur(4px);
          color: #dfe4ea; font: 500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
          pointer-events: none;
        }
        .debug-overlay header {
          font-weight: 700; letter-spacing: 0.09em; color: #ff3da6; margin-bottom: 6px;
        }
        .debug-overlay h4 {
          margin: 7px 0 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: #7f8794;
        }
        .debug-overlay section > div {
          display: flex; justify-content: space-between; gap: 12px;
        }
        .debug-overlay section > div > span:first-child { color: #8d95a3; }
        .debug-overlay section > div > span:last-child { font-variant-numeric: tabular-nums; }
      `}</style>
    </aside>
  );
}
