# author\*

a quiet place to write — together.

**author\*** is a small, open-source collaborative writing app: a calm serif page
with live multiplayer editing, an editor you can ask things of, comments,
versions, and one-click publishing. A modern interpretation of the word
processor — for anyone who writes, whether that's tweets, letters to your
landlord, or the novel.

```
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  live cursors · ⌘K rewrites · checks · title ideas · comments
  versions · read-only publishing · shared drafts by link
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## features

- **live collaboration** — Yjs CRDTs over WebSockets; share a doc link and
  write together with named cursors, no refresh, no conflicts
- **ask** — stream feedback on your draft, or ask it a question
- **⌘K commands** — select text, hit ⌘K: improve, shorten, expand, fix
  grammar, or any instruction you type; preview then replace/insert
- **checks** — a proofread that returns clickable issues (spelling, grammar,
  repetition, clichés, clarity)
- **title ideas** — eight titles, one click to take one
- **comments** — select text, leave a note; resolvable threads in the margin
- **versions** — named snapshots, one-click restore
- **publishing** — flip a draft public at `/p/<slug>`, read-only

## running it

```sh
npm install
cp .env.example .env       # add your Anthropic API key
npm run build              # builds the client into dist/
npm start                  # serves everything on http://localhost:3001
```

Two test accounts are seeded on first run: **ink** and **quill**, password
**author**. Open the same draft in two windows to see live editing.

## stack

| layer   | choice                                                        |
| ------- | ------------------------------------------------------------- |
| editor  | [Tiptap](https://tiptap.dev) (ProseMirror) + React + Vite      |
| collab  | [Yjs](https://yjs.dev) — custom y-websocket server (`server/collab.js`) |
| server  | Express + `ws` + better-sqlite3 (single file DB in `data/`)    |
| editor  | Anthropic API (`claude-opus-4-8`), server-side only            |

## contributing

Contributions welcome — issues, PRs, wild ideas. Some honest notes about the
current state:

- **auth is throwaway.** Plaintext seeded accounts, bearer tokens in
  localStorage. Real auth (passkeys? magic links?) is the most-wanted PR.
- `scripts/collab-test.mjs <tokenA> <tokenB> <docId>` smoke-tests two-client
  live sync against a running server without a browser.
- keep the design quiet: whitespace over chrome, ascii accents over icons,
  serif for prose, mono for furniture.

## license

[MIT](LICENSE)
