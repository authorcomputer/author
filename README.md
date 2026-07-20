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
  ghost writing · live cursors · ⌘K rewrites · the proof
  comments · versions · publishing · profiles · .md import
  lamplight · the letterbox · rss · a door for machines
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## how it works

- **just start writing** — no account needed. the landing page drops you
  straight into a draft as a ghost. you get the full editor, live
  collaboration, and one model request on the house. creating an account
  (just an email and a password) carries everything you wrote with you —
  five model requests a month are free, membership lifts the limit.
  `/new` is the shortest way in: it always opens a fresh draft.
- **live collaboration** — Yjs CRDTs over WebSockets; share a writing link
  and whoever opens it lands in the draft with you, named cursors and all
- **an editor on call** — *ask* streams feedback on the draft, the *proof*
  reads for exactly the checks you pick (grammar, clarity, clichés,
  hedging, your own…) with every issue clickable, and **⌘K** rewrites any
  selection to instruction
- **formatting** — select text for the floating toolbar (bold, italic,
  underline, strike, code, headings, quotes, links), or type markdown and
  watch it convert; the usual ⌘B/⌘I/⌘U shortcuts all work
- **pages** — header images (any format — the browser recompresses),
  comments in the margin worn as real highlighter ink
  ([highlighte.rs](https://highlighte.rs)), named versions with one-click
  restore, a history of writing sittings each one click from its diff,
  publishing to a quiet read-only page at `/p/<slug>`
- **the letterbox** — open the slot and readers of your published pages
  can leave an email address; `[ ✉ post ]` mails a piece to every
  confirmed address, once, with one-click unsubscribe. postage is metered
  per writer and the post office has a ceiling it won't spend past
- **profiles** — an optional public page at `/u/<handle>` with your social
  links, a six-month writing contribution chart, whichever published
  pieces you choose to list (each page has its own toggle), and an rss
  feed at `/u/<handle>/feed.xml`
- **lamplight** — a ☾ in every page's corner turns the paper warm-dark
  for anyone, ghost or passerby; the OS preference speaks first and the
  choice survives reload
- **a door for machines** — an MCP server at `/mcp`: mint a key in
  settings and Claude (or any MCP client) can sit at your desk,
  read-mostly — list and read drafts, read the margins, start new pages,
  never a pen in a live room. keys are shown once, hashed at rest,
  revocable always
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
- backups: with `BUCKET_NAME` + `AWS_*` secrets set (on Fly: `fly storage
  create`), litestream continuously replicates the database to S3-compatible
  storage and restores it automatically onto an empty volume; without them
  the entrypoint warns that replication is off. images ride to the same
  bucket beside the words, best-effort, and a restored volume pulls them
  back down
- the post office needs `RESEND_API_KEY` (and optionally `EMAIL_FROM`) to
  send real letters; without a key every send is a dry run that logs.
  letter volume and letterbox sizes have their own dials —
  `EMAILS_FREE_MONTHLY`, `EMAILS_MEMBER_MONTHLY`, `EMAILS_GLOBAL_DAILY`,
  `SUBSCRIBERS_FREE_MAX`, `SUBSCRIBERS_MEMBER_MAX`
- ship with `npm run deploy` — snapshots the volume, builds, deploys, and
  verifies prod serves the new bundle
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
| post    | [Resend](https://resend.com) — confirmation letters + posted pieces; every send is a logged dry run without a key |
| margin ink | [@highlighters/core](https://highlighte.rs) — comment marks and live selections as chisel-tip strokes |
| machines | [MCP](https://modelcontextprotocol.io) over streamable HTTP at `/mcp` (`server/mcp.js`) |
| analytics | [Seline](https://seline.com) — cookie-free page views + product events; editor URLs are masked client-side |

## contributing

Contributions welcome — issues, PRs, wild ideas. Useful things to know:

- a shelf of suites lives in `scripts/*-test.mjs` — collab sync, imports,
  the letterbox, mcp, rss, image backups, versions, diffs, and more — all
  runnable against any server via `AUTHOR_BASE` / `AUTHOR_WS_URL`
- security posture: bcrypt passwords, origin-checked mutations and
  websockets, sanitized public HTML, magic-byte-validated uploads,
  rate-limited credential endpoints — read the git history for the
  review trail
- keep the design quiet: whitespace over chrome, ascii accents over icons,
  serif for prose, mono for furniture.

## license

[MIT](LICENSE)
