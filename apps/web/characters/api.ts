"use client";

import type {
  Character,
  CharacterAppearance,
  CharacterRuntime,
  CharacterSummary,
  FaceCrop,
} from "@print-rush/character-core";

/**
 * The studio's HTTP client.
 *
 * One module, so every request carries the studio key and every failure surfaces the message the
 * server wrote rather than "Failed to fetch". The alternative — `fetch` scattered through
 * components — is how a feature ends up with five different error behaviours and a header that one
 * call site forgets.
 *
 * The key is held in `localStorage`, which is the one legitimate use the brief allows for it: it is
 * a credential the operator pasted in, not the source of truth for anything. Characters live in
 * Postgres; this is a session convenience.
 */

const KEY_STORAGE = "print-rush.studio-key";
const OWNER_STORAGE = "print-rush.studio-owner";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** A version conflict is recoverable by reloading, so the UI needs to recognise it. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  get needsKey(): boolean {
    return this.status === 401;
  }
}

export function studioKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY_STORAGE);
  } catch {
    // A browser with storage blocked can still race; it just cannot open the studio.
    return null;
  }
}

export function setStudioKey(key: string, owner: string): void {
  try {
    window.localStorage.setItem(KEY_STORAGE, key.trim());
    window.localStorage.setItem(OWNER_STORAGE, owner.trim().toLowerCase() || "studio");
  } catch {
    // Non-fatal: the key stays in memory for this page load.
  }
}

export function studioOwner(): string {
  if (typeof window === "undefined") return "studio";
  try {
    return window.localStorage.getItem(OWNER_STORAGE) ?? "studio";
  } catch {
    return "studio";
  }
}

export function clearStudioKey(): void {
  try {
    window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Nothing to do.
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = studioKey();
  return {
    ...(key ? { "x-studio-key": key, "x-studio-owner": studioOwner() } : {}),
    ...extra,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  } catch (error) {
    // A network failure is not a server error, and the message has to say so or the operator will
    // go looking at the database.
    throw new ApiError(0, "OFFLINE", "No hay conexión con el servidor. Comprueba tu red.", error);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const payload = (body ?? {}) as { error?: string; code?: string; detail?: unknown };
    throw new ApiError(
      response.status,
      payload.code ?? "UNKNOWN",
      // The server's own message, which is written for a person. Falling back to a status code is
      // the last resort, not the default.
      payload.error ?? `La petición ha fallado (${response.status}).`,
      payload.detail,
    );
  }
  return body as T;
}

export async function listCharacters(options: { search?: string; favourites?: boolean; deleted?: boolean } = {}): Promise<CharacterSummary[]> {
  const params = new URLSearchParams();
  if (options.search) params.set("q", options.search);
  if (options.favourites) params.set("favourites", "1");
  if (options.deleted) params.set("deleted", "1");
  const query = params.toString();
  const body = await request<{ characters: CharacterSummary[] }>(
    `/api/characters${query ? `?${query}` : ""}`,
  );
  return body.characters;
}

export async function getCharacter(id: string): Promise<Character> {
  return (await request<{ character: Character }>(`/api/characters/${id}`)).character;
}

export async function createCharacter(input: {
  name: string;
  appearance?: CharacterAppearance;
  defaultKartId?: string | null;
}): Promise<Character> {
  return (
    await request<{ character: Character }>("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  ).character;
}

export async function updateCharacter(
  id: string,
  patch: {
    name?: string;
    appearance?: CharacterAppearance;
    defaultKartId?: string | null;
    isFavourite?: boolean;
    /** Always sent by the studio: this is what turns a lost edit into a 409. */
    expectedVersion: number;
  },
): Promise<Character> {
  return (
    await request<{ character: Character }>(`/api/characters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  ).character;
}

export async function deleteCharacter(id: string): Promise<void> {
  await request(`/api/characters/${id}`, { method: "DELETE" });
}

export async function deleteCharacterFace(id: string): Promise<void> {
  await request(`/api/characters/${id}?face=1`, { method: "DELETE" });
}

export async function restoreCharacter(id: string): Promise<Character> {
  return (await request<{ character: Character }>(`/api/characters/${id}/restore`, { method: "POST" })).character;
}

export async function duplicateCharacter(id: string, withFace: boolean): Promise<Character> {
  return (
    await request<{ character: Character }>(`/api/characters/${id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ withFace }),
    })
  ).character;
}

/**
 * Uploads the photograph and the crop.
 *
 * Two files, and the split is the security design rather than a convenience: the browser has
 * hardened decoders for every format a person might upload, so it produces the normalised PNG that
 * the server will actually parse. The original goes up verbatim and the server stores it without
 * ever opening it.
 */
export async function uploadFace(
  id: string,
  original: File,
  cropped: Blob,
  crop: FaceCrop,
): Promise<void> {
  const form = new FormData();
  form.set("original", original);
  form.set("cropped", new File([cropped], "crop.png", { type: "image/png" }));
  form.set("cropX", String(crop.x));
  form.set("cropY", String(crop.y));
  form.set("cropWidth", String(crop.width));
  form.set("cropHeight", String(crop.height));
  form.set("rotation", String(crop.rotation));
  form.set("zoom", String(crop.zoom));
  await request(`/api/characters/${id}/face`, { method: "POST", body: form });
}

export async function processFace(id: string): Promise<{ preview: string; warnings: string[] }> {
  return request<{ preview: string; warnings: string[] }>(`/api/characters/${id}/face/process`, {
    method: "POST",
  });
}

export async function confirmFace(id: string): Promise<Character> {
  return (await request<{ character: Character }>(`/api/characters/${id}/face/confirm`, { method: "POST" })).character;
}

export async function discardFace(id: string): Promise<Character> {
  return (await request<{ character: Character }>(`/api/characters/${id}/face/confirm`, { method: "DELETE" })).character;
}

/**
 * The race payload.
 *
 * The only character endpoint that works without the studio key, because rivals have to load each
 * other. It carries no photograph — see `toRuntime`, which is where that is enforced.
 */
export async function getRuntime(id: string): Promise<CharacterRuntime> {
  const response = await fetch(`/api/characters/${id}/runtime`);
  if (!response.ok) throw new ApiError(response.status, "RUNTIME", "No hemos podido cargar el personaje.");
  const body = (await response.json()) as { runtime: CharacterRuntime };
  return body.runtime;
}
