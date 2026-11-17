# Wealthathon AI worker (runs on your Mac)

All AI features run here, through **Claude Code in headless mode (`claude -p`) on your Claude subscription**. There is no Anthropic API key anywhere: the worker even removes `ANTHROPIC_API_KEY` from Claude's environment so it can never fall back to paid API billing.

| Job (`ai_jobs.type`) | Queued by | What it does |
|---|---|---|
| `generate_scenario` | the worker itself (pool top-up) | Claude writes a scenario as strict JSON → Zod schema → a second, blind Claude pass classifies each headline's sentiment → the code validator checks plausibility, direction vs sentiment, density vs difficulty and similarity to the pool. Up to 3 attempts, with the validator's errors fed back. |
| `generate_client` | the worker itself | Creates a client brief; rejected unless the constraints can all be satisfied (also under Hard mode's tighter caps). |
| `coach` | Debrief page | 3 mistakes (each with a first-principles mechanism), 3 strengths, 1 drill. Written into `debriefs.coach`. |
| `judge` | Pitch page | Transcribes audio if needed, then asks the next follow-up question (3-5 total) or writes the scorecard. |

The web app never waits for the worker: sessions draw from the pre-validated pool (seeded with 15 scenarios + 5 historical episodes). When your Mac is off, coach/judge jobs simply stay `queued` and the UI says so. They run as soon as the worker starts.

## One-time setup

1. Install and log in to Claude Code: `npm i -g @anthropic-ai/claude-code`, then run `claude` once and sign in with your Claude account.
2. In the repo root, create `.env.local` (never commit it):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://fdjzwksirelrrafxtcxt.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
   SUPABASE_SERVICE_ROLE_KEY=...   # Supabase dashboard → Project Settings → API keys → service_role / secret
   # Optional:
   WORKER_MODEL=claude-sonnet-5-5  # any model your plan includes; omit to use Claude Code's default
   ```
   The service-role key bypasses row-level security, so it stays on your Mac only. Do not put it in Vercel.
3. `npm install`

## Run

```bash
npm run worker
```

You should see `realtime: SUBSCRIBED`, then the app's nav shows **AI worker online**. Test generation without the database:

```bash
npm run worker:dry -- medium
```

### Run in the background (launchd)

Edit the paths in `worker/com.wealthathon.worker.plist`, then:

```bash
cp worker/com.wealthathon.worker.plist ~/Library/LaunchAgents/
```

```bash
launchctl load -w ~/Library/LaunchAgents/com.wealthathon.worker.plist
```

Logs go to `worker/logs/worker.log`. Stop with `launchctl unload ~/Library/LaunchAgents/com.wealthathon.worker.plist`.

## Voice transcription fallback (optional)

Chrome and Safari give a live transcript in the browser, so the worker usually has nothing to transcribe. For browsers without the Web Speech API, install whisper.cpp:

```bash
brew install whisper-cpp ffmpeg
```

Download a model (e.g. `ggml-base.en.bin` from the whisper.cpp releases on Hugging Face) and add `WHISPER_MODEL=/path/to/ggml-base.en.bin` to `.env.local`. Without it, the judge works from what it has and notes the missing transcript.

## Pool settings

All in `config/event-rules.ts` → `pool`: `minSize` (unplayed synthetic scenarios kept ready), `mix` (difficulty split), `minClients`, heartbeat timing. The worker checks every 5 minutes and queues at most 6 generation jobs at a time. User jobs (coach, judge) always run first.

## Troubleshooting

- **"requires usage credits" / model errors**: set `WORKER_MODEL` to a model your plan includes.
- **Jobs stay `queued`**: is the worker running and showing `realtime: SUBSCRIBED`? Polling every 15s also picks jobs up.
- **A job failed**: it is retried up to 3 times. The error is stored in `ai_jobs.error` and shown in the UI with a Retry button.
