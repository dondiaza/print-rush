"use client";

import { useEffect, useRef } from "react";
import { Button } from "./ui/Button";

/**
 * THE CONTROLS SHEET.
 *
 * Shown once, before a player's first race, and after that only when they ask for it from settings.
 * The brief specifies exactly that, including the persisted flag, and none of it existed: the keys
 * were listed in a paragraph on a setup screen a player scrolled past, and again inside the pause
 * menu behind a toggle — which is to say, available everywhere except the one moment it is useful.
 *
 * Two columns rather than one list, because there are two kinds of player here and they need
 * different halves. The keyboard column is dead weight on a phone and the touch column is dead
 * weight on a desktop, but which one is which is not reliably knowable — a laptop with a
 * touchscreen, a tablet with a keyboard — so both are shown and neither is guessed at.
 *
 * `ESPACIO` gets a line of its own because it is the one control that does three things, and a player
 * who does not know that never discovers the hop or the trick.
 */

const STORAGE_KEY = "print-rush.controls-seen.v1";

/** Whether the sheet has already been dismissed once on this device. */
export function hasSeenControls(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Storage blocked: show it every time rather than never. An extra sheet is a small annoyance; a
    // player who never learns the controls is a lost player.
    return false;
  }
}

export function markControlsSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // See above.
  }
}

const KEYBOARD: ReadonlyArray<[string, string]> = [
  ["W A S D / FLECHAS", "Acelerar, frenar y girar"],
  ["ESPACIO", "Toca para saltar · mantén en curva para derrapar"],
  ["ESPACIO EN RAMPA", "Cronométralo en el borde para volar más lejos"],
  ["ESPACIO EN EL AIRE", "Arma un truco y cobra al aterrizar"],
  ["E", "Lanzar objeto hacia delante"],
  ["S + E", "Lanzar objeto hacia atrás"],
  ["V", "Cambiar entre 3ª y 1ª persona"],
  ["R", "Reaparecer si te quedas atascado"],
  ["ESC", "Pausa"],
];

const TOUCH: ReadonlyArray<[string, string]> = [
  ["JOYSTICK IZQUIERDO", "Girar"],
  ["GAS / FRENO", "Acelerar y frenar"],
  ["DRIFT", "Mantén pulsado en curva"],
  ["SALTO", "Toca, y cronométralo en las rampas"],
  ["ITEM", "Lanzar objeto · con FRENO, hacia atrás"],
  ["1ª / 3ª PERSONA", "Botón de vista, arriba a la derecha"],
];

export function ControlsSheet({ onDismiss }: { onDismiss: () => void }) {
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus lands on the only action, so a keyboard player can dismiss it with the key they are
    // already holding rather than hunting for the button with Tab.
    dismissRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.code === "Space") {
        event.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="controls-title">
      <div className="modal__panel controls-sheet">
        <h2 id="controls-title">CONTROLES</h2>
        <div className="controls-sheet__columns">
          <section>
            <h3>TECLADO</h3>
            <dl>
              {KEYBOARD.map(([key, what]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>TÁCTIL</h3>
            <dl>
              {TOUCH.map(([key, what]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <p className="controls-sheet__tip">
          Mantén el gas durante el último destello de la cuenta atrás para salir con turbo.
        </p>
        <Button ref={dismissRef} variant="primary" size="lg" onClick={onDismiss} trailing="→">ENTENDIDO</Button>
      </div>
    </div>
  );
}
