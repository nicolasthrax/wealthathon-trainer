'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase, useStore } from '@/lib/store';

const LINKS = [
  ['/', 'Practice'], ['/leaderboard', 'Leaderboard'], ['/progress', 'Progress'], ['/pitch', 'Pitch'], ['/settings', 'Settings'],
] as const;

export function Nav() {
  const path = usePathname();
  const { store, user } = useStore();
  const [online, setOnline] = useState<boolean | null>(null);
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
      <span className="small dim" title="AI worker on your Mac (scenario generator, coach, pitch judge)">
        <span className={`dot ${online ? 'on' : online === false ? 'off' : ''}`} />
        {store.kind === 'local' ? 'Offline mode' : online ? 'AI worker online' : 'AI worker offline'}
      </span>
      {user ? (
        <span className="small dim">{user.email} · <a href="#" onClick={(e) => { e.preventDefault(); void supabase?.auth.signOut(); }}>Sign out</a></span>
      ) : supabase ? <Link href="/login">Sign in</Link> : null}
    </nav>
  );
}
