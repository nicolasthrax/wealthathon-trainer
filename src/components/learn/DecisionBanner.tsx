'use client';
import { useEffect, useRef, useState } from 'react';
import { Rich } from './Rich';

type SR = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null };

/** The paused-clock decision card shown over the terminal during a guided lesson. */
export function DecisionBanner({ index, total, prompt, timeLimitSec, startedAt, onDone }: {
  index: number; total: number; prompt: string; timeLimitSec?: number; startedAt: number; onDone: (why: string) => void;
}) {
  const [why, setWhy] = useState('');
  const [left, setLeft] = useState(timeLimitSec ?? 0);
  const [listening, setListening] = useState(false);
  const whyRef = useRef(why); whyRef.current = why;
  const done = useRef(false);
  const sr = useRef<SR | null>(null);
  const finish = () => { if (done.current) return; done.current = true; sr.current?.stop(); onDone(whyRef.current); };
  const finishRef = useRef(finish); finishRef.current = finish;

  useEffect(() => {
    if (!timeLimitSec) return;
    const iv = setInterval(() => {
      const l = timeLimitSec - (performance.now() - startedAt) / 1000;
      setLeft(l);
      if (l <= 0) { clearInterval(iv); finishRef.current(); }
    }, 250);
    return () => clearInterval(iv);
  }, [timeLimitSec, startedAt]);

  const SpeechCtor = typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition) : undefined;
  const toggleMic = () => {
    if (listening) { sr.current?.stop(); return; }
    if (!SpeechCtor) return;
    const r = new SpeechCtor();
    r.continuous = false; r.interimResults = false; r.lang = 'en-GB';
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0].transcript).join(' '); setWhy((w) => (w ? `${w} ${t}` : t)); };
    r.onend = () => setListening(false);
    sr.current = r; r.start(); setListening(true);
  };

  return (
    <div className="lesson-banner" data-nohotkeys="" role="dialog" aria-label="Lesson decision">
      <div className="hd">
        <span>⏸ Decision {index + 1} of {total}</span>
        <span className="dim" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Clock stopped. Trade with the normal ticket, then continue.</span>
        <span style={{ flex: 1 }} />
        {timeLimitSec ? <span className={left < 8 ? 'down' : ''}>{Math.max(0, Math.ceil(left))}s</span> : <span className="dim">no timer</span>}
      </div>
      {timeLimitSec ? <div className="timer"><i style={{ width: `${Math.max(0, (left / timeLimitSec) * 100)}%` }} /></div> : null}
      <div style={{ fontSize: 14 }}><Rich text={prompt} /></div>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why? One line: which driver, which assets, which way (e.g. &quot;rates up → long bonds fall&quot;)" aria-label="Why" />
        {SpeechCtor && <button onClick={toggleMic} title="Say it instead of typing" aria-label="Dictate" style={{ flex: 'none' }}>{listening ? '■' : '🎤'}</button>}
      </div>
      <div className="row">
        <span className="small dim">Tip: the news feed shows the headline; the Risk panel shows your limits.</span>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={finish}>Done: continue ▶</button>
      </div>
    </div>
  );
}
