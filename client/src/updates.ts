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
    date: 'july 9, 2026',
    title: 'a day spent reading our own handwriting',
    blocks: [
      {
        kind: 'bullet',
        head: 'markdown arrives as markdown',
        text: 'paste a report and it lands wearing its shape — headings, bold, rules — instead of its own punctuation. anything that still comes in as a block of code now has a door back to prose.',
      },
      {
        kind: 'bullet',
        head: 'your pictures are kept too',
        text: 'images now ride to the backup beside the words, so a page restored from a bad day comes back whole.',
      },
      {
        kind: 'bullet',
        head: 'a cursor belongs to its writer',
        text: 'lose your connection and your cursor waits for you; no one else can wear it while you are gone.',
      },
      {
        kind: 'bullet',
        head: 'edits land where they are meant',
        text: 'incorporating a proof no longer doubles a line, applying a suggestion keeps the passage whole, and only a writer on the page may settle its threads.',
      },
      {
        kind: 'bullet',
        head: 'nothing is lost quietly',
        text: 'deleting a page no longer leaves a collaborator writing into the void, and a page that fails to open can be healed by restoring a version — never overwritten blank.',
      },
      {
        kind: 'bullet',
        head: 'the counts tell the truth',
        text: 'a ✎ request that never answered costs you nothing, the chart fills with your own pen alone, and your profile lists what it says it lists.',
      },
      {
        kind: 'aside',
        text: 'under the floorboards: twenty-two faults found by a small army of readers — each confirmed by two skeptics before it was mended, and checked by two more after. locks tightened on the sign-up and password doors along the way.',
      },
    ],
  },
  {
    date: 'july 8, 2026',
    title: 'threads become conversations',
    blocks: [
      {
        kind: 'bullet',
        head: 'reply is the answer',
        text: 'threads now lead with ↩ reply — write back as long as the talk takes. resolving is the quiet button beside it.',
      },
      {
        kind: 'bullet',
        head: '“✽ written twice” calms down',
        text: 'the note appears only when two pens truly rework the same paragraph — commenting, resolving, and rearranging no longer count.',
      },
      {
        kind: 'aside',
        text: 'under the floorboards: a pressure test now walks two make-believe writers through every collision before the note ships.',
      },
    ],
  },
  {
    date: 'july 7, 2026',
    title: 'the page keeps itself',
    blocks: [
      {
        kind: 'bullet',
        head: 'the proof reads for what you pick',
        text: 'checks became proof: choose exactly what the pen reads for — grammar, clarity, clichés, hedging, or a check in your own words — instead of everything at once. every fix is one click from incorporated. the titles tab retired; share copy tightened.',
      },
      {
        kind: 'bullet',
        head: 'comments point both ways',
        text: 'clicking the glyph in the margin now lights up the comment it points at in the sidebar. comment cards always open where you can see them, and a thread takes as many replies as the conversation needs.',
      },
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
