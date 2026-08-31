"use client";
import { useEffect, useRef } from "react";
import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, MeshBuilder, PBRMaterial, Scene, Vector3 } from "@babylonjs/core";
import { CharacterPresets } from "@print-rush/3d-factory";
import { createGeneratedCharacter } from "@/factory/GeneratedCharacter";
import { loadActiveCharacter } from "@/factory/storage";

export function PodiumScene({ position }: { position: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const engine = new Engine(canvas, true, { adaptToDeviceRatio: true }); const scene = new Scene(engine); scene.clearColor = new Color4(0,0,0,0);
    const camera = new FreeCamera("podium-camera", new Vector3(0,3.6,-9.2),scene); camera.setTarget(new Vector3(0,1.7,0)); camera.fov=.7;
    new HemisphericLight("podium-fill",new Vector3(0,1,0),scene).intensity=1.1; const key=new DirectionalLight("podium-key",new Vector3(-.4,-1,.5),scene); key.intensity=2;
    const active=loadActiveCharacter(); const podium=[position===1?active:CharacterPresets[1]!,position===2?active:CharacterPresets[3]!,position>2?active:CharacterPresets[5]!];
    const heights=[1.15,.78,.52]; const x=[0,-2,2];
    podium.forEach((definition,index)=>{ const mat=new PBRMaterial(`podium-mat-${index}`,scene); mat.albedoColor=Color3.FromHexString(index===0?"#ff3da6":index===1?"#b9ff45":"#4db7ff"); mat.roughness=.72; const block=MeshBuilder.CreateBox(`podium-${index}`,{width:1.65,height:heights[index]!,depth:1.45},scene); block.position.set(x[index]!,heights[index]!/2,0); block.material=mat; const rider=createGeneratedCharacter(scene,definition,`podium-rider-${index}`,{pose:"CELEBRATE",quality:"MEDIUM"}); rider.position.set(x[index]!,heights[index]!,0); rider.metadata={...rider.metadata,animationBaseY:heights[index]!}; });
    engine.runRenderLoop(()=>scene.render()); const resize=()=>engine.resize(); window.addEventListener("resize",resize); return()=>{window.removeEventListener("resize",resize);scene.dispose();engine.dispose();};
  },[position]);
  return <canvas ref={canvasRef} className="podium-canvas" aria-label="Podio 3D de la carrera" />;
}
