"use client";

import { useEffect, useRef } from "react";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  Vector3,
} from "@babylonjs/core";
import { createKart } from "@/game/createKart";

export function MenuScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true, preserveDrawingBuffer: false });
    engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.4));
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.035, 0.03, 0.045, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.012;
    scene.fogColor = new Color3(0.04, 0.03, 0.05);

    const camera = new ArcRotateCamera("menu-camera", -0.7, 1.12, 17, new Vector3(3, 1.4, 0), scene);
    camera.fov = 0.72;
    camera.lowerRadiusLimit = 13;
    camera.upperRadiusLimit = 21;
    camera.attachControl(canvas, false);
    camera.inputs.clear();

    const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.92;
    ambient.diffuse = Color3.FromHexString("#d7d6ff");
    ambient.groundColor = Color3.FromHexString("#241525");
    const key = new DirectionalLight("key", new Vector3(-.5, -1, .3), scene);
    key.position.set(10, 14, -8);
    key.intensity = 4;
    key.diffuse = Color3.FromHexString("#ff72bd");
    const shadows = new ShadowGenerator(1024, key);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 18;

    const groundMaterial = new PBRMaterial("menu-ground", scene);
    groundMaterial.albedoColor = new Color3(.055, .05, .065);
    groundMaterial.roughness = .88;
    const ground = MeshBuilder.CreateGround("ground", { width: 38, height: 28 }, scene);
    ground.material = groundMaterial;
    ground.receiveShadows = true;

    for (let index = -5; index <= 5; index += 1) {
      const stripe = MeshBuilder.CreateBox(`stripe-${index}`, { width: .7, height: .035, depth: 24 }, scene);
      stripe.position.set(index * 3.8, .02, 0);
      stripe.rotation.y = -.32;
      const stripeMaterial = new PBRMaterial(`stripe-mat-${index}`, scene);
      stripeMaterial.albedoColor = index % 2 ? Color3.FromHexString("#17131a") : Color3.FromHexString("#201622");
      stripeMaterial.roughness = 1;
      stripe.material = stripeMaterial;
    }

    const kart = createKart(scene, "hero-kart", {
      body: Color3.FromHexString("#ff3da6"),
      accent: Color3.FromHexString("#b9ff45"),
      shirt: Color3.FromHexString("#f7f2e8"),
      skin: Color3.FromHexString("#d99b72"),
    });
    kart.position.set(3.5, .08, 0);
    kart.rotation.y = -0.56;
    kart.scaling.scaleInPlace(1.28);
    kart.getChildMeshes().forEach((mesh) => shadows.addShadowCaster(mesh));

    const archMaterial = new PBRMaterial("arch", scene);
    archMaterial.albedoColor = Color3.FromHexString("#17141b");
    archMaterial.roughness = .8;
    for (let index = 0; index < 5; index += 1) {
      const beam = MeshBuilder.CreateBox(`beam-${index}`, { width: .32, height: 8 + index * .4, depth: .32 }, scene);
      beam.position.set(10 + index * 3.2, 4, -5 + index * 1.5);
      beam.rotation.z = -.12;
      beam.material = archMaterial;
    }

    let time = 0;
    engine.runRenderLoop(() => {
      time += engine.getDeltaTime() / 1000;
      kart.position.y = .08 + Math.sin(time * 1.8) * .045;
      kart.rotation.y = -.56 + Math.sin(time * .32) * .08;
      camera.alpha = -.7 + Math.sin(time * .18) * .04;
      scene.render();
    });
    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      scene.dispose();
      engine.dispose();
    };
  }, []);

  return <canvas className="menu-scene" ref={canvasRef} aria-hidden="true" />;
}
