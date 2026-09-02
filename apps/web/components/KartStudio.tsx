"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createDefaultKart, randomKart, validateKart, type KartDefinition } from "@print-rush/3d-factory";
import { FactoryPreview } from "@/factory/FactoryPreview";
import { exportDefinition, loadActiveKart, loadKarts, saveKart } from "@/factory/storage";

export function KartStudio() {
  const [definition, setDefinition] = useState<KartDefinition>(() => createDefaultKart());
  const [library, setLibrary] = useState<KartDefinition[]>([]);
  const [status, setStatus] = useState("Listo para fabricar");
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { const loaded = loadActiveKart(); setDefinition((current) => JSON.stringify(current) === JSON.stringify(loaded) ? current : loaded); setLibrary(loadKarts()); } }); return () => { active = false; }; }, []);
  const mutate = (fn: (draft: KartDefinition) => void) => setDefinition((current) => { const next = structuredClone(current); fn(next); return next; });
  const save = () => {
    const error = validateKart(definition).find((entry) => entry.severity === "ERROR");
    if (error) { setStatus(error.message); return; }
    setLibrary(saveKart(definition)); setStatus("Kart guardado y equipado para la próxima carrera");
  };
  const randomize = () => { const next = randomKart(Date.now() >>> 0, definition.name); setDefinition(next); setStatus("Configuración aleatoria generada"); };
  return <main className="studio-shell kart-studio">
    <header className="studio-topbar"><Link className="brand" href="/"><span className="brand-mark">PR</span><span>PRINT RUSH</span></Link><nav><Link href="/garage/character">PERSONAJE</Link><Link href="/factory/track">CIRCUITO</Link><Link href="/factory">ASSETS</Link><Link href="/">JUGAR</Link></nav></header>
    <section className="studio-layout">
      <aside className="studio-copy"><span className="studio-kicker">GARAGE / KART FACTORY V2</span><h1>MONTA TU<br /><i>KART</i></h1><p>Cinco carrocerías paramétricas, piezas compatibles y pintura en tiempo real. La misma definición se usa en la parrilla.</p><div className="kart-spec"><span><b>05</b> CARROCERÍAS</span><span><b>05</b> RUEDAS</span><span><b>04</b> ACABADOS</span></div><button className="random-button" onClick={randomize}>↻ SORPRÉNDEME</button><div className="studio-status"><span />{status}</div></aside>
      <section className="preview-stage"><FactoryPreview kart={definition} /><span className="preview-hint">ARRASTRA PARA ROTAR · RUEDA PARA ZOOM</span></section>
      <aside className="control-drawer">
        <div className="drawer-title"><span>BUILD #{definition.number.toString().padStart(2, "0")}</span><strong>{definition.name}</strong></div>
        <KText label="NOMBRE" value={definition.name} onChange={(value) => mutate((draft) => { draft.name = value.slice(0, 24); })} />
        <KSelect label="CARROCERÍA" value={definition.body} options={["CLASSIC", "PACKAGE", "SPRINT", "ROLLER", "INK_TANK"]} onChange={(value) => mutate((draft) => { draft.body = value as KartDefinition["body"]; })} />
        <KSelect label="MORRO" value={definition.nose} options={["ROUND", "WEDGE", "BOX", "TWIN"]} onChange={(value) => mutate((draft) => { draft.nose = value as KartDefinition["nose"]; })} />
        <KSelect label="ALERÓN" value={definition.spoiler} options={["NONE", "LOW", "WING", "DOUBLE"]} onChange={(value) => mutate((draft) => { draft.spoiler = value as KartDefinition["spoiler"]; })} />
        <KSelect label="RUEDA" value={definition.wheel} options={["CLASSIC", "CHUNKY", "SLICK", "OFFROAD", "ROLLER"]} onChange={(value) => mutate((draft) => { draft.wheel = value as KartDefinition["wheel"]; })} />
        <KSelect label="LLANTA" value={definition.rim} options={["DISC", "FIVE_SPOKE", "STAR", "INK_SPLAT"]} onChange={(value) => mutate((draft) => { draft.rim = value as KartDefinition["rim"]; })} />
        <KSelect label="ANTENA" value={definition.antenna} options={["NONE", "BALL", "SHIRT", "FLAG"]} onChange={(value) => mutate((draft) => { draft.antenna = value as KartDefinition["antenna"]; })} />
        <KSelect label="VINILO" value={definition.decal} options={["NONE", "BOLT", "STRIPES", "INK", "NUMBER"]} onChange={(value) => mutate((draft) => { draft.decal = value as KartDefinition["decal"]; })} />
        <KSelect label="ACABADO" value={definition.finish} options={["MATTE", "GLOSS", "METALLIC", "PEARL"]} onChange={(value) => mutate((draft) => { draft.finish = value as KartDefinition["finish"]; })} />
        <KSelect label="LIVERY" value={definition.livery ?? "NONE"} options={["NONE", "PAMPLING_RACING", "SCREENPRINT_CMYK", "COMIC", "NEON", "RETRO", "WAREHOUSE_EXPRESS", "WITUKA_SURF"]} onChange={(value) => mutate((draft) => { draft.livery = value as NonNullable<KartDefinition["livery"]>; })} />
        <KColor label="PINTURA" value={definition.primaryColor} onChange={(value) => mutate((draft) => { draft.primaryColor = value; })} /><KColor label="SECUNDARIO" value={definition.secondaryColor} onChange={(value) => mutate((draft) => { draft.secondaryColor = value; })} /><KColor label="LLANTAS" value={definition.rimColor} onChange={(value) => mutate((draft) => { draft.rimColor = value; })} />
        <label className="studio-control"><span>NÚMERO <b>{definition.number}</b></span><input type="range" min="0" max="99" value={definition.number} onChange={(event) => mutate((draft) => { draft.number = Number(event.target.value); })} /></label>
        <div className="drawer-actions"><button className="drawer-primary" onClick={save}>GUARDAR + EQUIPAR</button><button onClick={() => exportDefinition(`${definition.id}.json`, definition)}>EXPORTAR JSON</button></div>
        <details className="preset-library"><summary>MIS KARTS · {library.length}</summary>{library.map((item) => <div key={item.id}><button onClick={() => { setDefinition(item); saveKart(item); setStatus(`${item.name} equipado`); }}>{item.name}</button></div>)}</details>
      </aside>
    </section>
  </main>;
}

function KSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) { return <label className="studio-control"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option.replaceAll("_", " ")}</option>)}</select></label>; }
function KColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="studio-control color-control"><span>{label}</span><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function KText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="studio-control"><span>{label}</span><input className="text-control" value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
