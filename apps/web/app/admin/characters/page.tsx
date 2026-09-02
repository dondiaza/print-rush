import Link from "next/link";
import { CharacterAdmin } from "@/components/CharacterAdmin";

/**
 * Character administration.
 *
 * Dynamic, like everything that reads the database. It lives under `/admin` beside the performance
 * dashboard rather than inside the garage, because it is an operator's tool and not part of the
 * flow a player walks through.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Administración de personajes · Print Rush",
};

export default function AdminCharactersPage() {
  return (
    <main className="assets-shell">
      <header className="studio-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">PR</span>
          <span>PRINT RUSH</span>
        </Link>
        <nav>
          <Link href="/garage/characters">PERSONAJES</Link>
          <Link href="/admin/performance">RENDIMIENTO</Link>
        </nav>
      </header>

      <section className="assets-head">
        <div>
          <span>ADMINISTRACIÓN</span>
          <h1>
            EL REGISTRO
            <br />
            <i>DE PILOTOS.</i>
          </h1>
        </div>
        <p>
          Todos los personajes con su dueño, su estado y el de su fotografía. Desde aquí se
          desactivan, se restauran, se regenera un rostro o se mandan a la papelera.
        </p>
      </section>

      <CharacterAdmin />
    </main>
  );
}
