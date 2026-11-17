import { spawn } from 'node:child_process';

/**
 * Run a prompt through the local Claude Code CLI in headless mode (`claude -p`), on your Claude subscription.
 * ANTHROPIC_API_KEY is removed from the child environment so the CLI never falls back to paid API billing.
 */
export async function runClaude(prompt: string, opts: { system?: string; timeoutMs?: number } = {}): Promise<string> {
  const bin = process.env.CLAUDE_BIN || 'claude';
  const args = ['-p', '--output-format', 'json', '--max-turns', '1', '--tools', ''];
  if (process.env.WORKER_MODEL) args.push('--model', process.env.WORKER_MODEL);
  if (opts.system) args.push('--system-prompt', opts.system);
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('claude timed out')); }, opts.timeoutMs ?? 6 * 60_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`could not start "${bin}": ${e.message}. Is Claude Code installed and logged in?`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error || j.subtype?.startsWith('error')) return reject(new Error(`claude error: ${j.result ?? j.subtype}`));
        resolve(String(j.result ?? ''));
      } catch {
        reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 400)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Pull the first JSON object/array out of a model reply (tolerates ```json fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in reply');
  const open = src[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in reply');
}

/** Ask for JSON, validate with `parse`, and retry once with the validation error as feedback. */
export async function claudeJson<T>(prompt: string, parse: (x: unknown) => T, opts: { system?: string; retries?: number } = {}): Promise<T> {
  let p = prompt, lastErr: unknown;
  for (let i = 0; i <= (opts.retries ?? 1); i++) {
    const reply = await runClaude(p, opts);
    try { return parse(extractJson(reply)); } catch (e) {
      lastErr = e;
      p = `${prompt}\n\nYour previous reply was invalid: ${(e as Error).message.slice(0, 1500)}\nReply again with ONLY the corrected JSON.`;
    }
  }
  throw lastErr;
}
