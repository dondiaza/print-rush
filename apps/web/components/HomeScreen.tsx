"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { RaceCharacter } from "@/characters/race";
import { resolveRaceCharacter } from "@/characters/race";
import { Button, ButtonLink, MenuTile } from "./ui/Button";

const HeroStage = dynamic(() => import("./HeroStage").then((module) => module.HeroStage), { ssr: false });

/**
 * THE HOME.
 *
 * A rewrite rather than a restyle, because the old one was the wrong *kind* of screen. It was a
 * marketing landing page: a left-aligned hero, a kicker line, a paragraph of body copy, four
 * equal-weight ghost links in a row, a stats strip, and the 3D pushed off to one side behind it all
 * as `aria-hidden` wallpaper. Every complaint in the brief about the home — nothing floating without
 * hierarchy, one clearly dominant action, the character and kart visible, "parece un dashboard" —
 * describes that layout precisely.
 *
 * What replaces it, in the order the eye should travel:
 *
 *  1. **The wordmark**, small and out of the way.
 *  2. **The loadout in 3D**, centred, the subject of the screen. It is the player's own character
 *     standing beside their own kart, from the same resolution the race uses — so what is on this
 *     screen is what races, which was not true before.
 *  3. **JUGAR**, alone and unmistakably the primary action.
 *  4. **Four tiles** — character, kart, circuits, profile — each showing what is currently
 *     selected. A tile that answers "which character am I using?" removes a whole screen from the
 *     flow, and a grid of tiles reads as a game menu where a row of text links read as navigation.
 *  5. **Ajustes**, last and quiet.
 *
 * There is no body copy at all. A game's main menu does not explain itself in a paragraph.
 */

type Props = {
  onPlay: () => void;
  onTracks: () => void;
  onSettings: () => void;
  trackName: string;
};

/** What the tiles show while the loadout is still resolving. */
const RESOLVING = "…";

export function HomeScreen({ onPlay, onTracks, onSettings, trackName }: Props) {
  const [loadout, setLoadout] = useState<RaceCharacter | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    /**
     * The same resolution the race performs, on the same precedence.
     *
     * This is the change that makes the menu honest. The old home read `loadActiveCharacter()` and
     * `loadActiveKart()` straight out of local storage while the race preferred the character saved
     * in the studio, so a player who built a character in the studio saw a *different* driver on the
     * menu than the one they drove. One function, one answer.
     *
     * `resolveRaceCharacter` never rejects — it degrades to the local character and then to the
     * fallback driver — so the catch here is for the genuinely unexpected, and it costs the stage
     * rather than the menu.
     */
    void resolveRaceCharacter()
      .then((resolved) => {
        if (active) setLoadout(resolved);
      })
      .catch((error: unknown) => {
        console.error("[home] the loadout could not be resolved", error);
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="home" id="top">
      {/* Three stacked layers behind the stage: a wash, a horizon glow and a grid. This is where the
          screen's depth comes from, and it is why the Babylon canvas clears to transparent. */}
      <div className="home__wash" aria-hidden="true" />
      <div className="home__glow" aria-hidden="true" />
      <div className="home__grid" aria-hidden="true" />

      <div className="home__inner">
        <h1 className="home__wordmark">
          <span>PRINT</span>
          <strong>RUSH</strong>
        </h1>

        <div className="home__stage">
          {loadout && (
            <HeroStage character={loadout.definition} kart={loadout.kart} faceTextureUrl={loadout.faceTextureUrl} />
          )}
          {!loadout && !failed && <div className="home__stage-loading" role="status">PREPARANDO GARAJE…</div>}
          {failed && <div className="home__stage-loading" role="status">GARAJE NO DISPONIBLE</div>}
        </div>

        <div className="home__identity">
          <strong>{loadout ? loadout.definition.name.toUpperCase() : RESOLVING}</strong>
          <span>
            {loadout ? loadout.kart.name.toUpperCase() : RESOLVING}
            {/* Where the character came from, shown only when it is *not* the saved one. A player
                whose studio character failed to load deserves to know why the wrong driver is on
                screen, and a player whose character loaded correctly does not need to be told. */}
            {loadout && loadout.source !== "STUDIO" && (
              <i className="home__source">{loadout.source === "LOCAL" ? "LOCAL" : "POR DEFECTO"}</i>
            )}
          </span>
        </div>

        <Button variant="primary" size="hero" onClick={onPlay} trailing="→">
          JUGAR
        </Button>

        <nav className="home__tiles" aria-label="Garaje">
          {/* The persistent studio, not the legacy local editor. The old home linked
              `/garage/character`, which writes to local storage — so the primary path led players to
              the editor whose work does not survive a change of device. */}
          <MenuTile href="/garage/characters" label="PERSONAJE" value={loadout?.definition.name ?? RESOLVING} glyph="◍" />
          <MenuTile href="/garage/kart" label="KART" value={loadout?.kart.name ?? RESOLVING} glyph="◈" />
          <MenuTile onClick={onTracks} label="CIRCUITOS" value={trackName} glyph="◎" />
          <MenuTile href="/garage/characters" label="PERFIL" value={loadout ? sourceLabel(loadout.source) : RESOLVING} glyph="◇" />
        </nav>

        <div className="home__footer">
          <Button variant="ghost" size="sm" onClick={onSettings}>AJUSTES</Button>
          <ButtonLink variant="ghost" size="sm" href="/factory">FACTORY</ButtonLink>
        </div>
      </div>
    </section>
  );
}

/** How the profile tile describes where the loadout came from. */
function sourceLabel(source: RaceCharacter["source"]): string {
  if (source === "STUDIO") return "Guardado";
  if (source === "LOCAL") return "Solo este equipo";
  return "Sin personaje";
}
