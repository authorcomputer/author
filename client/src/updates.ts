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
    title: 'paste anything, and a long list of repairs',
    blocks: [
      {
        kind: 'p',
        text: 'mostly a day of mending things you should never have had to think about.',
      },
      {
        kind: 'bullet',
        head: 'paste a document, keep its shape',
        text: 'copy a draft out of a chat, a notes app, or a .md file and it now arrives as writing — real headings, bold, dividers — instead of a wall of #, **, and ---. if something still lands as one grey block of code, select it and press the code button to turn it back into prose.',
      },
      {
        kind: 'bullet',
        head: 'images are backed up now',
        text: 'your words were always copied to safe storage every second. your pictures were not — a lost disk would have returned the writing without them. now both travel together.',
      },
      {
        kind: 'bullet',
        head: 'fixed',
        text: 'anyone signed in could resolve a comment on someone else’s page. a suggested edit could duplicate a line or swallow the words around it. losing wifi for a moment could erase your cursor from everyone else’s screen. a ⌘K request that failed still spent one of your monthly requests. deleting a page could throw away edits a collaborator was still typing. the checkboxes on your profile showed the wrong answer, and the first click hid the piece you meant to show.',
      },
      {
        kind: 'aside',
        text: 'under the floorboards: twenty-two faults, each confirmed by two skeptics before it was mended and checked by two more after — plus sturdier locks on the sign-up and password doors.',
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
