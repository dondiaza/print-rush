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
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { CharacterAppearance } from "@print-rush/character-core";
import { animateCharacter, buildCharacter, type CharacterVisual } from "@/render/CharacterBuilder";
import { toDefinition } from "@/characters/bridge";

/**
 * THE EDITOR VIEWPORT.
 *
 * One scene for the life of the editor. The engine, camera, lights, shadow map and plinth are built
 * once and never touched again; only the character node is rebuilt when the appearance changes.
 *
 * That distinction is the brief's requirement — *"el personaje debe mantenerse renderizado mientras
 * se cambia ropa, colores, accesorios"* — and it is not a micro-optimisation. Rebuilding the scene
 * per change means a black flash, a lost camera angle and a dropped shadow map on every click, which
 * is the difference between an editor that feels like a tool and one that feels like a page reload.
 *
 * Rebuilds are also coalesced. Dragging a proportion slider fires dozens of changes a second, and a
 * mesh rebuild per event would drop the frame rate to nothing; a short trailing delay means the drag
 * is smooth and the model catches up the moment the hand stops.
 */

export type CharacterPreviewProps = {
  appearance: CharacterAppearance;
  name: string;
  /** The styled face texture's URL, or null for the generated face. */
  faceTextureUrl?: string | null;
  className?: string;
};

/**
 * How long to wait before rebuilding, in milliseconds.
 *
 * Long enough that a slider drag coalesces into one rebuild, short enough that a click on a jacket
 * feels immediate. Below about 60 ms the coalescing stops working; above about 150 ms the tool starts
 * to feel laggy.
 */
const REBUILD_DELAY = 90;

export function CharacterPreview({ appearance, name, faceTextureUrl, className = "" }: CharacterPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const shadowRef = useRef<ShadowGenerator | null>(null);
  const holderRef = useRef<TransformNode | null>(null);
  const visualRef = useRef<CharacterVisual | null>(null);
  const faceRef = useRef<{ url: string; texture: Texture } | null>(null);
  const spinRef = useRef(0);

  // ------------------------------------------------------------------ the scene, once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, adaptToDeviceRatio: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.03, 0.028, 0.04, 1);
    scene.ambientColor = new Color3(0.2, 0.2, 0.26);

    const camera = new ArcRotateCamera("editor-camera", -Math.PI / 2, Math.PI / 2.35, 3.4, new Vector3(0, 0.95, 0), scene);
    // Bounded: a viewport a person can spin but not get lost in. The brief asks for limited zoom.
    camera.lowerRadiusLimit = 2.1;
    camera.upperRadiusLimit = 5.4;
    camera.lowerBetaLimit = 0.7;
    camera.upperBetaLimit = Math.PI / 1.85;
    camera.wheelPrecision = 46;
    camera.pinchPrecision = 80;
    camera.attachControl(canvas, true);

    new HemisphericLight("editor-fill", new Vector3(0, 1, 0), scene).intensity = 1.15;
    const key = new DirectionalLight("editor-key", new Vector3(-0.55, -1, 0.6), scene);
    key.position.set(3.4, 6, -4);
    key.intensity = 2.2;
    const shadows = new ShadowGenerator(1024, key);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 22;
    shadowRef.current = shadows;

    // The plinth, so the character stands on something and casts a shadow onto it.
    const plinth = MeshBuilder.CreateCylinder("editor-plinth", { diameter: 2.4, height: 0.1, tessellation: 64 }, scene);
    plinth.position.y = -0.05;
    plinth.receiveShadows = true;
    const plinthMaterial = new PBRMaterial("editor-plinth-material", scene);
    plinthMaterial.albedoColor = Color3.FromHexString("#17151d");
    plinthMaterial.roughness = 0.84;
    plinth.material = plinthMaterial;

    const ring = MeshBuilder.CreateTorus("editor-ring", { diameter: 2.2, thickness: 0.02, tessellation: 80 }, scene);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    const ringMaterial = new PBRMaterial("editor-ring-material", scene);
    ringMaterial.albedoColor = Color3.FromHexString("#ff3da6");
    ringMaterial.emissiveColor = Color3.FromHexString("#ff3da6").scale(0.55);
    ring.material = ringMaterial;

    // The holder the character hangs from, so a rebuild swaps children without touching the scene.
    const holder = new TransformNode("editor-holder", scene);
    holderRef.current = holder;
    sceneRef.current = scene;

    const start = performance.now();
    engine.runRenderLoop(() => {
      const time = (performance.now() - start) / 1000;
      if (visualRef.current) {
        // Idle only: a slow turn plus the blink clock. The editor is for looking at a character, so
        // a driving pose would hide the clothes it exists to show.
        animateCharacter(visualRef.current, { steer: Math.sin(time * 0.4) * 0.12, lean: 0, time });
      }
      spinRef.current += 0.0022;
      holder.rotation.y = spinRef.current;
      scene.render();
    });

    const resize = (): void => engine.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      faceRef.current?.texture.dispose();
      faceRef.current = null;
      visualRef.current = null;
      holderRef.current = null;
      shadowRef.current = null;
      sceneRef.current = null;
      scene.dispose();
      engine.dispose();
    };
  }, []);

  // ----------------------------------------------------- the character, on every change
  useEffect(() => {
    const scene = sceneRef.current;
    const holder = holderRef.current;
    if (!scene || !holder) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || !sceneRef.current) return;

      /**
       * The face texture is cached by URL.
       *
       * Rebuilds happen on every wardrobe click, and re-downloading the portrait each time would
       * make the editor flicker and hammer the media route. It is disposed only when the URL
       * actually changes or the editor closes.
       */
      if (faceTextureUrl && faceRef.current?.url !== faceTextureUrl) {
        faceRef.current?.texture.dispose();
        const texture = new Texture(faceTextureUrl, scene, false, undefined, Texture.TRILINEAR_SAMPLINGMODE);
        texture.hasAlpha = true;
        faceRef.current = { url: faceTextureUrl, texture };
      } else if (!faceTextureUrl && faceRef.current) {
        faceRef.current.texture.dispose();
        faceRef.current = null;
      }

      // Out with the old character, in with the new — and nothing else in the scene moves.
      for (const child of holder.getChildren()) child.dispose(false, true);

      const visual = buildCharacter(scene, toDefinition({ id: "editor", name, appearance }), "editor-character", {
        pose: "STANDING",
        quality: "HIGH",
        ...(faceRef.current ? { faceTexture: faceRef.current.texture } : {}),
      });
      visual.root.parent = holder;
      visualRef.current = visual;
      for (const mesh of visual.root.getChildMeshes()) shadowRef.current?.addShadowCaster(mesh);
    }, REBUILD_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [appearance, name, faceTextureUrl]);

  return (
    <canvas
      ref={canvasRef}
      className={`character-preview ${className}`}
      aria-label={`Vista 3D de ${name}. Arrastra para girar.`}
    />
  );
}
