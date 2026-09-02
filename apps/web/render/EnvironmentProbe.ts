import { Color3, CubeTexture, Scene } from "@babylonjs/core";

/**
 * PROCEDURAL ENVIRONMENT (IBL).
 *
 * This is the single highest-leverage fix from the audit. Every material in V4 was a `PBRMaterial`
 * with no `environmentTexture` bound anywhere in the project. A PBR shader with nothing to reflect
 * cannot distinguish metal from plastic from fabric — the specular term has no source — so all
 * fifteen material classes in the art bible would have looked identical no matter how carefully
 * their roughness and metallic values were set.
 *
 * Rather than ship an `.env` file, the six cube faces are painted on a canvas at startup from the
 * theme's own palette: sky above, floor colour below, a bright key blob where the key light is, and
 * a scattering of dimmer practicals. Metal then has a horizon to reflect and a highlight to catch,
 * and clearcoat on kart paint has something to sit on.
 *
 * Mipmaps stand in for a prefiltered radiance chain. It is an approximation, but the difference
 * between an approximate environment and no environment is the difference between a painted kart
 * and a flat silhouette.
 */

export type EnvironmentPalette = {
  /** Upper hemisphere colour, roughly the ceiling or sky of the space. */
  sky: string;
  /** Lower hemisphere colour, taken from the floor material so bounce reads correctly. */
  ground: string;
  /** Horizon band. Usually between the two, warmer indoors. */
  horizon: string;
  /** Colour of the dominant light source reflected in the environment. */
  key: string;
  /** Practical lights: strip lights, screens, neon. Each is a soft blob. */
  practicals: readonly string[];
  /** Overall brightness multiplier. */
  intensity: number;
};

const FACE_SIZE = 128;

/** Face order Babylon expects: +X, +Y, +Z, -X, -Y, -Z. */
type FaceIndex = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Direction of the centre of each face, used to decide how much sky, ground and key light it sees.
 * Painting per-face from a direction keeps the six images consistent at their seams.
 */
const FACE_UP: Record<FaceIndex, number> = { 0: 0, 1: 1, 2: 0, 3: 0, 4: -1, 5: 0 };

function paintFace(face: FaceIndex, palette: EnvironmentPalette): string {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_SIZE;
  canvas.height = FACE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return "";

  const sky = Color3.FromHexString(palette.sky).scale(palette.intensity);
  const ground = Color3.FromHexString(palette.ground).scale(palette.intensity);
  const horizon = Color3.FromHexString(palette.horizon).scale(palette.intensity);
  const up = FACE_UP[face];

  const css = (color: Color3): string => {
    const to255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));
    return `rgb(${to255(color.r)},${to255(color.g)},${to255(color.b)})`;
  };

  if (up === 1) {
    // Ceiling: flat sky with a soft bright centre where the key light comes from.
    context.fillStyle = css(sky);
    context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
    const key = Color3.FromHexString(palette.key).scale(palette.intensity * 2.4);
    const glow = context.createRadialGradient(FACE_SIZE * 0.38, FACE_SIZE * 0.42, 0, FACE_SIZE * 0.38, FACE_SIZE * 0.42, FACE_SIZE * 0.5);
    glow.addColorStop(0, css(key));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  } else if (up === -1) {
    // Floor: flat ground colour, slightly darker toward the edges.
    context.fillStyle = css(ground);
    context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
    const falloff = context.createRadialGradient(FACE_SIZE / 2, FACE_SIZE / 2, FACE_SIZE * 0.2, FACE_SIZE / 2, FACE_SIZE / 2, FACE_SIZE * 0.72);
    falloff.addColorStop(0, "rgba(0,0,0,0)");
    falloff.addColorStop(1, "rgba(0,0,0,0.35)");
    context.fillStyle = falloff;
    context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  } else {
    // Side faces: a vertical gradient through sky, horizon and ground. The horizon line is what a
    // curved metal surface reflects, and it is what makes chrome read as chrome.
    const gradient = context.createLinearGradient(0, 0, 0, FACE_SIZE);
    gradient.addColorStop(0, css(sky));
    gradient.addColorStop(0.46, css(horizon));
    gradient.addColorStop(0.54, css(horizon.scale(0.82)));
    gradient.addColorStop(1, css(ground));
    context.fillStyle = gradient;
    context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);

    // Practical lights sit just above the horizon, spread deterministically across the four walls
    // so every face gets some and the reflections differ by direction.
    palette.practicals.forEach((hex, index) => {
      const light = Color3.FromHexString(hex).scale(palette.intensity * 1.9);
      const slot = index * 4 + face;
      const x = ((slot * 37) % 100) / 100 * FACE_SIZE;
      const y = FACE_SIZE * (0.3 + (((slot * 17) % 30) / 100));
      const radius = FACE_SIZE * (0.1 + (((slot * 13) % 12) / 100));
      const blob = context.createRadialGradient(x, y, 0, x, y, radius);
      blob.addColorStop(0, css(light));
      blob.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = blob;
      context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
    });
  }

  return canvas.toDataURL("image/png");
}

