'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { useStore, type PitchRow } from '@/lib/store';

export default function PitchList() {
  const { store, ready } = useStore();
  const router = useRouter();
  const [rows, setRows] = useState<PitchRow[]>([]);
  useEffect(() => { if (ready) store.listPitches().then(setRows).catch(() => {}); }, [store, ready]);
  return (
    <>
      <Nav />
      <main className="page grid" style={{ maxWidth: 900 }}>
        <h1>Pitch mode · Grand Final practice</h1>
        <p className="dim">Defend a strategy to a BOCHK senior wealth-management judge: a {Math.round(300 / 60)}-minute spoken pitch, then 3-5 tough follow-up questions answered by voice. The judge checks what you say against what you actually traded.</p>
        {store.kind === 'local' && <p className="note info">Sign in to use pitch mode (audio is stored in your private Supabase bucket and judged by your Mac worker).</p>}
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <div><b>From a finished session</b><div className="small dim">Open any debrief and click &ldquo;Defend your strategy&rdquo;. Recommended: the judge has your real trades.</div></div>
          <Link href="/leaderboard"><button>Pick a session</button></Link>
        </div>
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <div><b>Standalone</b><div className="small dim">You get a random client brief and pitch an allocation for them from scratch.</div></div>
          <button disabled={store.kind === 'local'} onClick={() => router.push('/pitch/new')}>Start standalone pitch</button>
        </div>
        <div className="card">
          <h2>Past pitches</h2>
          <table className="t small"><tbody>
            {rows.map((p) => <tr key={p.id}><td><Link href={`/pitch/${p.id}`}>{(p.context as { title?: string } | null)?.title ?? 'Pitch'}</Link></td><td>{p.status}</td>
              <td className="r num">{p.scorecard ? `${p.scorecard.overall.toFixed(0)}/100` : ''}</td><td className="r dim">{new Date(p.created_at).toLocaleString()}</td></tr>)}
            {!rows.length && <tr><td className="dim">No pitches yet.</td></tr>}
          </tbody></table>
        </div>
      </main>
    </>
  );
}
