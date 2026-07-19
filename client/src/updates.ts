// The public changelog. One entry per day, written for readers with zero
// context. Every line passes one filter: is this genuinely important for a
// user to know? Heads carry the change; a text follows only when the head
// alone doesn't say enough. No metaphors, no process, no meta.

export type UpdateBlock =
  | { kind: 'p'; text: string }
  | { kind: 'bullet'; head: string; text?: string }
  | { kind: 'aside'; text: string }

export type UpdateDay = { date: string; title: string; blocks: UpdateBlock[] }

export const UPDATES: UpdateDay[] = [
  {
    date: 'july 19, 2026',
    title: 'the letterbox, first readers, rss, dark mode',
    blocks: [
      {
        kind: 'bullet',
        head: 'the letterbox',
        text: 'open it in settings and readers can leave their email on your published pages and profile. [ ✉ post ] sends a published piece to every confirmed address — free accounts hold 25 addresses with 200 letters a month, members 1,000 and 5,000.',
      },
      {
        kind: 'bullet',
        head: 'first readers',
        text: 'keep a circle of trusted readers in settings. [ ✉ send ] in a draft’s share popover puts it on all their desks at once, for comments and suggested edits.',
      },
      {
        kind: 'bullet',
        head: 'rss',
        text: 'public profiles have a feed at /u/handle/feed.xml — the pieces you list, readable in any feed reader.',
      },
      {
        kind: 'bullet',
        head: 'dark mode',
        text: 'the ☾ in the bottom-left corner switches it. first visit follows your system setting; your choice sticks in this browser. works signed out too, including on published pages.',
      },
    ],
  },
  {
    date: 'july 18, 2026',
    title: 'curate your profile on the profile itself',
    blocks: [
      {
        kind: 'bullet',
        head: 'pick profile pieces on the profile page',
        text: 'the checkbox list in settings is gone. open /u/yourname to see your profile as visitors do — unlisted pieces appear faded with a [ list ] button, listed ones have an ✗.',
      },
      {
        kind: 'bullet',
        head: 'your profile opens for you while it’s still private',
      },
    ],
  },
  {
    date: 'july 17, 2026',
    title: 'page history, unread marks, comment-only links',
    blocks: [
      {
        kind: 'bullet',
        head: 'every page has a history',
        text: 'a history tab shows who commented, suggested, wrote, or saved a version. click a writing session to see exactly what changed.',
      },
      {
        kind: 'bullet',
        head: 'unread marks on your pages',
        text: 'your home page marks what arrived on each page since you last opened it.',
      },
      {
        kind: 'bullet',
        head: 'comment-only sharing',
        text: 'a new share link lets people read and comment but not edit.',
      },
      {
        kind: 'bullet',
        head: 'suggestions resolve as accepted or dismissed, by name',
      },
      {
        kind: 'bullet',
        head: 'download any page as markdown, html, or plain text',
      },
    ],
  },
  {
    date: 'july 14, 2026',
    title: 'faster loading',
    blocks: [
      {
        kind: 'bullet',
        head: 'first load after an idle period now takes under a second, down from 5–10',
      },
    ],
  },
  {
    date: 'july 9, 2026',
    title: 'paste anything, plus fixes',
    blocks: [
      {
        kind: 'bullet',
        head: 'pasted text keeps its formatting',
        text: 'paste from a chat app, notes app, or .md file and you get real headings and bold instead of raw # and ** symbols.',
      },
      {
        kind: 'bullet',
        head: 'images are now backed up off-site, like your text',
      },
      {
        kind: 'bullet',
        head: 'fixed',
        text: 'suggested edits no longer duplicate or delete surrounding text, only people who can edit a page can resolve its comments, and failed AI requests no longer count against your monthly limit.',
      },
    ],
  },
  {
    date: 'july 8, 2026',
    title: 'comment replies',
    blocks: [
      {
        kind: 'bullet',
        head: 'reply to comments',
        text: 'threads now support replies — write back and forth as long as needed.',
      },
    ],
  },
  {
    date: 'july 7, 2026',
    title: 'pick your proofreading checks',
    blocks: [
      {
        kind: 'bullet',
        head: 'proofreading, your way',
        text: 'choose what to check for — grammar, clarity, clichés, hedging, or a check you write yourself. each fix applies with one click.',
      },
      {
        kind: 'bullet',
        head: 'automatic versions',
        text: 'a version is saved after five quiet minutes, or every ten minutes of continuous writing.',
      },
    ],
  },
  {
    date: 'july 3, 2026',
    title: 'share without signup',
    blocks: [
      {
        kind: 'bullet',
        head: 'no account needed to collaborate',
        text: 'anyone with your draft link can write, comment, and suggest edits — they just enter a name.',
      },
    ],
  },
  {
    date: 'july 2, 2026',
    title: 'images, embeds, and suggested edits',
    blocks: [
      {
        kind: 'bullet',
        head: 'suggested edits',
        text: 'select text to leave a comment or suggest a specific edit. “apply edit” inserts the reviewer’s exact words — no AI involved.',
      },
      {
        kind: 'bullet',
        head: 'paste a youtube, vimeo, loom, spotify, or twitter link and it becomes a player',
      },
      {
        kind: 'bullet',
        head: 'paste or drag images straight into the page',
      },
    ],
  },
  {
    date: 'july 1, 2026',
    title: 'author* launches',
    blocks: [
      {
        kind: 'bullet',
        head: 'live collaborative writing',
        text: 'shared editing with named cursors, ⌘K rewrites, margin comments, version history, and one-click publishing.',
      },
      {
        kind: 'bullet',
        head: 'sign up with an email — or write without an account at all',
      },
      {
        kind: 'bullet',
        head: 'public profiles at /u/yourname',
      },
    ],
  },
]
