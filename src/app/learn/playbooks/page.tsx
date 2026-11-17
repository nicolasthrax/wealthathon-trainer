'use client';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Moves } from '@/components/learn/Playbook';
import { Rich } from '@/components/learn/Rich';
import { LESSONS, PLAYBOOKS } from '@/lib/learn';

export default function Playbooks() {
  const groups = [['news', 'News playbooks: react to a type of headline'], ['process', 'Process playbooks: how to size, protect and stay in the mandate']] as const;
  return (
    <>
      <Nav />
      <main className="page grid">
        <div className="small"><Link href="/learn">← Learn</Link></div>
        <h1>Playbooks</h1>
        {groups.map(([k, title]) => (
          <section key={k} className="card">
            <h2>{title}</h2>
            <table className="t">
              <tbody>
                {PLAYBOOKS.filter((p) => p.kind === k).map((p) => {
                  const l = LESSONS.find((x) => x.id === p.lessonId);
                  return (
                    <tr key={p.id}>
                      <td style={{ width: '26%' }}><Link href={`/learn/playbooks/${p.id}`}><b>{p.name}</b></Link>{l && <div className="small dim">Lesson {l.n}</div>}</td>
                      <td className="small"><Rich text={p.trigger} /></td>
                      <td style={{ width: '34%' }}><Moves moves={p.moves} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </main>
    </>
  );
}
