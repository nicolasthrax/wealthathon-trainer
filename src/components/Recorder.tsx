'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtClock } from '@/lib/format';

// Minimal typing for the (prefixed) Web Speech API.
type SR = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const getSR = (): (new () => SR) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export const speechAvailable = () => !!getSR();

/**
 * Mic recorder with countdown and live transcript (Web Speech API). When live transcription is not available,
 * the audio is still uploaded and the worker transcribes it (whisper.cpp).
 */
export function Recorder({ seconds, label, onDone }: { seconds: number; label: string; onDone: (r: { blob: Blob; transcript: string; durationSec: number }) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'done'>('idle');
  const [left, setLeft] = useState(seconds);
  const [finalText, setFinal] = useState('');
  const [interim, setInterim] = useState('');
  const [err, setErr] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const sr = useRef<SR | null>(null);
  const chunks = useRef<Blob[]>([]);
  const t0 = useRef(0);
  const finalRef = useRef('');
  const running = useRef(false);

  useEffect(() => () => { running.current = false; sr.current?.stop(); if (rec.current?.state === 'recording') rec.current.stop(); }, []);

  async function start() {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
        setState('done');
        onDone({ blob, transcript: finalRef.current.trim(), durationSec: Math.round((performance.now() - t0.current) / 1000) });
      };
      mr.start(1000);
      rec.current = mr;
      const Ctor = getSR();
      if (Ctor) {
        const s = new Ctor();
        s.continuous = true; s.interimResults = true; s.lang = 'en-US';
        s.onresult = (e) => {
          let inter = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) { finalRef.current += r[0].transcript + ' '; setFinal(finalRef.current); } else inter += r[0].transcript;
          }
          setInterim(inter);
        };
        s.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setErr(`Live transcript: ${e.error} (audio is still recorded)`); };
        s.onend = () => { if (running.current) try { s.start(); } catch { /* already started */ } }; // Chrome stops after silences
        s.start();
        sr.current = s;
      }
      running.current = true;
      t0.current = performance.now();
      setState('rec');
      const iv = setInterval(() => {
        const l = seconds - (performance.now() - t0.current) / 1000;
        setLeft(l);
        if (l <= 0 || !running.current) { clearInterval(iv); stop(); }
      }, 250);
    } catch (e) { setErr(`Microphone unavailable: ${(e as Error).message}`); }
  }
  function stop() {
    running.current = false;
    sr.current?.stop();
    if (rec.current?.state === 'recording') rec.current.stop();
  }

  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="row">
        {state === 'idle' && <button className="primary" onClick={start}>● {label}</button>}
        {state === 'rec' && <button onClick={stop} style={{ borderColor: 'var(--down)', color: 'var(--down)' }}>■ Stop &amp; submit</button>}
        <span className={`num ${left < 30 && state === 'rec' ? 'amber' : ''}`} style={{ fontSize: 22, fontWeight: 700 }}>{fmtClock(left)}</span>
        {state === 'rec' && <span className="small"><span className="dot off" style={{ animation: 'pulse 1s infinite' }} />Recording</span>}
        {!speechAvailable() && <span className="small dim">No live transcript in this browser (use Chrome or Safari). Your Mac worker will transcribe the audio.</span>}
      </div>
      {(finalText || interim) && <div className="card small" style={{ background: 'var(--panel2)', maxHeight: 220, overflowY: 'auto' }}>{finalText}<span className="dim">{interim}</span></div>}
      {err && <p className="note small">{err}</p>}
    </div>
  );
}
