# author\*

a quiet place to write — together.

**author\*** is a small, open-source collaborative writing app: a calm serif page
with live multiplayer editing, an editor you can ask things of, comments,
versions, and one-click publishing. A modern interpretation of the word
processor — for anyone who writes, whether that's tweets, letters to your
landlord, or the novel.

Live at **[author.computer](https://author.computer)**.

```
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ghost writing · live cursors · ⌘K rewrites · checks · titles
  comments · versions · publishing · profiles · .md import
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## how it works

- **just start writing** — no account needed. the landing page drops you
  straight into a draft as a ghost. you get the full editor, live
  collaboration, and one model request on the house. creating an account
  (just an email and a password) carries everything you wrote with you —
  five model requests a month are free, membership lifts the limit.
- **live collaboration** — Yjs CRDTs over WebSockets; share a writing link
  and whoever opens it lands in the draft with you, named cursors and all
- **an editor on call** — *ask* streams feedback on the draft, *checks*
  returns clickable proofreading issues, *titles* offers eight on demand,
  and **⌘K** rewrites any selection to instruction
- **formatting** — select text for the floating toolbar (bold, italic,
  underline, strike, code, headings, quotes, links), or type markdown and
  watch it convert; the usual ⌘B/⌘I/⌘U shortcuts all work
- **pages** — header images (any format — the browser recompresses),
  comments in the margin, named versions with one-click restore,
  publishing to a quiet read-only page at `/p/<slug>`
- **profiles** — an optional public page at `/u/<handle>` with your social
  links, a six-month writing contribution chart, and whichever published
  pieces you choose to list (each page has its own toggle)
- **import** — bring your writing with you: every `.md` file becomes its
  own draft, titles from `# headings`, links and formatting intact

## running it

```sh
npm install
cp .env.example .env       # add your Anthropic API key
npm run build              # builds the client into dist/
npm start                  # serves everything on http://localhost:3001
```

Two dev accounts are seeded on first run (**ink** / **quill**, password
**author**). Open the same draft in two windows to see live editing.

### production notes

- deploys anywhere a container runs (`Dockerfile`); `fly.toml` included —
  mount a volume at `/app/data` so the database and images persist
- required in production: `BETTER_AUTH_SECRET` (random 32+ bytes) and
  `BETTER_AUTH_URL` (your origin) — the server refuses to boot without them
- model spend is tiered: ghosts get one request, free accounts get
  `AI_FREE_MONTHLY` (default 5) per month, members get `AI_DAILY_CAP`
  (default 150) per day, and the whole site stops at
  `AI_GLOBAL_DAILY_CAP` (default 1000) per day. flip membership with
  `node scripts/set-member.mjs <handle> on`

## stack

| layer   | choice                                                            |
| ------- | ----------------------------------------------------------------- |
| editor  | [Tiptap](https://tiptap.dev) (ProseMirror) + React + Vite          |
| collab  | [Yjs](https://yjs.dev) — custom y-websocket server (`server/collab.js`) |
| auth    | [Better Auth](https://better-auth.com) — cookie sessions, anonymous ghosts, username + email login |
| server  | Express + `ws` + better-sqlite3 (single file DB in `data/`)        |
| editor brain | Anthropic API (`claude-opus-4-8`), server-side only, never in the browser |
| analytics | [Seline](https://seline.com) — cookie-free page views + product events; editor URLs are masked client-side |

## contributing

Contributions welcome — issues, PRs, wild ideas. Useful things to know:

- `scripts/collab-test.mjs <cookieA> <cookieB> <docId>` smoke-tests
  two-client live sync; `scripts/import-test.mjs <cookie>` exercises the
  markdown import pipeline; both run against any server via
  `AUTHOR_BASE` / `AUTHOR_WS_URL`
- security posture: bcrypt passwords, origin-checked mutations and
  websockets, sanitized public HTML, magic-byte-validated uploads,
  rate-limited credential endpoints — read the git history for the
  review trail
- keep the design quiet: whitespace over chrome, ascii accents over icons,
  serif for prose, mono for furniture.

## license

[MIT](LICENSE)
