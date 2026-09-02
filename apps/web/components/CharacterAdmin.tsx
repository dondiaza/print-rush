"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CharacterSummary } from "@print-rush/character-core";
import * as api from "@/characters/api";

/**
 * THE ADMIN TABLE.
 *
 * The brief's administration view: every character with its owner, state, dates and asset status,
 * and the actions an operator needs — deactivate, restore, delete, reprocess a face, open the editor.
 *
 * It is a table rather than the card grid the library uses, because the two answer different
 * questions. A person browsing their own characters wants to recognise a face; an operator asking
 * "whose photo failed to process last week" wants columns they can scan and sort.
 *
 * The admin flag is a label, not a permission. The studio key is what actually gates every one of
 * these requests — the server records the claimed identity for the audit trail and never trusts it —
 * so this page shows what an operator needs rather than pretending to be an authorisation boundary.
 */

type Sort = "UPDATED" | "NAME" | "OWNER" | "USED";

export function CharacterAdmin() {
  const [rows, setRows] = useState<CharacterSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(true);
  const [sort, setSort] = useState<Sort>("UPDATED");
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // `deleted` is what makes this the recycle bin as well as the roster: an operator restoring a
      // character needs to see it, and nobody else does.
      const list = await api.listCharacters({ deleted: includeDeleted });
      setRows(list);
      setError(null);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : "No hemos podido cargar la lista.");
    }
  }, [includeDeleted]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const act = async (id: string, action: () => Promise<void>, message: string): Promise<void> => {
    setBusy(id);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La acción ha fallado.");
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) return <section className="studio-loading">CARGANDO REGISTRO…</section>;

  if (!api.studioKey()) {
    return (
      <section className="studio-step">
        <h2>SIN ACCESO</h2>
        <p>
          Esta vista necesita la clave del estudio. Introdúcela en{" "}
          <Link href="/garage/characters">Personajes</Link> y marca el modo administrador.
        </p>
      </section>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case "NAME":
        return a.name.localeCompare(b.name);
      case "OWNER":
        return a.ownerId.localeCompare(b.ownerId) || a.name.localeCompare(b.name);
      case "USED":
        // Never-used last rather than first: a null is not "least recently used", it is "unknown",
        // and sorting it to the top buries the rows an operator is actually looking for.
        return (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "");
      default:
        return b.updatedAt.localeCompare(a.updatedAt);
    }
  });

  const date = (value: string | null): string =>
    value ? new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

  const assetStatus = (row: CharacterSummary): { label: string; tone: string } => {
    if (!row.faceState) return { label: "SIN FOTO", tone: "none" };
    if (row.faceState === "READY") return { label: "LISTO", tone: "ok" };
    if (row.faceState === "FAILED") return { label: "FALLÓ", tone: "bad" };
    return { label: row.faceState, tone: "wait" };
  };

  return (
    <section className="admin">
      <header className="admin-toolbar">
        <label className="studio-toggle">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => setIncludeDeleted(event.target.checked)}
          />
          <span>INCLUIR ELIMINADOS</span>
        </label>
        <label className="studio-toggle">
          <span>ORDENAR</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="UPDATED">Modificado</option>
            <option value="USED">Último uso</option>
            <option value="NAME">Nombre</option>
            <option value="OWNER">Dueño</option>
          </select>
        </label>
        <span className="admin-count">{sorted.length} personajes</span>
      </header>

      {error && <p className="studio-notice error">{error}</p>}
      {notice && <p className="studio-notice ok">{notice}</p>}

      {sorted.length === 0 ? (
        <div className="studio-empty">
          <h3>No hay personajes</h3>
          <p>Cuando alguien cree uno aparecerá aquí.</p>
        </div>
      ) : (
        <div className="scroll-x">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Dueño</th>
                <th>Estado</th>
                <th>Foto</th>
                <th className="num">Creado</th>
                <th className="num">Último uso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const asset = assetStatus(row);
                const working = busy === row.id;
                return (
                  <tr key={row.id} className={row.deletedAt ? "deleted" : ""}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.isFavourite && <span className="admin-flag">favorito</span>}
                    </td>
                    <td className="mono">{row.ownerId}</td>
                    <td>
                      <span className={`admin-pill ${row.deletedAt ? "bad" : row.isActive ? "ok" : "wait"}`}>
                        {row.deletedAt ? "ELIMINADO" : row.isActive ? row.status : "DESACTIVADO"}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-pill ${asset.tone}`}>{asset.label}</span>
                    </td>
                    <td className="num">{date(row.createdAt)}</td>
                    <td className="num">{date(row.lastUsedAt)}</td>
                    <td>
                      <div className="admin-actions">
                        {row.deletedAt ? (
                          <button
                            disabled={working}
                            onClick={() =>
                              void act(row.id, async () => {
                                await api.restoreCharacter(row.id);
                              }, `${row.name} restaurado.`)
                            }
                          >
                            RESTAURAR
                          </button>
                        ) : (
                          <>
                            <Link className="character-link" href={`/garage/characters/${row.id}`}>
                              EDITAR
                            </Link>
                            <button
                              disabled={working}
                              onClick={() =>
                                void act(row.id, async () => {
                                  const full = await api.getCharacter(row.id);
                                  await api.updateCharacter(row.id, {
                                    isActive: !full.isActive,
                                    expectedVersion: full.version,
                                  });
                                }, `${row.name} ${row.isActive ? "desactivado" : "activado"}.`)
                              }
                            >
                              {row.isActive ? "DESACTIVAR" : "ACTIVAR"}
                            </button>
                            {row.faceState && row.faceState !== "PROCESSING" && (
                              <button
                                disabled={working}
                                onClick={() =>
                                  void act(row.id, async () => {
                                    // Restyles the stored crop. It lands as pending, so the live face
                                    // survives until somebody accepts it in the studio.
                                    await api.processFace(row.id);
                                  }, `Rostro de ${row.name} regenerado; pendiente de aceptar en el estudio.`)
                                }
                              >
                                REPROCESAR CARA
                              </button>
                            )}
                            <button
                              className="danger"
                              disabled={working}
                              onClick={() =>
                                void act(row.id, async () => {
                                  await api.deleteCharacter(row.id);
                                }, `${row.name} movido a la papelera.`)
                              }
                            >
                              ELIMINAR
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="editor-hint">
        Eliminar es reversible: el personaje queda en la papelera y sus archivos siguen en el
        almacenamiento. El borrado definitivo, con sus imágenes, es una operación aparte que no se
        expone aquí a propósito.
      </p>
    </section>
  );
}
