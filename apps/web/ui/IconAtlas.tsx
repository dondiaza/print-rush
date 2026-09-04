"use client";

import { useEffect, useState } from "react";

/**
 * UI ICONS, FROM THE ATLAS.
 *
 * What this replaces: the HUD's item slot rendered `itemName.slice(0, 1)` — the first letter of the
 * held item. The T-Shirt Cannon, the Tape Trap and Thread Boost were all "T", and the Sticker Mine
 * and Size Tag were both "S". A player could not tell what they were holding.
 *
 * One sheet, one request, addressed by `background-position`. The frames come from the asset
 * manifest rather than from a hard-coded table, so an icon cannot be named here that the bake did
 * not produce — and a test asserts every item in the game maps to a frame that exists.
 *
 * The fallback is deliberate and it is not a letter. If the manifest or the sheet cannot be loaded,
 * `Icon` renders its `label` as text and reports the failure once to the console. A silently missing
 * icon is a blank HUD slot, which is worse than a word.
 */

type Frame = { x: number; y: number; width: number; height: number };

type Atlas = {
  url: string;
  sheetWidth: number;
  sheetHeight: number;
  frames: Record<string, Frame>;
};

type ManifestAsset = {
  id: string;
  sourceFile: string;
  width: number;
  height: number;
  frames?: Record<string, Frame>;
};

let cached: Atlas | null = null;
let failed = false;
let inFlight: Promise<Atlas | null> | null = null;

/**
 * Loads the icon atlas once per session.
 *
 * Module-level memoisation rather than a React cache, because every HUD element wants the same
 * atlas and the manifest must be fetched exactly once no matter how many icons mount at the same
 * moment on the first frame.
 */
async function loadAtlas(): Promise<Atlas | null> {
  if (cached) return cached;
  if (failed) return null;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      /**
       * Revalidated, not pinned to the cache.
       *
       * The URL is written out rather than imported from `AssetCatalog` on purpose — that module
       * pulls Babylon in, and the HUD must not. The cache mode, though, has to agree with it: a
       * `force-cache` read of this same manifest is what left returning players asking for asset
       * names a deployment no longer shipped. See `AssetCatalog.load`.
       */
      const response = await fetch("/assets/assets.manifest.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`manifest ${response.status}`);
      const manifest = (await response.json()) as { assets: ManifestAsset[] };
      const asset = manifest.assets.find((entry) => entry.id === "ui_icon_atlas");
      if (!asset?.frames) throw new Error("ui_icon_atlas has no frames");
      cached = {
        url: `/${asset.sourceFile}`,
        sheetWidth: asset.width,
        sheetHeight: asset.height,
        frames: asset.frames,
      };
      return cached;
    } catch (error) {
      failed = true;
      // Once, not per icon: twenty-two identical warnings would bury the cause.
      console.warn("[ui] icon atlas unavailable, falling back to text labels", error);
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function useIconAtlas(): Atlas | null {
  const [atlas, setAtlas] = useState<Atlas | null>(cached);
  useEffect(() => {
    if (cached) return;
    let active = true;
    void loadAtlas().then((loaded) => {
      if (active) setAtlas(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return atlas;
}

/**
 * An item id to its icon id.
 *
 * The transform is the only piece of naming convention here: `tshirt-cannon` becomes
 * `item_tshirt_cannon`. It is a transform rather than a table so a new item cannot be added without
 * its icon — the test that checks every `ItemDefinition` resolves would fail immediately.
 */
export function iconForItem(itemId: string): string {
  return `item_${itemId.replace(/-/g, "_")}`;
}

type IconProps = {
  /** Frame id in the atlas, e.g. `ui_turbo` or `item_ink_blast`. */
  name: string;
  /** Rendered size in pixels. The art is 128 px, so anything up to that is crisp. */
  size?: number;
  /** Shown instead of the icon if the atlas is unavailable. Never a single letter. */
  label: string;
  className?: string;
};

export function Icon({ name, size = 34, label, className = "" }: IconProps) {
  const atlas = useIconAtlas();
  const frame = atlas?.frames[name];

  if (!atlas || !frame) {
    // Text, not a blank box. `aria-label` is not enough — a sighted player needs to know too.
    return (
      <span className={`ui-icon-fallback ${className}`} title={label}>
        {label}
      </span>
    );
  }

  // The sheet is scaled so the frame fills the requested box, then offset to that frame.
  const scale = size / frame.width;
  return (
    <span
      className={`ui-icon ${className}`}
      role="img"
      aria-label={label}
      title={label}
      style={{
        width: `${size}px`,
        height: `${Math.round(frame.height * scale)}px`,
        backgroundImage: `url(${atlas.url})`,
        backgroundSize: `${atlas.sheetWidth * scale}px ${atlas.sheetHeight * scale}px`,
        backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
        backgroundRepeat: "no-repeat",
        display: "inline-block",
      }}
    />
  );
}
