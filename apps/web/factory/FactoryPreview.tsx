"use client";

import { useEffect, useRef } from "react";
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight,
  MeshBuilder, PBRMaterial, Scene, ShadowGenerator, Vector3,
} from "@babylonjs/core";
import type { CharacterDefinition, KartDefinition, RuntimeQuality } from "@print-rush/3d-factory";
import { animateGeneratedCharacter, createGeneratedCharacter } from "./GeneratedCharacter";
import { createGeneratedKart } from "./GeneratedKart";

type PreviewProps = {
  character?: CharacterDefinition;
  kart?: KartDefinition;
  quality?: RuntimeQuality;
  className?: string;
};

export function FactoryPreview({ character, kart, quality = "HIGH", className = "" }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (!character && !kart)) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, adaptToDeviceRatio: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(.025, .026, .035, 1);
    scene.ambientColor = new Color3(.18, .18, .23);
    const target = kart ? new Vector3(0, .72, 0) : new Vector3(0, .92, 0);
    const camera = new ArcRotateCamera("factory-camera", -Math.PI / 2, Math.PI / 2.45, kart ? 5.1 : 4.2, target, scene);
    camera.lowerRadiusLimit = kart ? 3.2 : 2.7;
    camera.upperRadiusLimit = kart ? 7 : 5.8;
    camera.wheelPrecision = 42;
    camera.pinchPrecision = 75;
    camera.attachControl(canvas, true);
    new HemisphericLight("factory-fill", new Vector3(0, 1, 0), scene).intensity = 1.45;
    const key = new DirectionalLight("factory-key", new Vector3(-.5, -1, .65), scene);
    key.position.set(4, 7, -5);
    key.intensity = 2.1;
    const shadows = new ShadowGenerator(1024, key);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 18;
    const root = kart
      ? createGeneratedKart(scene, kart, "preview-kart", quality)
      : createGeneratedCharacter(scene, character!, "preview-character", { quality, pose: "STANDING" });
    root.getChildMeshes().forEach((mesh) => shadows.addShadowCaster(mesh));
    const floor = MeshBuilder.CreateCylinder("preview-plinth", { diameter: kart ? 4.4 : 2.7, height: .12, tessellation: 64 }, scene);
    floor.position.y = -.08;
    floor.receiveShadows = true;
    const floorMaterial = new PBRMaterial("preview-plinth-material", scene);
    floorMaterial.albedoColor = Color3.FromHexString("#17151d");
    floorMaterial.roughness = .86;
    floor.material = floorMaterial;
    const rim = MeshBuilder.CreateTorus("preview-ring", { diameter: kart ? 4 : 2.45, thickness: .025, tessellation: 72 }, scene);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = .01;
    const rimMaterial = new PBRMaterial("preview-ring-material", scene);
    rimMaterial.albedoColor = Color3.FromHexString("#ff3da6");
    rimMaterial.emissiveColor = Color3.FromHexString("#ff3da6").scale(.5);
    rim.material = rimMaterial;
    const start = performance.now();
    engine.runRenderLoop(() => {
      const time = (performance.now() - start) / 1000;
      if (character) animateGeneratedCharacter(root, time, character.personality);
      root.rotation.y += .0025;
      scene.render();
    });
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); scene.dispose(); engine.dispose(); };
  }, [character, kart, quality]);

  return <canvas ref={canvasRef} className={`factory-preview ${className}`} aria-label={kart ? "Vista 3D del kart" : "Vista 3D del personaje"} />;
}