/**
 * Builds the cube texture and binds it as the scene environment.
 * Returns null when there is no DOM to paint on, in which case materials fall back to their
 * ambient floor rather than failing.
 */
export function createEnvironment(scene: Scene, palette: EnvironmentPalette): CubeTexture | null {
  if (typeof document === "undefined") return null;

  const faces: string[] = [];
  for (let face = 0; face < 6; face += 1) {
    const url = paintFace(face as FaceIndex, palette);
    if (!url) return null;
    faces.push(url);
  }

  // Data URLs resolve without a network round trip, so this does not add a loading step.
  const texture = CubeTexture.CreateFromImages(faces, scene, false);
  texture.name = "procedural-environment";
  texture.gammaSpace = true;
  scene.environmentTexture = texture;
  // Materials multiply by this; the lighting rig then modulates it per zone.
  scene.environmentIntensity = 0.85;
  return texture;
}

/**
 * Environment palettes per theme, derived from the art bible's world palettes so the reflections
 * agree with the lighting rig rather than fighting it.
 */
export const ThemeEnvironments: Record<string, EnvironmentPalette> = {
  FLAGSHIP: {
    sky: "#e8dfd0",
    ground: "#6e6259",
    horizon: "#d9c3a4",
    key: "#ffd9a8",
    practicals: ["#fff0d4", "#ff3da6", "#65d8ff"],
    intensity: 1,
  },
  WAREHOUSE: {
    sky: "#c4d4e2",
    ground: "#4a4e54",
    horizon: "#8a97a4",
    key: "#f0f4ff",
    practicals: ["#ffffff", "#ffc02e", "#3e6e9e"],
    intensity: 1.05,
  },
  PRINT_FACTORY: {
    sky: "#5a5670",
    ground: "#2b2732",
    horizon: "#6a5a80",
    key: "#e8ecff",
    practicals: ["#8f5cff", "#ff6b2c", "#65d8ff", "#ffd43b"],
    intensity: 0.92,
  },
  OFFICE: {
    sky: "#f2f4f8",
    ground: "#8c8378",
    horizon: "#ded8cc",
    key: "#fff4e0",
    practicals: ["#ffffff", "#65d8ff", "#4c7a4e"],
    intensity: 1.1,
  },
  MANGA: {
    sky: "#241d3c",
    ground: "#252036",
    horizon: "#3c2a58",
    key: "#ffffff",
    practicals: ["#ff3da6", "#8f5cff", "#65d8ff", "#ffd43b"],
    intensity: 0.8,
  },
  GREYBOX: {
    sky: "#cdd6e0",
    ground: "#4a4f57",
    horizon: "#9aa4b0",
    key: "#ffffff",
    practicals: ["#ffffff"],
    intensity: 1,
  },
};

export function environmentForTheme(theme: string): EnvironmentPalette {
  return ThemeEnvironments[theme] ?? ThemeEnvironments.FLAGSHIP!;
}
