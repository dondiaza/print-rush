import type { Metadata, Viewport } from "next";
import "./globals.css";
// The game screens, kept apart from the tool screens. See the header of the file for why.
import "./game-ui.css";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

export const metadata: Metadata = {
  title: "Print Rush — Arcade Racing",
  description: "Arcade racing through a giant screen-printing universe.",
  applicationName: "Print Rush",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b0f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}<ServiceWorkerRegistration /></body>
    </html>
  );
}
