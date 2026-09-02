"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APPEARANCE_LIMITS,
  BACK_ACCESSORIES,
  BODY_PRESETS,
  BOTTOMS,
  EYEBROW_STYLES,
  EYE_STYLES,
  FACE_ACCESSORIES,
  FACIAL_HAIR,
  GLOVES,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  JACKETS,
  KIT_COLORS,
  SHIRT_DESIGNS,
  SHOES,
  SKIN_TONES,
  TOPS,
  WRIST_ACCESSORIES,
  validateAppearance,
  type Character,
  type CharacterAppearance,
} from "@print-rush/character-core";
import { KartPresets } from "@print-rush/3d-factory";
import * as api from "@/characters/api";
import { rememberCharacter } from "@/characters/race";
import { CharacterPreview } from "./CharacterPreview";

/**
 * THE CHARACTER EDITOR.
 *
 * Categories on the left, the character in the middle, that category's options on the right — the
 * layout the brief specifies, collapsing to stacked panels on a narrow screen.
 *
 * Two things here are worth more than the controls themselves.
 *
 * **Autosave that cannot lose work, and cannot lie about it.** Changes are debounced and sent with
 * the version they were made against. The indicator says "Guardando…" only while a request is in
 * flight and "Guardado" only after the server has confirmed — never optimistically, because an
 * indicator that says saved when nothing was saved is worse than no indicator.
 *
 * **A conflict is surfaced, not swallowed.** If the same character is open in another tab, the
 * second write comes back 409 and the editor offers to reload rather than overwriting. That is the
 * whole reason the version travels with every request.
 */

type Category = "FACE" | "BODY" | "HAIR" | "CLOTHES" | "COLOURS" | "ACCESSORIES" | "KART";

const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
  { id: "FACE", label: "CARA" },
  { id: "BODY", label: "CUERPO" },
  { id: "HAIR", label: "PELO" },
  { id: "CLOTHES", label: "ROPA" },
  { id: "COLOURS", label: "COLORES" },
  { id: "ACCESSORIES", label: "ACCESORIOS" },
  { id: "KART", label: "KART" },
];

type SaveState = "IDLE" | "PENDING" | "SAVING" | "SAVED" | "CONFLICT" | "ERROR";

/** Debounce for autosave. Long enough that a slider drag is one request, short enough to feel live. */
const AUTOSAVE_DELAY = 1200;

