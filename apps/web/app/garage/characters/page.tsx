import Link from "next/link";
import { CharacterStudioLibrary } from "@/components/CharacterStudioLibrary";

/**
 * The Character Studio page.
 *
 * Dynamic, because everything on it comes from the database at request time. The rest of the game
 * is still statically exported and served from the CDN — only this page and the character API need
 * a server, which is the smallest footprint the feature can have.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Personajes · Print Rush",
  description: "Crea y guarda pilotos con tu propia cara, y llévalos a cualquier carrera.",
};

export default function CharactersPage() {
  return (
    <main className="assets-shell">
      <header className="studio-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">PR</span>
          <span>PRINT RUSH</span>
        </Link>
        <nav>
          <Link href="/garage/characters">PERSONAJES</Link>
          <Link href="/garage/kart">KART</Link>
          <Link href="/factory/track">CIRCUITO</Link>
        </nav>
      </header>

      <section className="assets-head">
        <div>
          <span>CHARACTER STUDIO</span>
          <h1>
            CREA UN
            <br />
            <i>PILOTO.</i>
          </h1>
        </div>
        <p>
          Nombre, una foto y a correr. Los personajes se guardan en el servidor con su apariencia y
          su rostro adaptado al juego, así que siguen existiendo mañana, en otro navegador y en otro
          dispositivo.
        </p>
      </section>

      <CharacterStudioLibrary />
    </main>
  );
}
