"use client";

import { TrackPresets, type StoredTrack } from "@/factory/TrackFactory";
import { Button } from "./ui/Button";
import { TrackMap } from "./TrackMap";

/**
 * CIRCUIT SELECTION.
 *
 * Replaces a `<fieldset>` full of numbered buttons inside the old setup form. The brief's objection
 * to that screen — "UI estilo administración", "no un dashboard" — was fair: choosing a circuit is
 * one of maybe three decisions a player makes, and it was presented as a radio group.
 *
 * Each circuit is a card that shows *its own shape*, drawn from the baked centreline by `TrackMap`.
 * That is the point rather than decoration: a name and a length tell a player nothing about whether
 * they want to drive somewhere, and the silhouette of the lap tells them almost everything. It is
 * also the same geometry the in-race minimap now uses, so a circuit looks like itself in both places.
 */

type Props = {
  active: StoredTrack;
  onSelect: (track: StoredTrack) => void;
  onBack: () => void;
  onConfirm: () => void;
};

export function TrackSelect({ active, onSelect, onBack, onConfirm }: Props) {
  return (
    <section className="sheet sheet--wide" aria-labelledby="tracks-title">
      <header className="sheet__head">
        <Button variant="ghost" size="sm" onClick={onBack} leading="←">VOLVER</Button>
        <h2 id="tracks-title">CIRCUITOS</h2>
      </header>

      <div className="track-grid">
        {TrackPresets.map((track) => {
          const selected = track.config.id === active.config.id;
          const analysis = track.baked.analysis;
          return (
            <button
              key={track.config.id}
              type="button"
              className={`track-card ${selected ? "is-on" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(track)}
            >
              <span className="track-card__map">
                <TrackMap nodes={track.baked.definition.nodes} />
              </span>
              <span className="track-card__name">{track.config.name}</span>
              <span className="track-card__theme">{track.config.theme.replace(/_/g, " ")}</span>
              <span className="track-card__stats">
                <i><b>{(analysis.lengthMeters / 1000).toFixed(2)}</b>KM</i>
                <i><b>{Math.round(analysis.estimatedLapSeconds)}</b>S/VUELTA</i>
                <i><b>{analysis.corners}</b>CURVAS</i>
              </span>
            </button>
          );
        })}
      </div>

      <footer className="sheet__foot">
        <Button variant="primary" size="lg" onClick={onConfirm} trailing="→">CORRER AQUÍ</Button>
      </footer>
    </section>
  );
}
