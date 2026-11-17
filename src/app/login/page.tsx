'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/store';

interface Account { display_name: string; email: string }

/** Pick your name, enter your password. No email to type; you stay signed in on this device. */
export default function Login() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [who, setWho] = useState<Account | null>(null);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace('/'); });
    supabase.rpc('login_accounts').then(({ data, error }) => {
      if (error) setMsg(error.message);
      const list = (data ?? []) as Account[];
      setAccounts(list);
      try { const last = localStorage.getItem('wt:lastLogin'); const a = list.find((x) => x.email === last); if (a) setWho(a); } catch { /* ignore */ }
    });
  }, [router]);
  useEffect(() => { if (who) pwRef.current?.focus(); }, [who]);

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    if (!supabase || !who) return;
    setBusy(true); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: who.email, password: pw });
    setBusy(false);
    if (error) { setMsg(error.message === 'Invalid login credentials' ? 'Wrong password.' : error.message); return; }
    try { localStorage.setItem('wt:lastLogin', who.email); } catch { /* ignore */ }
    router.replace('/');
  }

  return (
    <main className="page" style={{ maxWidth: 420, paddingTop: '12vh' }}>
      <div className="card grid" style={{ gap: 14 }}>
        <div><span className="brand" style={{ color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.04em' }}>WEALTHATHON TRAINER</span>
          <h1 style={{ marginTop: 6 }}>Who&apos;s playing?</h1></div>
        <div className="row">
          {accounts === null && <span className="dim small">Loading…</span>}
          {accounts?.map((a) => (
            <button key={a.email} className={who?.email === a.email ? 'primary' : ''} style={{ flex: 1, padding: '14px 0', fontSize: 16 }} onClick={() => { setWho(a); setMsg(''); }}>{a.display_name}</button>
          ))}
        </div>
        {who && (
          <form onSubmit={signIn} className="grid" style={{ gap: 10 }}>
            {/* Hidden username field lets the browser's password manager remember and autofill the password. */}
            <input type="text" name="username" autoComplete="username" value={who.email} readOnly hidden />
            <label className="f">Password for {who.display_name}
              <input ref={pwRef} type="password" name="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
            <button className="primary" disabled={busy || !pw}>Sign in</button>
          </form>
        )}
        {msg && <p className="note small">{msg}</p>}
        <p className="small dim" style={{ margin: 0 }}>Private app for two players. You stay signed in on this device; change your password in Settings.</p>
      </div>
    </main>
  );
}
