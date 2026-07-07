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
    date: 'july 7, 2026',
    title: 'the page keeps itself',
    blocks: [
      {
        kind: 'bullet',
        head: 'versions save themselves',
        text: 'five quiet minutes after your last change — or every ten of unbroken writing — a version is kept automatically, listed by its date and time. hover any version to peek inside before restoring.',
      },
    ],
  },
  {
    date: 'july 3, 2026',
    title: 'the door opens for readers',
    blocks: [
      {
        kind: 'bullet',
        head: 'a name is enough',
        text: 'send someone your draft link and they can write with you, leave notes, and suggest edits — no signup, no password, just a name at the door. sharing works without an account on either end.',
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
        text: 'paste a youtube, vimeo, loom, spotify, or tweet link on its own line and it becomes a player.',
      },
      {
        kind: 'bullet',
        head: 'images',
        text: 'paste or drag one straight into your writing and it lands where you dropped it.',
      },
      {
        kind: 'bullet',
        head: 'truer publishing',
        text: 'headings keep their size and the “· · ·” divider carries over to the published page.',
      },
      {
        kind: 'bullet',
        head: 'profiles, rearranged',
        text: 'name, links, chart, then pages — and hovering an article floats a preview card.',
      },
      {
        kind: 'bullet',
        head: 'comments & suggested edits',
        text: 'select any text to ☞ leave a note or ↳ write the edit yourself (⌥⌘M) — and “apply edit” swaps in the reviewer’s exact words, no model in between.',
      },
      {
        kind: 'bullet',
        head: 'versions',
        text: 'a second writer joining saves the text as-it-was, restoring keeps your current text as its own version first, and twice-rewritten paragraphs wear a “✽ written twice” note.',
      },
      {
        kind: 'bullet',
        head: 'this page, day by day',
        text: 'the updates page reads as one entry per day, and links to it unfurl with a card.',
      },
      {
        kind: 'aside',
        text: 'under the floorboards: continuous backups to separate storage, restorable in minutes — and the site moved to the west coast.',
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
        text: 'live multiplayer editing with named cursors, ⌘K rewrites and feedback, margin comments, versions, and one-click publishing.',
      },
      {
        kind: 'bullet',
        head: 'the doors open',
        text: 'invite codes retired; a desk costs an email and a password, and ghosts can write with no account at all.',
      },
      {
        kind: 'bullet',
        head: 'a place of your own',
        text: 'public profiles at /u/you with contribution charts, social links, header images — and .md import, formatting intact.',
      },
      {
        kind: 'bullet',
        head: 'small kindnesses',
        text: 'the formatting bubble, click anywhere to start typing, ⌘U underlines, and a chart in your own timezone.',
      },
      {
        kind: 'bullet',
        head: 'locks on the doors',
        text: 'hashed passwords, rate-limited sign-in, expiring sessions, cookie-free analytics.',
      },
      { kind: 'aside', text: 'and by nightfall, a home at author.computer.' },
    ],
  },
]
