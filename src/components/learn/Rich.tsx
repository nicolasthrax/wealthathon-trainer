'use client';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { GLOSSARY } from '@config/learn/glossary';

/** A glossary term: dotted underline, definition on hover (desktop) or tap (touch). */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const g = GLOSSARY[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (!g) return <>{children}</>;
  return (
    <span ref={ref} className={`term-g${open ? ' open' : ''}`} tabIndex={0} role="button" aria-label={`${g.term}: ${g.def}`}
      onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onKeyDown={(e) => { if (e.key === 'Enter') setOpen((o) => !o); if (e.key === 'Escape') setOpen(false); }}>
      {children ?? g.term}
      <span className="term-tip" role="tooltip"><b>{g.term}</b> {g.def}</span>
    </span>
  );
}

/** Inline form of a glossary term: lower-case common words, keep names and acronyms. */
function inlineTerm(id: string): string {
  const t = GLOSSARY[id]?.term ?? id;
  return /^[A-Z][A-Z&]|^(Sortino|Fed|HKD|HIBOR|HKMA)/.test(t) ? t.replace(/ \(.*\)$/, '') : t.charAt(0).toLowerCase() + t.slice(1).replace(/ \(.*\)$/, '');
}

/** Tiny markup for authored lesson text: **bold** and [[term]] / [[term|shown text]] glossary links. */
export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={k++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] !== undefined) parts.push(<b key={k++}><Rich text={m[1]} /></b>);
    else parts.push(<Term key={k++} id={m[2]}>{m[3] ?? inlineTerm(m[2])}</Term>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
