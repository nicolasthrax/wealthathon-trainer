'use client';
import { use } from 'react';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { PlaybookDetail } from '@/components/learn/Playbook';
import { LESSONS, PLAYBOOK_BY_ID } from '@/lib/learn';

export default function PlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const p = PLAYBOOK_BY_ID[id];
  const l = p && LESSONS.find((x) => x.id === p.lessonId);
  return (
    <>
      <Nav />
      <main className="page grid" style={{ maxWidth: 760 }}>
        <div className="small"><Link href="/learn/playbooks">← All playbooks</Link></div>
        {!p ? <p className="note bad">Unknown playbook.</p> : (
          <div className="card">
            <div className="small dim">{p.kind === 'news' ? 'NEWS PLAYBOOK' : 'PROCESS PLAYBOOK'}</div>
            <h1 style={{ marginBottom: 12 }}>{p.name}</h1>
            <PlaybookDetail p={p} />
            {l && <div className="row" style={{ marginTop: 14 }}><Link href={`/learn/${l.id}`}><button className="primary">Practise it: Lesson {l.n} ▶</button></Link></div>}
          </div>
        )}
      </main>
    </>
  );
}
