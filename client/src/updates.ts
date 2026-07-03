// The public changelog. Curated from the actual commit history — one entry
// per day, telling the story of what that day brought. Internal plumbing
// (build config, CI fixes) is folded in where it matters.
//
// Each day is a small composition: an opening line, ✽ bullets for the
// things themselves, and an aside for what happened under the floorboards.

export type UpdateBlock =
  | { kind: 'p'; text: string }
  | { kind: 'bullet'; head: string; text: string }
  | { kind: 'aside'; text: string }

export type UpdateDay = { date: string; title: string; blocks: UpdateBlock[] }

export const UPDATES: UpdateDay[] = [
  {
    date: 'july 3, 2026',
    title: 'the door opens for readers',
    blocks: [
      {
        kind: 'p',
        text: 'you could always start writing here without an account. now the people you write for can answer the same way.',
      },
      {
        kind: 'bullet',
        head: 'a name is enough',
        text: 'send someone your draft link and they land at a small door: leave a name, step inside. no signup, no password — they can write with you, leave notes on any passage, and suggest edits you can apply with one click, all signed with the name they gave.',
      },
      {
        kind: 'bullet',
        head: 'their name, everywhere it matters',
        text: 'the name at the door follows them through the page — on their live cursor, in the margin, on every note and suggested edit. and if they later take a desk, the page and everything they left on it come along.',
      },
      {
        kind: 'bullet',
        head: 'sharing, account or not',
        text: 'the share button now shows for ghosts too — so a piece written without an account can still go out for notes. the loop needs no signup on either end.',
      },
      {
        kind: 'aside',
        text: 'under the floorboards: a pen name can’t wear the handle of someone with a desk here, and only a page’s owner can publish it — small locks on a door that’s now open wider.',
      },
    ],
  },
  {
    date: 'july 2, 2026',
    title: 'the page grows richer',
    blocks: [
      { kind: 'p', text: 'the page learned to hold more than words today.' },
      {
        kind: 'bullet',
        head: 'embeds',
        text: 'paste a youtube, vimeo, loom, spotify, or tweet link on its own line and it becomes a player — in the editor and on the published page.',
      },
      {
        kind: 'bullet',
        head: 'images',
        text: 'paste or drag one straight into your writing. it uploads quietly and lands where you dropped it.',
      },
      {
        kind: 'bullet',
        head: 'truer publishing',
        text: 'headings keep their size and the “· · ·” divider carries over, so the published piece looks like the one you wrote.',
      },
      {
        kind: 'bullet',
        head: 'profiles, rearranged',
        text: 'top to bottom now — name, links, your writing chart, then your pages. hovering an article floats a preview card in the margin.',
      },
      {
        kind: 'bullet',
        head: 'comments, front and center',
        text: 'select any text and a small card floats right there — ☞ leave a note, or ↳ write the edit yourself (⌥⌘M). replies thread underneath, commented lines wear their marks in the gutter, and clicking a passage lights up its card in the margin.',
      },
      {
        kind: 'bullet',
        head: 'edits you can take at their word',
        text: 'a suggested edit shows as the struck original over the proposed line, and “apply edit” swaps in the reviewer’s exact words — no model in between, ever.',
      },
      {
        kind: 'bullet',
        head: 'a version as company arrives',
        text: 'the moment a second writer joins your page, the text as-it-was is kept quietly in versions — and paragraphs two pens rewrote at once wear a small “✽ written twice” note until someone writes there again.',
      },
      {
        kind: 'bullet',
        head: 'versions you can lean on',
        text: 'restoring now keeps your current text as its own version first — never a one-way door — and the whole loop (save, restore, sync, survive a reload) sits under a real test.',
      },
      {
        kind: 'bullet',
        head: 'this page, day by day',
        text: 'the updates page reads as one entry per day now, and links to it unfurl with their own card.',
      },
      {
        kind: 'aside',
        text: 'under the floorboards: the writing backs up continuously to separate storage, restorable onto fresh hardware in minutes. the site moved to the west coast along the way.',
      },
    ],
  },
  {
    date: 'july 1, 2026',
    title: 'author* opens its doors',
    blocks: [
      { kind: 'p', text: 'born in the morning, open to the public by evening.' },
      {
        kind: 'bullet',
        head: 'the first word',
        text: 'live multiplayer editing with named cursors, an editor you can ask things of — feedback, checks, titles, ⌘K rewrites — comments in the margin, versions, and one-click publishing.',
      },
      {
        kind: 'bullet',
        head: 'the doors open',
        text: 'invite codes retired; a desk costs an email and a password. ghosts welcome too — write with no account at all, and it all comes with you if you take a desk later.',
      },
      {
        kind: 'bullet',
        head: 'a place of your own',
        text: 'public profiles at /u/you with contribution charts, social links, header images — and .md import that turns your old word processor’s files into pages, formatting intact.',
      },
      {
        kind: 'bullet',
        head: 'small kindnesses',
        text: 'the formatting bubble (bold, italic, links, a shortcut into ⌘K), click anywhere to start typing, ⌘U underlines, and a chart that keeps your own timezone.',
      },
      {
        kind: 'bullet',
        head: 'locks on the doors',
        text: 'hashed passwords, rate-limited sign-in, expiring sessions — and cookie-free analytics that never follow you home.',
      },
      { kind: 'aside', text: 'and by nightfall, a home at author.computer.' },
    ],
  },
]
