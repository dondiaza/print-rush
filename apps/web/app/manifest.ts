import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Print Rush",
    short_name: "Print Rush",
    description: "Arcade racing in a screen-printing universe.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#ff3da6",
    orientation: "landscape",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
