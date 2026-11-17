'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase, useStore, type Profile } from '@/lib/store';
import { leavePresence, usePresence, whereLabel } from '@/lib/presence';

const LINKS = [
  ['/', 'Practice'], ['/leaderboard', 'Leaderboard'], ['/progress', 'Progress'], ['/pitch', 'Pitch'], ['/settings', 'Settings'],
] as const;

export function Nav() {
  const path = usePathname();
  const { store, user } = useStore();
  const [online, setOnline] = useState<boolean | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => { if (user) store.listProfiles().then(setProfiles).catch(() => {}); }, [store, user]);
  const myName = profiles.find((p) => p.id === user?.id)?.display_name ?? undefined;
  const here = usePresence(user?.id, myName, whereLabel(path));
  const others = profiles.filter((p) => p.id !== user?.id);
  useEffect(() => {
    let stop = false;
    const f = () => store.workerOnline().then((o) => !stop && setOnline(o)).catch(() => {});
    f();
    const iv = setInterval(f, 30000);
    return () => { stop = true; clearInterval(iv); };
  }, [store]);
  return (
    <nav className="nav">
      <span className="brand">WEALTHATHON TRAINER</span>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'on' : ''}>{label}</Link>
      ))}
      <span className="sp" />
      {others.map((p) => {
        const o = here.find((u) => u.userId === p.id);
        return (
          <span key={p.id} className="small dim" title={o ? `${p.display_name} is ${o.where}` : `${p.display_name} is offline`}>
            <span className={`dot ${o ? 'on' : ''}`} />{p.display_name}{o ? <span style={{ opacity: 0.7 }}> · {o.where}</span> : <span style={{ opacity: 0.7 }}> · offline</span>}
          </span>
        );
      })}
      <span className="small dim" title="AI worker on your Mac (scenario generator, coach, pitch judge)">
        <span className={`dot ${online ? 'on' : online === false ? 'off' : ''}`} />
        {store.kind === 'local' ? 'Offline mode' : online ? 'AI worker online' : 'AI worker offline'}
      </span>
      {user ? (
        <span className="small dim">{myName ?? (user.email ?? '').replace(/@wealthathon\.invalid$/, '').replace(/^.+$/, (n) => (n.length <= 2 ? n.toUpperCase() : n[0].toUpperCase() + n.slice(1)))} · <a href="#" onClick={(e) => { e.preventDefault(); leavePresence(); void supabase?.auth.signOut(); }}>Sign out</a></span>
      ) : supabase ? <Link href="/login">Sign in</Link> : null}
    </nav>
  );
}
