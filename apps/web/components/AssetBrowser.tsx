"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CharacterPresets, KartPresets, createPropCatalog, generateProp, hashDefinition,
  type CharacterDefinition, type FactoryAsset, type KartDefinition, type PropDefinition,
} from "@print-rush/3d-factory";
import { exportDefinition, loadCharacters, loadKarts } from "@/factory/storage";
import { TrackPresets, loadTracks, type StoredTrack } from "@/factory/TrackFactory";

type BrowserType = "ALL" | FactoryAsset["type"];
type BrowserAsset = { id: string; name: string; type: FactoryAsset["type"]; version: number; hash: string; meta: string; definition: unknown };

export function AssetBrowser() {
  const [type, setType] = useState<BrowserType>("ALL");
  const [query, setQuery] = useState("");
  const [props, setProps] = useState<PropDefinition[]>(() => createPropCatalog(50));
  const [characters, setCharacters] = useState<CharacterDefinition[]>([...CharacterPresets]);
  const [karts, setKarts] = useState<KartDefinition[]>([...KartPresets]);
  const [tracks, setTracks] = useState<StoredTrack[]>([...TrackPresets]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setCharacters(loadCharacters()); setKarts(loadKarts()); setTracks(loadTracks()); } }); return () => { active = false; }; }, []);

  const assets = useMemo<BrowserAsset[]>(() => {
    const characterAssets = characters.map((entry) => ({ id: entry.id, name: entry.name, type: "CHARACTER" as const, version: entry.schemaVersion, hash: hashDefinition(entry), meta: `${entry.hair.style} · ${entry.body.preset}`, definition: entry }));
    const kartAssets = karts.map((entry) => ({ id: entry.id, name: entry.name, type: "KART" as const, version: entry.schemaVersion, hash: hashDefinition(entry), meta: `${entry.body} · ${entry.wheel}`, definition: entry }));
    const trackAssets = tracks.map((entry) => ({ id: entry.config.id, name: entry.config.name, type: "TRACK" as const, version: entry.schemaVersion, hash: hashDefinition(entry), meta: `${entry.config.theme} · ${entry.config.width.toFixed(1)} M`, definition: entry }));
    const propAssets = props.map((entry) => ({ id: entry.id, name: `${entry.kind} ${entry.seed}`, type: "PROP" as const, version: entry.schemaVersion, hash: hashDefinition(entry), meta: `${entry.palette} · LOD ${entry.detail}`, definition: entry }));
    return [...characterAssets, ...kartAssets, ...trackAssets, ...propAssets].filter((entry) => (type === "ALL" || entry.type === type) && `${entry.name} ${entry.meta}`.toLowerCase().includes(query.toLowerCase()));
  }, [characters, karts, props, query, tracks, type]);

  return <main className="assets-shell">
    <header className="studio-topbar">
      <Link className="brand" href="/"><span className="brand-mark">PR</span><span>PRINT RUSH</span></Link>
      <nav><Link href="/garage/character">PERSONAJE</Link><Link href="/garage/kart">KART</Link><Link href="/factory/track">CIRCUITO</Link><Link href="/admin/performance">RENDIMIENTO</Link></nav>
    </header>
    <section className="assets-head"><div><span>3D FACTORY / ASSET REGISTRY</span><h1>GENERADO.<br /><i>VERSIONADO.</i></h1></div><p>Catálogo determinista de contenido paramétrico. Cada ficha conserva semilla, esquema y hash para poder reproducirse sin enviar geometría por red.</p></section>
    <section className="assets-tools"><div className="asset-filters">{(["ALL", "CHARACTER", "KART", "PROP", "TRACK"] as const).map((value) => <button key={value} className={type === value ? "active" : ""} onClick={() => setType(value)}>{value}</button>)}</div><input aria-label="Buscar assets" placeholder="BUSCAR POR NOMBRE O TIPO…" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="generate-prop" onClick={() => setProps((current) => [generateProp(Date.now() >>> 0), ...current])}>+ GENERAR PROP</button></section>
    <section className="asset-summary"><span><b>{assets.length}</b> RESULTADOS</span><span><b>{props.length}</b> PROPS</span><span><b>03</b> SCHEMAS ACTIVOS</span><span><b>100%</b> PARAMÉTRICO</span></section>
    <section className="asset-grid">{assets.map((asset) => <article key={`${asset.type}-${asset.id}`}><div className={`asset-glyph ${asset.type.toLowerCase()}`}>{asset.type === "CHARACTER" ? "◎" : asset.type === "KART" ? "◈" : asset.type === "TRACK" ? "⌁" : "▰"}</div><span>{asset.type} / V{asset.version}</span><h2>{asset.name}</h2><p>{asset.meta}</p><code>{asset.hash}</code><button onClick={() => exportDefinition(`${asset.id}.json`, asset.definition)}>EXPORTAR JSON ↗</button></article>)}</section>
  </main>;
}
