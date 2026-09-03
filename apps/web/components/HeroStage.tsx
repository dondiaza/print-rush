"use client";

import { useEffect, useRef } from "react";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Scene,
  ShadowGenerator,
  Texture,
  Vector3,
} from "@babylonjs/core";
import type { CharacterDefinition, KartDefinition } from "@print-rush/3d-factory";
import { createGeneratedCharacter } from "@/factory/GeneratedCharacter";
import { createKart } from "@/game/createKart";

/**
 * THE HERO STAGE.
 *
 * What replaced `MenuScene`, and the difference is not cosmetic. That scene put a kart at
 * `x = 3.5` with the camera aimed at `(3, 1.4, 0)`, marked the canvas `aria-hidden`, and let the
 * headline sit on top of it: the 3D was wallpaper behind a landing page. The brief's complaint —
 * "nada debe quedar flotando sin jerarquía", "debe parecer la pantalla principal de un videojuego" —
 * is exactly that arrangement.
 *
 * So this is a *stage*, not a backdrop:
 *
 *  - The loadout is at the origin and the camera is aimed at it. It is the subject of the screen.
 *  - The driver **stands beside their kart** rather than sitting in it. A seated driver is mostly
 *    hidden by their own bodywork, and this screen exists to show the player the character they
 *    built — face, clothes, shoes and all.
 *  - It is **interactive**: drag to orbit, wheel or pinch to zoom. The brief asks for a character you
 *    can look at from the front, three-quarter, side and back, and this is where that happens for
 *    the loadout as a whole.
 *  - The lighting is a three-point studio rig, not the race's zone lighting. A key, a cool fill, a
 *    rim to separate the silhouette from the ground, and a warm kicker low at the front so faces are
 *    not lit from above like a police interview.
 *
 * It renders on demand rather than continuously when nothing is moving, which matters because this
 * screen is where a player sits idle: a menu that spins a GPU at 60 fps to animate a slow bob is a
 * laptop fan for no reason.
 */

type Props = {
  character: CharacterDefinition;
  kart: KartDefinition;
  /** The studio's styled face, so the menu shows the same head as the race. */
  faceTextureUrl: string | null;
  /** Paused while a modal or another screen is on top, so an unseen scene costs nothing. */
  active?: boolean;
};

/** Where the camera starts: three-quarter front, slightly above eye level. */
const START_ALPHA = -Math.PI / 2 - 0.72;
const START_BETA = 1.16;
const START_RADIUS = 7.4;

