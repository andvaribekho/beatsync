# BeatSync – agent quick reference

## Architecture
- Single Express app served via Vercel serverless functions.
- Entry: `server.js` → `api/index.js` (Express app with routes).
- Frontend is a **single monolithic file**: `public/index.html` — all HTML, CSS, and JS inlined (no bundler, no framework other than Three.js and JSZip from CDN).
- `converter.js` transforms Beat Saber `.dat` beatmaps into `Song1.js` format consumed by the frontend game/visualizer.

## Key gotchas

### Beat Saber timing: beats, not seconds
Beat Saber `.dat` stores `_time` in **musical beats**, not seconds. The converter must read BPM from `Info.dat` (`_beatsPerMinute`) and convert via `seconds = beats * 60 / BPM`. Never use `_time` as seconds directly or the song will appear ~2× longer than it is.

### Redoble / Zigzag
- `redoble` (ms): notes closer than this stay on the **same** lane.
- `zigzag` (ms): notes between redoble and zigzag land on **adjacent** lanes (alternating).
- `zigzag` must always be **greater** than `redoble`; both back and front validate this.

### form-data forwarding (Beat Sage API)
When forwarding form fields from the frontend to Beat Sage, use `.join(',')` for arrays (Beat Sage expects CSV), **not** just the first element. This applies to `difficulties`, `modes`, and `events`.

### Difficulty filtering on download
The download endpoint receives `?difficulties=...` to filter which `.dat` files get converted. `.dat` file names start with the difficulty name (e.g. `ExpertPlusExpert.dat`), matched via `getDifficultyFromName()`.

## Commands

| Task | Command |
|------|---------|
| Start locally | `node server.js` (or `npm start` / `npm run dev`) |
| Validate backend JS | `node -c api/index.js && node -c converter.js` |
| Validate inline frontend JS | `node -e "const fs=require('fs'); const h=fs.readFileSync('public/index.html','utf8'); new Function(h.match(/<script>([\s\S]*)<\/script>/)[1]); console.log('ok')"` |
| Deploy to Vercel | `vercel --prod` (must be linked first with `vercel link`) |

## Project structure

```
.
├── server.js           # Express static serving + SPA fallback
├── api/index.js        # API routes: POST /api/create, GET /api/heartbeat/:id, GET /api/download/:id
├── converter.js        # .dat → SongX_array.js conversion
├── public/index.html   # Entire UI + game engine + visualizer + editor (~2000 lines)
├── package.json        # Dependencies: express, formidable, node-fetch, form-data, adm-zip
└── vercel.json         # Rewrites: /api/(.*) → /api
```

## Frontend classes (all in `public/index.html` script tag)
- **`BeatmapVisualizer`** — 2D canvas beatmap viewer/editor with zoom, note selection/editing, undo (10-stack), reduction, slider
- **`RhythmHopGame`** — Three.js rhythm game with 5 lanes
- **`state`** (global object) — holds generated audio blob, original/accepted maps, ZIP blob
- **`visualizer`** — singleton instance created at script bottom (must exist before DOM event bindings reference it)

## No test suite, no linter
This project has no automated tests or lint config. Manual verification:
1. Syntax check backend files with `node -c`
2. Syntax check inline script with `new Function()`
3. Boot server locally with `node server.js` and verify HTML served
