"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RuntimeQuality } from "@print-rush/3d-factory";
import { FrameMonitor, getDeviceReport, setQualityOverride, type DeviceReport } from "@/performance/PerformanceManager";

export function PerformanceDashboard() {
  const [report, setReport] = useState<DeviceReport | null>(null);
  const [fps, setFps] = useState<{ fps: number; frameMs: number; samples: number; rating: "GOOD" | "LIMITED" | "POOR" }>({ fps: 0, frameMs: 0, samples: 0, rating: "GOOD" });
  const [renderer, setRenderer] = useState("Detectando…");
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    const detectedRenderer = debug ? String(gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : gl ? "WebGL compatible" : "WebGL no disponible";
    let active = true;
    queueMicrotask(() => { if (active) { setReport(getDeviceReport()); setRenderer(detectedRenderer); } });
    const monitor = new FrameMonitor();
    let previous = performance.now(); let id = 0; let lastReport = previous;
    const loop = (now: number) => { monitor.record(now - previous); previous = now; if (now - lastReport > 350) { setFps(monitor.snapshot()); lastReport = now; } id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => { active = false; cancelAnimationFrame(id); };
  }, []);
  const choose = (value: RuntimeQuality | "AUTO") => { setQualityOverride(value); setReport(getDeviceReport()); };
  return <main className="diagnostic-shell"><header><Link href="/">← PRINT RUSH</Link><span>PERFORMANCE MANAGER V3</span></header><section><div className="diagnostic-title"><span>LIVE DEVICE REPORT</span><h1>{fps.fps}<i> FPS</i></h1><p>Este panel mide el ritmo del navegador y permite fijar un perfil. La carrera sigue ajustando resolución dinámicamente si detecta caídas sostenidas.</p></div><div className="diagnostic-grid"><Metric label="FRAME TIME" value={`${fps.frameMs} ms`} /><Metric label="ESTADO" value={fps.rating} /><Metric label="PERFIL" value={report?.profile ?? "…"} /><Metric label="MODO" value={report?.automatic ? "AUTO" : "MANUAL"} /><Metric label="CPU" value={`${report?.cores ?? "…"} hilos`} /><Metric label="MEMORIA" value={report?.memoryGb ? `${report.memoryGb} GB` : "No expuesta"} /><Metric label="PIXEL RATIO" value={String(report?.pixelRatio ?? "…")} /><Metric label="ENTRADA" value={report?.mobile ? "TÁCTIL" : "TECLADO / MANDO"} /></div><div className="renderer-line"><span>GPU / RENDERER</span><strong>{renderer}</strong></div><div className="quality-picker"><span>CALIDAD</span>{(["AUTO", "LOW", "MEDIUM", "HIGH", "ULTRA"] as const).map((value) => <button key={value} className={(value === "AUTO" ? report?.automatic : !report?.automatic && report?.profile === value) ? "active" : ""} onClick={() => choose(value)}>{value}</button>)}</div><div className="diagnostic-links"><Link href="/garage/character">PROBAR PERSONAJE</Link><Link href="/garage/kart">PROBAR KART</Link><Link href="/">ENTRAR EN CARRERA</Link></div></section></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
