import Link from "next/link";
import { CharacterEditor } from "@/components/CharacterEditor";

/**
 * The editor page.
 *
 * `params` is a promise in Next 16, and awaiting it here keeps the client component free of routing
 * concerns — it receives an id and nothing else.
 */
export const dynamic = "force-dynamic";

export default async function CharacterEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="assets-shell">
      <header className="studio-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">PR</span>
          <span>PRINT RUSH</span>
        </Link>
        <nav>
          <Link href="/garage/characters">← PERSONAJES</Link>
          <Link href="/garage/kart">KART</Link>
          <Link href="/factory/track">CIRCUITO</Link>
        </nav>
      </header>
      <CharacterEditor characterId={id} />
    </main>
  );
}