export function HeroStage({ character, kart, faceTextureUrl, active = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  // Mirrored in an effect rather than assigned during render. The render loop below reads this every
  // frame and must not be in the effect's dependency list — rebuilding the whole scene to pause it
  // would be absurd — so a ref is right; writing to it during render is what React forbids.
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: Engine;
    try {
      engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true, preserveDrawingBuffer: false });
    } catch (error) {
      // No WebGL: the home still works, it just has no stage. Failing here must not take the menu
      // down with it, which is why this is caught rather than thrown to the boundary.
      console.warn("[home] the hero stage could not start; the menu will render without it", error);
      return;
    }

    const mobile = window.matchMedia("(max-width: 820px)").matches;
    // Rendered a little under native on dense displays. A menu does not need every pixel, and this
    // is the cheapest place to buy back the headroom the studio lighting spends.
    engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / (mobile ? 1.2 : 1.5)));

    const scene = new Scene(engine);
    // Transparent: the CSS layers behind the canvas — gradient, grid, glow — are what give the screen
    // its depth, and painting an opaque colour here would hide them.
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.autoClear = true;

    const camera = new ArcRotateCamera("hero-camera", START_ALPHA, START_BETA, START_RADIUS, new Vector3(0, 1.02, 0), scene);
    camera.fov = 0.62;
    camera.minZ = 0.15;
    camera.maxZ = 60;
    camera.lowerRadiusLimit = 5.2;
    camera.upperRadiusLimit = 10.5;
    // Never below the podium and never straight down: both look like a mistake rather than a choice.
    camera.lowerBetaLimit = 0.72;
    camera.upperBetaLimit = 1.46;
    camera.wheelDeltaPercentage = 0.012;
    camera.pinchDeltaPercentage = 0.006;
    camera.panningSensibility = 0;
    camera.useNaturalPinchZoom = true;
    camera.attachControl(canvas, true);

    // ------------------------------------------------------------------ studio rig
    const ambient = new HemisphericLight("hero-ambient", new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.55;
    ambient.diffuse = Color3.FromHexString("#cfd8ff");
    ambient.groundColor = Color3.FromHexString("#3a2a3f");

    const key = new DirectionalLight("hero-key", new Vector3(-0.62, -1, 0.42), scene);
    key.position.set(6, 9, -5);
    key.intensity = 3.4;
    key.diffuse = Color3.FromHexString("#fff2e2");

    const fill = new DirectionalLight("hero-fill", new Vector3(0.85, -0.35, -0.4), scene);
    fill.intensity = 1.15;
    fill.diffuse = Color3.FromHexString("#7fb4ff");

    const rim = new DirectionalLight("hero-rim", new Vector3(0.15, -0.28, 1), scene);
    rim.intensity = 1.6;
    rim.diffuse = Color3.FromHexString("#ff6fc0");

    /**
     * A warm kicker low and in front.
     *
     * The one light that is here for faces specifically. A rig of three directionals from above
     * leaves eye sockets and the underside of a jaw in shadow, which on a stylised head reads as
     * grime rather than as form. A soft point light at chest height fills them without flattening.
     */
    const kicker = new PointLight("hero-kicker", new Vector3(0.4, 1.15, -2.6), scene);
    kicker.intensity = 3.2;
    kicker.diffuse = Color3.FromHexString("#ffd9b0");
    kicker.range = 9;

    const shadows = new ShadowGenerator(mobile ? 1024 : 2048, key);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 28;
    shadows.darkness = 0.36;

    // ------------------------------------------------------------------ podium
    const podium = MeshBuilder.CreateCylinder("hero-podium", { diameter: 4.6, height: 0.16, tessellation: 64 }, scene);
    podium.position.y = -0.08;
    podium.receiveShadows = true;
    const podiumMaterial = new PBRMaterial("hero-podium-mat", scene);
    podiumMaterial.albedoColor = Color3.FromHexString("#191622");
    podiumMaterial.roughness = 0.42;
    podiumMaterial.metallic = 0.15;
    podium.material = podiumMaterial;

    /**
     * A glow ring under the loadout.
     *
     * Unlit and emissive, so it reads as light on the floor rather than as a painted circle, and it
     * does the job a drop shadow does in a flat interface: it plants the subject on the stage instead
     * of leaving it floating, which is the exact complaint in the brief's list of prototype tells.
     */
    const ring = MeshBuilder.CreateTorus("hero-ring", { diameter: 4.42, thickness: 0.045, tessellation: 96 }, scene);
    ring.position.y = 0.012;
    const ringMaterial = new PBRMaterial("hero-ring-mat", scene);
    ringMaterial.albedoColor = Color3.Black();
    ringMaterial.emissiveColor = Color3.FromHexString("#ff3da6");
    ringMaterial.roughness = 1;
    ring.material = ringMaterial;

    // ------------------------------------------------------------------ the loadout
    const quality = mobile ? "MEDIUM" : "HIGH";
    const faceTexture = faceTextureUrl ? new Texture(faceTextureUrl, scene, { invertY: false }) : null;

    // The kart, empty: its driver stands next to it instead of sitting in it.
    const kartNode = createKart(scene, "hero-kart", {
      body: Color3.FromHexString(kart.primaryColor),
      accent: Color3.FromHexString(kart.secondaryColor),
      shirt: Color3.FromHexString("#f7f2e8"),
      skin: Color3.FromHexString("#d99b72"),
    }, false, { kart, quality });
    kartNode.position.set(0.86, 0.02, 0.1);
    kartNode.rotation.y = -0.42;
    kartNode.getChildMeshes().forEach((mesh) => shadows.addShadowCaster(mesh));

    const driver = createGeneratedCharacter(scene, character, "hero-driver", {
      pose: "STANDING",
      quality,
      ...(faceTexture ? { faceTexture } : {}),
    });
    driver.position.set(-1.02, 0, -0.16);
    // Turned a few degrees toward the camera, so the three-quarter start shows the face rather than
    // a profile. The player's own character is the thing this screen is for.
    driver.rotation.y = 0.34;
    driver.getChildMeshes().forEach((mesh) => {
      shadows.addShadowCaster(mesh);
      mesh.receiveShadows = false;
    });

    // ------------------------------------------------------------------ grade
    const pipeline = new DefaultRenderingPipeline("hero-pipeline", true, scene, [camera]);
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    pipeline.imageProcessing.exposure = 1.15;
    pipeline.imageProcessing.contrast = 1.02;
    pipeline.fxaaEnabled = true;
    pipeline.samples = mobile ? 1 : 4;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.72;
    pipeline.bloomWeight = 0.34;
    pipeline.bloomKernel = 34;

    // ------------------------------------------------------------------ idle motion
    let time = 0;
    let settling = 0;
    let previousAlpha = camera.alpha;
    const baseKartY = kartNode.position.y;

    engine.runRenderLoop(() => {
      /**
       * A guard around the whole frame.
       *
       * A throw inside a render loop escapes React entirely — no error boundary can see it — and
       * leaves the canvas frozen with the engine still burning a frame budget. Catching it here,
       * stopping the loop and logging is the only honest handling: the menu keeps working, and
       * whoever looks at the console gets the stack.
       */
      try {
        if (!activeRef.current) return;
        const dt = engine.getDeltaTime() / 1000;
        time += dt;

        // A slow bob and a breath of rotation, so the stage is alive without being busy.
        kartNode.position.y = baseKartY + Math.sin(time * 1.15) * 0.026;
        kartNode.rotation.y = -0.42 + Math.sin(time * 0.34) * 0.045;
        driver.position.y = Math.sin(time * 0.9 + 1.2) * 0.012;
        ringMaterial.emissiveColor = Color3.FromHexString("#ff3da6").scale(0.72 + Math.sin(time * 1.6) * 0.28);

        /**
         * Drifts back to the starting angle once the player lets go.
         *
         * Without this, one flick leaves the stage parked at whatever angle it landed on — often the
         * back of the character's head — for the rest of the session. Waiting a beat before easing
         * back is what keeps it from fighting the drag.
         */
        const dragging = Math.abs(camera.alpha - previousAlpha) > 0.0004;
        previousAlpha = camera.alpha;
        settling = dragging ? 0 : settling + dt;
        if (settling > 2.2) {
          const ease = 1 - Math.exp(-dt * 0.9);
          camera.alpha += (START_ALPHA - camera.alpha) * ease;
          camera.beta += (START_BETA - camera.beta) * ease;
          camera.radius += (START_RADIUS - camera.radius) * ease;
        }

        scene.render();
      } catch (error) {
        console.error("[home] the hero stage crashed mid-frame; stopping it", error);
        engine.stopRenderLoop();
      }
    });

    const resize = () => engine.resize();
    window.addEventListener("resize", resize);
    // Stops the loop entirely when the tab is hidden. `runRenderLoop` keeps ticking on a backgrounded
    // tab in some browsers, and a menu is precisely where a player leaves the tab open.
    const visibility = () => {
      if (document.hidden) engine.stopRenderLoop();
    };
    document.addEventListener("visibilitychange", visibility);

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      engine.stopRenderLoop();
      // Every mesh, material and texture this scene made goes with it. Without the dispose the
      // loadout leaks a full character and kart every time the player edits either one.
      pipeline.dispose();
      shadows.dispose();
      scene.dispose();
      engine.dispose();
    };
    // Rebuilt when the loadout changes: the meshes are generated from these definitions, so a new
    // character is a new mesh rather than a property to update.
  }, [character, kart, faceTextureUrl]);

  return (
    <div className="hero-stage">
      <canvas className="hero-stage__canvas" ref={canvasRef} />
      <p className="hero-stage__hint">ARRASTRA PARA GIRAR · RUEDA PARA ACERCAR</p>
    </div>
  );
}
