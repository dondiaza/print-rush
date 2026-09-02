"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, CharacterSummary, FaceCrop } from "@print-rush/character-core";
import * as api from "@/characters/api";
import { fromDefinition } from "@/characters/bridge";
import { loadCharacters } from "@/factory/storage";
import { FaceCropper } from "./FaceCropper";

/**
 * THE CHARACTER STUDIO.
 *
 * The library, and the creation flow the brief describes: name, photograph, crop, styled face,
 * review, save. Everything it shows comes from Postgres and object storage through the API — there
 * is no local copy that could disagree, which is the whole point of the feature.
 *
 * Two states are worth calling out because they are usually the ones that get skipped:
 *
 *  - **Empty.** A person with no characters gets an invitation, not a blank panel.
 *  - **Failed photo.** The character is listed with its failure reason and a retry, because the
 *    brief is explicit that a bad photograph must not take the character with it.
 */

type Stage =
  | { kind: "LIST" }
  | { kind: "NAMING" }
  | { kind: "PHOTO"; character: Character }
  | { kind: "CROPPING"; character: Character; file: File }
  | { kind: "REVIEW"; character: Character; preview: string; warnings: string[] };

type Notice = { tone: "OK" | "ERROR" | "INFO"; message: string } | null;

const LAST_SELECTED = "print-rush.last-character";
/** Set once the local characters have been offered and imported, so the banner does not nag. */
const IMPORTED_FLAG = "print-rush.characters-imported";

