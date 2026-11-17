'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { supabase } from '@/lib/store';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(kind: 'in' | 'up' | 'link') {
    if (!supabase) return;
    setBusy(true); setMsg('');
    const redirect = typeof window !== 'undefined' ? window.location.origin : undefined;
    const r = kind === 'in' ? await supabase.auth.signInWithPassword({ email, password: pw })
      : kind === 'up' ? await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: redirect } })
      : await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    setBusy(false);
    if (r.error) { setMsg(r.error.message); return; }
    if (kind === 'in' || (kind === 'up' && r.data.session)) { router.push('/'); return; }
    setMsg(kind === 'link' ? 'Check your email for a sign-in link.' : 'Account created. Check your email to confirm, then sign in.');
  }
  return (
    <>
      <Nav />
      <main className="page" style={{ maxWidth: 420 }}>
        <div className="card grid">
          <h1>Sign in</h1>
          <p className="small dim">Signing in syncs sessions, the leaderboard and progress across devices, and unlocks the AI coach and pitch judge.</p>
          <label className="f">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label className="f">Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && go('in')} /></label>
          <div className="row">
            <button className="primary" disabled={busy || !email || !pw} onClick={() => go('in')}>Sign in</button>
            <button disabled={busy || !email || pw.length < 6} onClick={() => go('up')}>Create account</button>
            <button className="ghost" disabled={busy || !email} onClick={() => go('link')}>Email me a link</button>
          </div>
          {msg && <p className="note small">{msg}</p>}
        </div>
      </main>
    </>
  );
}