export function CharacterEditor({ characterId }: { characterId: string }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [appearance, setAppearance] = useState<CharacterAppearance | null>(null);
  const [kartId, setKartId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("FACE");
  const [save, setSave] = useState<SaveState>("IDLE");
  const [error, setError] = useState<string | null>(null);
  /** Whether this character has been picked for the next race. Real feedback, not a no-op. */
  const [chosen, setChosen] = useState(false);

  /**
   * The version the editor last saw confirmed.
   *
   * A ref rather than state: the autosave timer closes over it, and a stale closure here would send
   * an outdated version and produce a spurious conflict on every second save.
   */
  const versionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // ------------------------------------------------------------------ load
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void api
        .getCharacter(characterId)
        .then((loaded) => {
          if (!active) return;
          setCharacter(loaded);
          setAppearance(loaded.appearance);
          setKartId(loaded.defaultKartId);
          setName(loaded.name);
          versionRef.current = loaded.version;
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : "No hemos podido abrir el personaje.");
        });
    });
    return () => {
      active = false;
    };
  }, [characterId]);

  const flush = useCallback(async () => {
    if (!dirtyRef.current || !appearance) return;
    dirtyRef.current = false;
    setSave("SAVING");
    try {
      const updated = await api.updateCharacter(characterId, {
        name,
        appearance,
        defaultKartId: kartId,
        expectedVersion: versionRef.current,
      });
      // The server's version is authoritative — it only moves when the change was significant, so
      // reading it back is what keeps the next save from conflicting with itself.
      versionRef.current = updated.version;
      setCharacter(updated);
      setSave("SAVED");
    } catch (cause) {
      if (cause instanceof api.ApiError && cause.isConflict) {
        setSave("CONFLICT");
        return;
      }
      setSave("ERROR");
      setError(cause instanceof Error ? cause.message : "No hemos podido guardar.");
    }
  }, [appearance, characterId, kartId, name]);

  // ------------------------------------------------------------------ autosave
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setSave("PENDING");
    timerRef.current = setTimeout(() => {
      void flush();
    }, AUTOSAVE_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [appearance, name, kartId, flush]);

  /**
   * Saves on the way out.
   *
   * Without this, a pending debounce is discarded when the page closes — which is exactly the
   * "I changed it and it did not save" report that autosave is supposed to prevent. `keepalive` on
   * the request is what lets it survive the unload.
   */
  useEffect(() => {
    const onHide = (): void => {
      if (dirtyRef.current) void flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [flush]);

  const change = useCallback((patch: Partial<CharacterAppearance>) => {
    dirtyRef.current = true;
    // A further edit invalidates the "ready to race" confirmation: what is on the grid is what was
    // saved, and saying otherwise would be the same lie the indicator avoids.
    setChosen(false);
    setAppearance((current) => {
      if (!current) return current;
      // Validated locally as well as on the server, so a conflicting pair — a helmet plus
      // sunglasses, half a racing suit — is resolved in the preview immediately rather than
      // appearing to work until the next save comes back and changes it.
      return validateAppearance({ ...current, ...patch }).value;
    });
  }, []);

  const indicator = useMemo(() => {
    switch (save) {
      case "PENDING":
        return "Cambios sin guardar…";
      case "SAVING":
        return "Guardando…";
      case "SAVED":
        return "Guardado";
      case "CONFLICT":
        return "Editado en otra pestaña";
      case "ERROR":
        return "No se ha podido guardar";
      default:
        return "";
    }
  }, [save]);

  if (error && !character) {
    return (
      <section className="studio-step">
        <h2>NO SE PUEDE ABRIR</h2>
        <p>{error}</p>
        <Link className="cta-primary" href="/garage/characters">
          VOLVER A PERSONAJES
        </Link>
      </section>
    );
  }

  if (!character || !appearance) {
    return <section className="studio-loading">CARGANDO PERSONAJE…</section>;
  }

  return (
    <section className="editor">
      <nav className="editor-categories" aria-label="Categorías">
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            className={category === entry.id ? "active" : ""}
            onClick={() => setCategory(entry.id)}
            aria-current={category === entry.id}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="editor-stage">
        <CharacterPreview
          appearance={appearance}
          name={name}
          faceTextureUrl={character.face?.state === "READY" ? character.face.gameTextureUrl : null}
        />
        <div className="editor-stage-foot">
          <span className={`save-state ${save.toLowerCase()}`}>{indicator}</span>
          {save === "CONFLICT" && (
            <button
              className="cta-secondary"
              onClick={() => {
                void api.getCharacter(characterId).then((fresh) => {
                  setCharacter(fresh);
                  setAppearance(fresh.appearance);
                  setName(fresh.name);
                  setKartId(fresh.defaultKartId);
                  versionRef.current = fresh.version;
                  dirtyRef.current = false;
                  setSave("IDLE");
                });
              }}
            >
              RECARGAR
            </button>
          )}
          <button
            className="cta-primary"
            onClick={() => {
              /**
               * Flush first, then select.
               *
               * Choosing a character to race with while an edit is still sitting in the autosave
               * debounce would put the pre-edit version on the grid — the change is in the browser,
               * not in the database the race reads from. Awaiting the flush is the difference
               * between "use this" meaning it and appearing to.
               */
              void flush().then(() => {
                rememberCharacter(characterId);
                setChosen(true);
              });
            }}
          >
            {chosen ? "LISTO PARA CORRER" : "USAR EN CARRERA"}
          </button>
        </div>
      </div>

      <div className="editor-options">
        {category === "FACE" && (
          <>
            <Field label="NOMBRE">
              <input
                value={name}
                maxLength={50}
                onChange={(event) => {
                  dirtyRef.current = true;
                  setName(event.target.value);
                }}
              />
            </Field>
            <Swatches
              label="TONO DE PIEL"
              values={SKIN_TONES}
              value={appearance.skinTone}
              onPick={(skinTone) => change({ skinTone })}
            />
            <Options label="OJOS" values={EYE_STYLES} value={appearance.eyeStyle} onPick={(eyeStyle) => change({ eyeStyle })} />
            <Options
              label="CEJAS"
              values={EYEBROW_STYLES}
              value={appearance.eyebrowStyle}
              onPick={(eyebrowStyle) => change({ eyebrowStyle })}
            />
            <Options label="BARBA" values={FACIAL_HAIR} value={appearance.facialHair} onPick={(facialHair) => change({ facialHair })} />
            {character.face?.state === "READY" ? (
              <p className="editor-hint">Este personaje tiene rostro fotográfico adaptado al juego.</p>
            ) : (
              <p className="editor-hint">
                Sin foto todavía. <Link href="/garage/characters">Añádela desde la biblioteca.</Link>
              </p>
            )}
          </>
        )}

        {category === "BODY" && (
          <>
            <Options label="COMPLEXIÓN" values={BODY_PRESETS} value={appearance.bodyPreset} onPick={(bodyPreset) => change({ bodyPreset })} />
            <Slider label="ALTURA" limit={APPEARANCE_LIMITS.heightScale} value={appearance.heightScale} onChange={(heightScale) => change({ heightScale })} />
            <Slider label="ANCHO" limit={APPEARANCE_LIMITS.bodyWidth} value={appearance.bodyWidth} onChange={(bodyWidth) => change({ bodyWidth })} />
            <Slider label="HOMBROS" limit={APPEARANCE_LIMITS.shoulderWidth} value={appearance.shoulderWidth} onChange={(shoulderWidth) => change({ shoulderWidth })} />
            <Slider label="CABEZA" limit={APPEARANCE_LIMITS.headScale} value={appearance.headScale} onChange={(headScale) => change({ headScale })} />
            <Slider label="PIERNAS" limit={APPEARANCE_LIMITS.legLength} value={appearance.legLength} onChange={(legLength) => change({ legLength })} />
            <p className="editor-hint">
              Los rangos están limitados para que el piloto siga cabiendo en el kart y alcanzando el
              volante. La apariencia no cambia el hitbox: todos los personajes son igual de fáciles de
              golpear.
            </p>
          </>
        )}

        {category === "HAIR" && (
          <>
            <Options label="CORTE" values={HAIR_STYLES} value={appearance.hairStyle} onPick={(hairStyle) => change({ hairStyle })} />
            <Swatches label="COLOR" values={HAIR_COLORS} value={appearance.hairColor} onPick={(hairColor) => change({ hairColor })} />
          </>
        )}

        {category === "CLOTHES" && (
          <>
            <Options label="PARTE DE ARRIBA" values={TOPS} value={appearance.top} onPick={(top) => change({ top })} />
            <Options label="ESTAMPADO" values={SHIRT_DESIGNS} value={appearance.shirtDesign} onPick={(shirtDesign) => change({ shirtDesign })} />
            <Options label="CHAQUETA" values={JACKETS} value={appearance.jacket} onPick={(jacket) => change({ jacket })} />
            <Options label="PANTALÓN" values={BOTTOMS} value={appearance.bottom} onPick={(bottom) => change({ bottom })} />
            <Options label="CALZADO" values={SHOES} value={appearance.shoes} onPick={(shoes) => change({ shoes })} />
            <Options label="GUANTES" values={GLOVES} value={appearance.gloves} onPick={(gloves) => change({ gloves })} />
          </>
        )}

        {category === "COLOURS" && (
          <>
            <Swatches label="PRINCIPAL" values={KIT_COLORS} value={appearance.primaryColor} onPick={(primaryColor) => change({ primaryColor })} />
            <Swatches label="SECUNDARIO" values={KIT_COLORS} value={appearance.secondaryColor} onPick={(secondaryColor) => change({ secondaryColor })} />
            <Swatches label="ACENTO" values={KIT_COLORS} value={appearance.accentColor} onPick={(accentColor) => change({ accentColor })} />
          </>
        )}

        {category === "ACCESSORIES" && (
          <>
            <Options label="CABEZA" values={HEADWEAR} value={appearance.accessoryHead} onPick={(accessoryHead) => change({ accessoryHead })} />
            <Options label="CARA" values={FACE_ACCESSORIES} value={appearance.accessoryFace} onPick={(accessoryFace) => change({ accessoryFace })} />
            <Options label="ESPALDA" values={BACK_ACCESSORIES} value={appearance.accessoryBack} onPick={(accessoryBack) => change({ accessoryBack })} />
            <Options label="MUÑECA" values={WRIST_ACCESSORIES} value={appearance.accessoryWrist} onPick={(accessoryWrist) => change({ accessoryWrist })} />
            <p className="editor-hint">
              Algunas combinaciones se resuelven solas: un casco quita las gafas, porque las dos
              piezas ocupan el mismo sitio.
            </p>
          </>
        )}

        {category === "KART" && (
          <>
            <Field label="KART POR DEFECTO">
              <select
                value={kartId ?? ""}
                onChange={(event) => {
                  dirtyRef.current = true;
                  setKartId(event.target.value || null);
                }}
              >
                <option value="">Sin preferencia</option>
                {KartPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="editor-hint">
              Es sólo el kart de partida: puedes cambiarlo antes de cada carrera. El personaje y el
              kart se guardan por separado a propósito.
            </p>
          </>
        )}

        {error && <p className="studio-notice error">{error}</p>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ small controls

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Options<T extends string>({
  label,
  values,
  value,
  onPick,
}: {
  label: string;
  values: readonly T[];
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <fieldset className="editor-field">
      <legend>{label}</legend>
      <div className="editor-chips">
        {values.map((entry) => (
          <button
            key={entry}
            type="button"
            className={entry === value ? "active" : ""}
            aria-pressed={entry === value}
            onClick={() => onPick(entry)}
          >
            {entry.replace(/_/g, " ")}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Swatches({
  label,
  values,
  value,
  onPick,
}: {
  label: string;
  values: readonly string[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <fieldset className="editor-field">
      <legend>{label}</legend>
      <div className="editor-swatches">
        {values.map((entry) => (
          <button
            key={entry}
            type="button"
            style={{ background: entry }}
            className={entry.toLowerCase() === value.toLowerCase() ? "active" : ""}
            aria-label={entry}
            aria-pressed={entry.toLowerCase() === value.toLowerCase()}
            onClick={() => onPick(entry)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Slider({
  label,
  limit,
  value,
  onChange,
}: {
  label: string;
  limit: { min: number; max: number };
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="editor-field">
      <span>
        {label} <b>{value.toFixed(2)}</b>
      </span>
      <input
        type="range"
        min={limit.min}
        max={limit.max}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