export function CharacterStudioLibrary() {
  const [authorised, setAuthorised] = useState<boolean | null>(null);
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "LIST" });
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * Characters found in this browser from before the studio existed.
   *
   * Offered as an import rather than migrated silently: these are somebody's work, and moving it
   * into a shared database under an owner id the code guessed at would be presumptuous. The local
   * copies are never deleted either — they stay as the race fallback.
   */
  const [importable, setImportable] = useState<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Reads the browser-only state after mount, in a microtask.
   *
   * Not in a lazy `useState` initialiser: this is a client component that also renders on the
   * server, where `window` does not exist, and seeding from storage during render is what produces a
   * hydration mismatch. The microtask is the pattern the rest of this codebase already uses for the
   * same reason — see `AssetBrowser` — and it keeps the state update out of the effect body, which
   * the React Compiler lint correctly objects to.
   */
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAuthorised(api.studioKey() !== null);
      try {
        setSelected(window.localStorage.getItem(LAST_SELECTED));
      } catch {
        // Storage blocked; the selection simply is not remembered.
      }
      try {
        const already = window.localStorage.getItem(IMPORTED_FLAG) === "1";
        setImportable(already ? 0 : loadCharacters().length);
      } catch {
        setImportable(0);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listCharacters({
        ...(search ? { search } : {}),
        ...(showDeleted ? { deleted: true } : {}),
      });
      setCharacters(list);
      setAuthorised(true);
    } catch (error) {
      if (error instanceof api.ApiError && error.needsKey) {
        setAuthorised(false);
        setCharacters(null);
        return;
      }
      setCharacters([]);
      setNotice({ tone: "ERROR", message: error instanceof Error ? error.message : "Error al cargar." });
    }
  }, [search, showDeleted]);

  useEffect(() => {
    if (!authorised) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, [authorised, refresh]);

  /** Wraps an action so every failure surfaces the server's own message rather than a console log. */
  const run = async (action: () => Promise<void>, success?: string): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ tone: "OK", message: success });
    } catch (error) {
      const message =
        error instanceof api.ApiError
          ? error.isConflict
            ? `${error.message} Recarga para ver la versión actual.`
            : error.message
          : "Algo ha fallado. Vuelve a intentarlo.";
      setNotice({ tone: "ERROR", message });
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ the key gate
  if (authorised === false) {
    return (
      <section className="studio-gate">
        <h2>CLAVE DEL ESTUDIO</h2>
        <p>
          El estudio de personajes guarda fotografías de personas, así que está detrás de una clave.
          Pídesela a quien administre el proyecto; se guarda sólo en este navegador.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            api.setStudioKey(
              String(form.get("key") ?? ""),
              String(form.get("owner") ?? "studio"),
              form.get("admin") === "on",
            );
            setAuthorised(api.studioKey() !== null);
          }}
        >
          <label>
            <span>TU NOMBRE O IDENTIFICADOR</span>
            <input name="owner" placeholder="carlos" autoComplete="off" required />
          </label>
          <label>
            <span>CLAVE</span>
            <input name="key" type="password" autoComplete="off" required />
          </label>
          <label className="studio-toggle">
            <input name="admin" type="checkbox" />
            <span>MODO ADMINISTRADOR</span>
          </label>
          {/* An attribution label, not a permission: the key is what gates every request, and the
              server records the claimed identity rather than trusting it. Saying so beside the
              checkbox is better than implying it grants something. */}
          <p className="editor-hint">
            El modo administrador muestra los personajes de todo el equipo y la papelera. No concede
            permisos por sí mismo: la clave es lo único que autoriza.
          </p>
          <button className="cta-primary" type="submit">ENTRAR</button>
        </form>
      </section>
    );
  }

  if (authorised === null || characters === null) {
    return <section className="studio-loading">CARGANDO PERSONAJES…</section>;
  }

  // ------------------------------------------------------------------ create: the name
  if (stage.kind === "NAMING") {
    return (
      <section className="studio-step">
        <h2>NUEVO PERSONAJE</h2>
        <p>Empieza por el nombre. No tiene que coincidir con el de nadie.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const character = await api.createCharacter({ name });
              // The character exists in the database from this moment. Everything after — photo,
              // crop, styling — happens against a row that is already saved, so abandoning the flow
              // half-way leaves a usable character rather than nothing.
              setStage({ kind: "PHOTO", character });
              setName("");
              await refresh();
            });
          }}
        >
          <label>
            <span>NOMBRE</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
              placeholder="Carlos"
              autoFocus
              required
            />
          </label>
          <div className="studio-actions">
            <button type="button" className="cta-secondary" onClick={() => setStage({ kind: "LIST" })}>
              VOLVER
            </button>
            <button type="submit" className="cta-primary" disabled={busy || name.trim().length === 0}>
              {busy ? "CREANDO…" : "CONTINUAR"}
            </button>
          </div>
        </form>
        {notice && <p className={`studio-notice ${notice.tone.toLowerCase()}`}>{notice.message}</p>}
      </section>
    );
  }

  // ------------------------------------------------------------------ create: the photo
  if (stage.kind === "PHOTO") {
    const character = stage.character;
    return (
      <section className="studio-step">
        <h2>FOTO DE {character.name.toUpperCase()}</h2>
        <p>
          Una foto frontal, con la cara visible y buena luz. No hace falta que sea perfecta. Se guarda
          en privado: sólo tú y quien administre el proyecto pueden verla, y nunca se envía a los
          rivales de una carrera.
        </p>
        <div
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) setStage({ kind: "CROPPING", character, file });
          }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
          }}
        >
          <strong>Sube una foto frontal</strong>
          <span>Arrastra el archivo o pulsa para elegirlo · JPEG, PNG o WebP · máximo 8 MB</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setStage({ kind: "CROPPING", character, file });
            }}
          />
        </div>
        <div className="studio-actions">
          <button type="button" className="cta-secondary" onClick={() => { setStage({ kind: "LIST" }); void refresh(); }}>
            LO HARÉ LUEGO
          </button>
        </div>
        {notice && <p className={`studio-notice ${notice.tone.toLowerCase()}`}>{notice.message}</p>}
      </section>
    );
  }

  // ------------------------------------------------------------------ create: the crop
  if (stage.kind === "CROPPING") {
    const { character, file } = stage;
    return (
      <section className="studio-step">
        <h2>ENCAJA LA CARA</h2>
        <FaceCropper
          file={file}
          busy={busy}
          onCancel={() => setStage({ kind: "PHOTO", character })}
          onConfirm={(crop: FaceCrop, png: Blob) => {
            void run(async () => {
              await api.uploadFace(character.id, file, png, crop);
              // Styling is a separate call so the upload is durable before any processing begins: a
              // failure here leaves a stored photograph that can be retried, not a lost upload.
              const { preview, warnings } = await api.processFace(character.id);
              setStage({ kind: "REVIEW", character, preview, warnings });
            });
          }}
        />
        {notice && <p className={`studio-notice ${notice.tone.toLowerCase()}`}>{notice.message}</p>}
      </section>
    );
  }

  // ------------------------------------------------------------------ create: the review
  if (stage.kind === "REVIEW") {
    const { character, preview, warnings } = stage;
    return (
      <section className="studio-step">
        <h2>ASÍ QUEDA EN EL JUEGO</h2>
        <p>
          Esta es la versión adaptada a la iluminación del juego. Si no te reconoces, vuelve a
          recortar o prueba otra foto: la cara anterior no se sustituye hasta que aceptes.
        </p>
        <div className="face-review">
          {/* eslint-disable-next-line @next/next/no-img-element -- a private media route, not a static asset */}
          <img src={preview} alt={`Rostro de ${character.name} adaptado al juego`} width={256} height={256} />
        </div>
        {warnings.length > 0 && (
          <ul className="studio-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <div className="studio-actions">
          <button
            type="button"
            className="cta-secondary"
            onClick={() => {
              void run(async () => {
                await api.discardFace(character.id);
                setStage({ kind: "PHOTO", character });
              });
            }}
            disabled={busy}
          >
            OTRA FOTO
          </button>
          <button
            type="button"
            className="cta-primary"
            onClick={() => {
              void run(async () => {
                await api.confirmFace(character.id);
                setStage({ kind: "LIST" });
                await refresh();
              }, "Personaje guardado.");
            }}
            disabled={busy}
          >
            {busy ? "GUARDANDO…" : "ACEPTAR Y GUARDAR"}
          </button>
        </div>
        {notice && <p className={`studio-notice ${notice.tone.toLowerCase()}`}>{notice.message}</p>}
      </section>
    );
  }

  // ------------------------------------------------------------------ the library
  return (
    <section className="studio-library">
      <header className="studio-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="BUSCAR POR NOMBRE…"
          aria-label="Buscar personajes"
        />
        <label className="studio-toggle">
          <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
          <span>PAPELERA</span>
        </label>
        <button className="cta-primary" onClick={() => setStage({ kind: "NAMING" })}>
          + CREAR PERSONAJE
        </button>
      </header>

      {notice && <p className={`studio-notice ${notice.tone.toLowerCase()}`}>{notice.message}</p>}

      {importable > 0 && (
        <div className="studio-import">
          <div>
            <strong>
              {importable === 1
                ? "Hay 1 personaje guardado en este navegador"
                : `Hay ${importable} personajes guardados en este navegador`}
            </strong>
            <span>
              Son de antes del estudio. Al importarlos pasan al servidor y estaran en cualquier
              dispositivo. Las copias locales se quedan donde estan.
            </span>
          </div>
          <div className="studio-import-actions">
            <button
              className="cta-secondary"
              onClick={() => {
                try {
                  window.localStorage.setItem(IMPORTED_FLAG, "1");
                } catch {
                  // Nothing to remember; the banner returns next visit, which is harmless.
                }
                setImportable(0);
              }}
            >
              NO, GRACIAS
            </button>
            <button
              className="cta-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const local = loadCharacters();
                  let imported = 0;
                  const failures: string[] = [];
                  for (const definition of local) {
                    try {
                      await api.createCharacter({
                        name: definition.name,
                        appearance: fromDefinition(definition),
                      });
                      imported += 1;
                    } catch (cause) {
                      // One bad character must not stop the rest: the point of an import is to
                      // rescue what can be rescued, and then say what could not.
                      failures.push(definition.name);
                      void cause;
                    }
                  }
                  try {
                    window.localStorage.setItem(IMPORTED_FLAG, "1");
                  } catch {
                    // As above.
                  }
                  setImportable(0);
                  await refresh();
                  if (failures.length > 0) {
                    setNotice({
                      tone: "ERROR",
                      message: `Importados ${imported}. No se han podido importar: ${failures.join(", ")}.`,
                    });
                  } else {
                    setNotice({ tone: "OK", message: `Importados ${imported} personajes.` });
                  }
                })
              }
            >
              IMPORTARLOS
            </button>
          </div>
        </div>
      )}

      {characters.length === 0 ? (
        <div className="studio-empty">
          <h3>No tienes personajes todavía</h3>
          <p>Crea el primero: nombre, una foto y listo para correr.</p>
          <button className="cta-primary" onClick={() => setStage({ kind: "NAMING" })}>
            CREAR PRIMER PERSONAJE
          </button>
        </div>
      ) : (
        <ul className="character-grid">
          {characters.map((character) => (
            <li key={character.id} className={character.deletedAt ? "deleted" : ""}>
              <div className="character-avatar">
                {character.avatarThumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private media route
                  <img src={character.avatarThumbnailUrl} alt={`Avatar de ${character.name}`} width={96} height={96} />
                ) : (
                  <span className="character-initial" aria-hidden="true">
                    {character.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <h3>{character.name}</h3>
              <p className="character-meta">
                {character.deletedAt
                  ? "EN LA PAPELERA"
                  : character.faceState === "FAILED"
                    ? "LA FOTO FALLÓ"
                    : character.faceState === "READY"
                      ? "LISTO"
                      : character.faceState
                        ? "PROCESANDO FOTO"
                        : "SIN FOTO"}
                {selected === character.id ? " · SELECCIONADO" : ""}
              </p>

              <div className="character-actions">
                {character.deletedAt ? (
                  <button
                    onClick={() => void run(async () => { await api.restoreCharacter(character.id); await refresh(); }, "Restaurado.")}
                    disabled={busy}
                  >
                    RESTAURAR
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        try {
                          window.localStorage.setItem(LAST_SELECTED, character.id);
                        } catch {
                          // The race can still be told which character to use for this session.
                        }
                        setSelected(character.id);
                        setNotice({ tone: "OK", message: `${character.name} correrá la próxima carrera.` });
                      }}
                      disabled={busy}
                    >
                      SELECCIONAR
                    </button>
                    <Link className="character-link" href={`/garage/characters/${character.id}`}>
                      EDITAR
                    </Link>
                    <button
                      onClick={() =>
                        void run(async () => {
                          const full = await api.getCharacter(character.id);
                          setStage({ kind: "PHOTO", character: full });
                        })
                      }
                      disabled={busy}
                    >
                      {character.faceState ? "CAMBIAR FOTO" : "AÑADIR FOTO"}
                    </button>
                    <button
                      onClick={() => void run(async () => { await api.duplicateCharacter(character.id, false); await refresh(); }, "Duplicado sin la foto.")}
                      disabled={busy}
                    >
                      DUPLICAR
                    </button>
                    <button
                      className={character.isFavourite ? "active" : ""}
                      aria-pressed={character.isFavourite}
                      onClick={() =>
                        void run(async () => {
                          const full = await api.getCharacter(character.id);
                          await api.updateCharacter(character.id, {
                            isFavourite: !full.isFavourite,
                            expectedVersion: full.version,
                          });
                          await refresh();
                        })
                      }
                      disabled={busy}
                    >
                      {character.isFavourite ? "FAVORITO" : "+ FAVORITO"}
                    </button>
                    {character.faceState === "READY" || character.faceState === "FAILED" ? (
                      <button
                        onClick={() =>
                          void run(async () => {
                            // Re-runs the styling on the crop that is already stored, so the owner is
                            // not asked for the photograph again. It lands as pending and the live
                            // face is untouched until they accept.
                            const { preview, warnings } = await api.processFace(character.id);
                            const full = await api.getCharacter(character.id);
                            setStage({ kind: "REVIEW", character: full, preview, warnings });
                          })
                        }
                        disabled={busy}
                      >
                        REGENERAR ESTILO
                      </button>
                    ) : null}
                    {character.faceState ? (
                      <button
                        className="danger"
                        onClick={() =>
                          void run(async () => {
                            await api.deleteCharacterFace(character.id);
                            await refresh();
                          }, "Foto eliminada. El personaje se queda.")
                        }
                        disabled={busy}
                      >
                        QUITAR FOTO
                      </button>
                    ) : null}
                    <button
                      className="danger"
                      onClick={() => void run(async () => { await api.deleteCharacter(character.id); await refresh(); }, "Movido a la papelera.")}
                      disabled={busy}
                    >
                      ELIMINAR
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="studio-footer">
        <Link href="/admin/characters">Administración de personajes</Link>
        <span>
          Los personajes se guardan en el servidor: seguirán aquí mañana y en otro dispositivo.
        </span>
      </footer>
    </section>
  );
}
