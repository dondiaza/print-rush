"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BeardLibrary, BodyPresets, GlassesLibrary, HairLibrary, ShirtDesigns,
  createDefaultCharacter, randomCharacter, validateCharacter,
  type CharacterDefinition,
} from "@print-rush/3d-factory";
import { FactoryPreview } from "@/factory/FactoryPreview";
import { analyzeAvatarPhoto, type FaceAnalysisState } from "@/factory/FaceAvatarAnalyzer";
import { deleteAvatar, exportDefinition, loadActiveCharacter, loadCharacters, saveCharacter } from "@/factory/storage";

type Mode = "MANUAL" | "PHOTO" | "RANDOM";
type Panel = "IDENTITY" | "FACE" | "HAIR" | "OUTFIT";

export function CharacterStudio() {
  const [definition, setDefinition] = useState<CharacterDefinition>(() => createDefaultCharacter());
  const [library, setLibrary] = useState<CharacterDefinition[]>([]);
  const [mode, setMode] = useState<Mode>("MANUAL");
  const [panel, setPanel] = useState<Panel>("IDENTITY");
  const [status, setStatus] = useState("Listo para personalizar");
  const [analysisState, setAnalysisState] = useState<FaceAnalysisState>("IDLE");
  const [consent, setConsent] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { const loaded = loadActiveCharacter(); setDefinition((current) => JSON.stringify(current) === JSON.stringify(loaded) ? current : loaded); setLibrary(loadCharacters()); } }); return () => { active = false; }; }, []);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); streamRef.current?.getTracks().forEach((track) => track.stop()); }, [photoUrl]);

  const mutate = (fn: (draft: CharacterDefinition) => void) => {
    setDefinition((current) => { const next = structuredClone(current); fn(next); next.source = mode === "PHOTO" ? next.source : "MANUAL"; return next; });
  };
  const save = () => {
    const issues = validateCharacter(definition).filter((entry) => entry.severity === "ERROR");
    if (issues.length) { setStatus(`No se puede guardar: ${issues[0]!.message}`); return; }
    setLibrary(saveCharacter(definition));
    setStatus("Guardado y equipado para la próxima carrera");
  };
  const randomize = () => {
    const next = randomCharacter((Date.now() ^ Math.floor(Math.random() * 1e6)) >>> 0, definition.name || "Rider");
    setDefinition(next); setMode("RANDOM"); setStatus("Variación determinista generada");
  };
  const analyze = async (file: File) => {
    if (!consent) { setStatus("Confirma el consentimiento antes de analizar la foto"); return; }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
    try {
      const result = await analyzeAvatarPhoto(file, definition, setAnalysisState);
      setDefinition(result.character);
      setMode("PHOTO");
      setStatus(result.quality.warnings[0] ?? `Cara analizada en el dispositivo · ${result.quality.width} × ${result.quality.height}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo analizar la foto"); }
  };
  const openCamera = async () => {
    if (!consent) { setStatus("Confirma el consentimiento antes de abrir la cámara"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      streamRef.current = stream; setCameraOpen(true);
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); } });
    } catch { setStatus("No se pudo abrir la cámara. Revisa el permiso o elige una foto."); }
  };
  const closeCamera = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setCameraOpen(false); };
  const captureCamera = () => {
    const video = videoRef.current; if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => { if (blob) { closeCamera(); void analyze(new File([blob], "camera-avatar.webp", { type: "image/webp" })); } }, "image/webp", .9);
  };

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <Link className="brand" href="/"><span className="brand-mark">PR</span><span>PRINT RUSH</span></Link>
        <nav><Link href="/garage/kart">KART</Link><Link href="/factory/track">CIRCUITO</Link><Link href="/factory">ASSETS</Link><Link href="/">JUGAR</Link></nav>
      </header>
      <section className="studio-layout">
        <aside className="studio-copy">
          <span className="studio-kicker">GARAGE / CHARACTER FACTORY V3</span>
          <h1>CREA TU<br /><i>RIDER</i></h1>
          <p>Una identidad paramétrica, editable y lista para conducir. La silueta se mantiene legible incluso en móvil.</p>
          <div className="mode-tabs" role="tablist">
            {(["MANUAL", "PHOTO", "RANDOM"] as const).map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => item === "RANDOM" ? randomize() : setMode(item)}>{item === "MANUAL" ? "PERSONALIZAR" : item === "PHOTO" ? "DESDE FOTO" : "ALEATORIO"}</button>)}
          </div>
          <div className="studio-status" data-state={analysisState}><span />{status}</div>
        </aside>

        <section className="preview-stage">
          <FactoryPreview character={definition} />
          <span className="preview-hint">ARRASTRA PARA ROTAR · RUEDA PARA ZOOM</span>
          {photoUrl && mode === "PHOTO" && <div className="photo-reference" role="img" aria-label="Referencia temporal, no guardada" style={{ backgroundImage: `url(${photoUrl})` }} />}
        </section>

        <aside className="control-drawer">
          <div className="control-tabs">
            {(["IDENTITY", "FACE", "HAIR", "OUTFIT"] as const).map((item) => <button key={item} className={panel === item ? "active" : ""} onClick={() => setPanel(item)}>{item}</button>)}
          </div>

          {mode === "PHOTO" && (
            <div className="photo-panel">
              <strong>AVATAR DESDE FOTO</strong>
              <p>El modelo detecta proporciones en tu dispositivo. La foto original se descarta al cerrar esta pantalla y nunca entra en la partida.</p>
              <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Autorizo el análisis local para crear mi avatar.</label>
              <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(event) => { const file = event.target.files?.[0]; if (file) void analyze(file); }} />
              {cameraOpen ? <div className="camera-capture"><video ref={videoRef} playsInline muted /><div><button className="drawer-primary" onClick={captureCamera}>CAPTURAR</button><button onClick={closeCamera}>CANCELAR</button></div></div> : <div className="photo-actions"><button className="drawer-primary" onClick={() => fileRef.current?.click()}>{analysisState === "LOADING_MODEL" ? "CARGANDO MODELO…" : analysisState === "ANALYZING" ? "ANALIZANDO…" : "ELEGIR FOTO"}</button><button onClick={() => void openCamera()}>ABRIR CÁMARA</button></div>}
            </div>
          )}

          {panel === "IDENTITY" && <>
            <ControlText label="NOMBRE" value={definition.name} onChange={(value) => mutate((draft) => { draft.name = value.slice(0, 24); })} />
            <ControlSelect label="CUERPO" value={definition.body.preset} options={BodyPresets} onChange={(value) => mutate((draft) => { draft.body.preset = value as CharacterDefinition["body"]["preset"]; })} />
            <ControlRange label="ALTURA" value={definition.body.height} min={.9} max={1.1} onChange={(value) => mutate((draft) => { draft.body.height = value; })} />
            <ControlRange label="HOMBROS" value={definition.body.shoulderWidth} min={.82} max={1.18} onChange={(value) => mutate((draft) => { draft.body.shoulderWidth = value; })} />
            <ControlRange label="VOLUMEN" value={definition.body.volume} min={.82} max={1.18} onChange={(value) => mutate((draft) => { draft.body.volume = value; })} />
            <ControlSelect label="ACTITUD" value={definition.personality} options={["CALM", "ENERGETIC", "COOL", "FUNNY"]} onChange={(value) => mutate((draft) => { draft.personality = value as CharacterDefinition["personality"]; })} />
          </>}
          {panel === "FACE" && <>
            <ControlColor label="PIEL" value={definition.face.skinTone} onChange={(value) => mutate((draft) => { draft.face.skinTone = value; })} />
            <ControlRange label="ANCHO CARA" value={definition.face.width} min={.82} max={1.18} onChange={(value) => mutate((draft) => { draft.face.width = value; })} />
            <ControlRange label="ALTURA CARA" value={definition.face.height} min={.86} max={1.14} onChange={(value) => mutate((draft) => { draft.face.height = value; })} />
            <ControlRange label="MANDÍBULA" value={definition.face.jawWidth} min={.78} max={1.18} onChange={(value) => mutate((draft) => { draft.face.jawWidth = value; })} />
            <ControlRange label="OJOS" value={definition.face.eyes.size} min={.72} max={1.3} onChange={(value) => mutate((draft) => { draft.face.eyes.size = value; })} />
            <ControlColor label="IRIS" value={definition.face.eyes.irisColor} onChange={(value) => mutate((draft) => { draft.face.eyes.irisColor = value; })} />
          </>}
          {panel === "HAIR" && <>
            <ControlSelect label="PEINADO · 30" value={definition.hair.style} options={HairLibrary} onChange={(value) => mutate((draft) => { draft.hair.style = value as CharacterDefinition["hair"]["style"]; })} />
            <ControlColor label="COLOR PELO" value={definition.hair.color} onChange={(value) => mutate((draft) => { draft.hair.color = value; draft.facialHair.color = value; })} />
            <ControlRange label="VOLUMEN" value={definition.hair.volume} min={.72} max={1.3} onChange={(value) => mutate((draft) => { draft.hair.volume = value; })} />
            <ControlSelect label="BARBA" value={definition.facialHair.style} options={BeardLibrary} onChange={(value) => mutate((draft) => { draft.facialHair.style = value as CharacterDefinition["facialHair"]["style"]; })} />
            <ControlSelect label="GAFAS" value={definition.glasses.style} options={GlassesLibrary} onChange={(value) => mutate((draft) => { draft.glasses.style = value as CharacterDefinition["glasses"]["style"]; })} />
          </>}
          {panel === "OUTFIT" && <>
            <ControlSelect label="CAMISETA" value={definition.shirt.model} options={["TSHIRT", "SWEATSHIRT", "HOODIE", "JACKET"]} onChange={(value) => mutate((draft) => { draft.shirt.model = value as CharacterDefinition["shirt"]["model"]; })} />
            <ControlColor label="COLOR" value={definition.shirt.baseColor} onChange={(value) => mutate((draft) => { draft.shirt.baseColor = value; draft.shirt.sleeveColor = value; })} />
            <ControlSelect label="DISEÑO" value={definition.shirt.frontDesign} options={ShirtDesigns} onChange={(value) => mutate((draft) => { draft.shirt.frontDesign = value as CharacterDefinition["shirt"]["frontDesign"]; })} />
            <ControlSelect label="PANTALÓN" value={definition.pants.style} options={["JEANS", "CHINO", "JOGGER"]} onChange={(value) => mutate((draft) => { draft.pants.style = value as CharacterDefinition["pants"]["style"]; })} />
            <ControlSelect label="ZAPATILLAS" value={definition.shoes.style} options={["CLASSIC", "RUNNER", "HIGH_TOP"]} onChange={(value) => mutate((draft) => { draft.shoes.style = value as CharacterDefinition["shoes"]["style"]; })} />
            <ControlColor label="ZAPATILLAS" value={definition.shoes.color} onChange={(value) => mutate((draft) => { draft.shoes.color = value; })} />
          </>}

          <div className="drawer-actions"><button className="drawer-primary" onClick={save}>GUARDAR + EQUIPAR</button><button onClick={() => exportDefinition(`${definition.id}.json`, definition)}>EXPORTAR JSON</button></div>
          <details className="preset-library"><summary>MIS PERSONAJES · {library.length}</summary>{library.map((item) => <div key={item.id}><button onClick={() => { setDefinition(item); setStatus(`${item.name} equipado`); saveCharacter(item); }}>{item.name}</button><button aria-label={`Eliminar ${item.name}`} onClick={() => setLibrary(deleteAvatar(item.id))}>×</button></div>)}</details>
        </aside>
      </section>
    </main>
  );
}

function ControlRange({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="studio-control"><span>{label}<b>{value.toFixed(2)}</b></span><input type="range" min={min} max={max} step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
function ControlSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="studio-control"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option.replaceAll("_", " ")}</option>)}</select></label>;
}
function ControlColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="studio-control color-control"><span>{label}</span><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function ControlText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="studio-control"><span>{label}</span><input className="text-control" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
