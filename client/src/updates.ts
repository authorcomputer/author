// The public changelog. Curated from the actual commit history — one entry
// per day. Written for readers with zero context: each bullet plainly
// states what changed and what it does, in a sentence or two. No metaphors,
// no internal process — if a user wouldn't notice it, it isn't listed.

export type UpdateBlock =
  | { kind: 'p'; text: string }
  | { kind: 'bullet'; head: string; text: string }
  | { kind: 'aside'; text: string }

export type UpdateDay = { date: string; title: string; blocks: UpdateBlock[] }

export const UPDATES: UpdateDay[] = [
  {
    date: 'july 18, 2026',
    title: 'curate your profile on the profile itself',
    blocks: [
      {
        kind: 'bullet',
        head: 'pick profile pieces on the profile page',
        text: 'the checkbox list in settings is gone. open /u/yourname and you see the page as visitors do — unlisted pieces appear faded with a [ list ] button, listed ones have an ✗ to remove them. the share menu toggle still works too.',
      },
      {
        kind: 'bullet',
        head: 'one switch fewer',
        text: 'the “list published pieces on profile” master switch is gone — each piece has its own toggle. if you had the switch off, your pieces were all unlisted once, so nothing you had hidden became visible.',
      },
      {
        kind: 'bullet',
        head: 'preview a private profile',
        text: 'your own profile page now opens for you while it is still private, so you can arrange it before making it public.',
      },
      {
        kind: 'bullet',
        head: 'this page, rewritten',
        text: 'every update below was rewritten in plain language — what changed and what it does, without the flourishes.',
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
        text: 'a new history tab shows who commented, suggested, replied, wrote, or saved a version — and when.',
      },
      {
        kind: 'bullet',
        head: 'see what an edit changed',
        text: 'writing sessions in the history show their word count (+214 words). click one to see the actual change: removed text struck through, new text below it.',
      },
      {
        kind: 'bullet',
        head: 'unread marks on your pages',
        text: 'your home page now marks what arrived on each page since you last opened it: new comments, suggested edits, and changes to the text.',
      },
      {
        kind: 'bullet',
        head: 'accepted or dismissed',
        text: 'resolved suggestions now say whether the edit was accepted or dismissed, and by whom.',
      },
      {
        kind: 'bullet',
        head: 'comment-only sharing',
        text: 'the share menu has a new link type: people who open it can read and comment, but not edit. the regular link still allows editing.',
      },
      {
        kind: 'bullet',
        head: 'download your pages',
        text: 'download any page as markdown, html, or plain text — or copy it to the clipboard in those formats — from the share menu.',
      },
      {
        kind: 'bullet',
        head: 'polish',
        text: 'input boxes and buttons now look the same everywhere, the formatting bar is bigger, and the writing calendar fits small windows.',
      },
    ],
  },
  {
    date: 'july 14, 2026',
    title: 'faster loading',
    blocks: [
      {
        kind: 'bullet',
        head: 'first load is ~5 seconds faster after idle periods',
        text: 'when nobody had visited for a while, the server shut down completely and the next visit waited 5–10 seconds for it to boot. it now suspends instead of shutting down and resumes in under a second.',
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
        text: 'paste from a chat app, notes app, or .md file and you get real headings, bold, and dividers instead of raw # and ** symbols. if text lands as a grey code block, select it and press the code button to turn it into normal text.',
      },
      {
        kind: 'bullet',
        head: 'images are backed up',
        text: 'images are now continuously backed up off-site, the way your text already was.',
      },
      {
        kind: 'bullet',
        head: 'fixed',
        text: 'only people who can edit a page can resolve its comments. suggested edits no longer duplicate or delete surrounding text. a brief wifi drop no longer hides your cursor from collaborators. failed AI requests no longer count against your monthly limit. deleting a page no longer discards edits a collaborator is still typing. profile checkboxes now show the correct state.',
      },
      {
        kind: 'aside',
        text: 'also: stronger security on sign-up and password changes.',
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
        text: 'comment threads now support replies — write back and forth as long as needed. resolve is the smaller button beside reply.',
      },
      {
        kind: 'bullet',
        head: 'fewer false “✽ written twice” marks',
        text: 'the marker now appears only when two people actually rewrite the same paragraph. commenting, resolving, and rearranging no longer trigger it.',
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
        text: 'the proof tab lets you choose what to check for — grammar, clarity, clichés, hedging, or a check you write yourself. each fix applies with one click.',
      },
      {
        kind: 'bullet',
        head: 'comments are easier to follow',
        text: 'clicking a comment marker in the text highlights that comment in the sidebar, and comment popups always open on screen.',
      },
      {
        kind: 'bullet',
        head: 'automatic versions',
        text: 'a version is saved after five quiet minutes, or every ten minutes of continuous writing. hover a version to preview it before restoring.',
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
        text: 'send someone your draft link and they can write, comment, and suggest edits without creating an account — they just enter a name.',
      },
    ],
  },
  {
    date: 'july 2, 2026',
    title: 'images, embeds, and suggested edits',
    blocks: [
      {
        kind: 'bullet',
        head: 'embeds',
        text: 'paste a youtube, vimeo, loom, spotify, or twitter link on its own line and it becomes a player.',
      },
      {
        kind: 'bullet',
        head: 'images',
        text: 'paste or drag an image into the page and it lands where you dropped it.',
      },
      {
        kind: 'bullet',
        head: 'published pages match the editor',
        text: 'heading sizes and dividers now carry over to the published page.',
      },
      {
        kind: 'bullet',
        head: 'suggested edits',
        text: 'select text to leave a comment or suggest a specific edit (⌥⌘M). “apply edit” inserts the reviewer’s exact words — no AI involved.',
      },
      {
        kind: 'bullet',
        head: 'safer collaboration',
        text: 'when a second writer joins, the current text is saved as a version first. restoring an old version also saves the current text.',
      },
      {
        kind: 'bullet',
        head: 'profiles rearranged',
        text: 'name, links, activity chart, then pages — and hovering a page shows a preview.',
      },
      {
        kind: 'aside',
        text: 'also: continuous off-site backups, restorable in minutes.',
      },
    ],
  },
  {
    date: 'july 1, 2026',
    title: 'author* launches',
    blocks: [
      {
        kind: 'bullet',
        head: 'writing together',
        text: 'live collaborative editing with named cursors, ⌘K rewrites and feedback, margin comments, version history, and one-click publishing.',
      },
      {
        kind: 'bullet',
        head: 'open to everyone',
        text: 'sign up with an email and password — or write without an account at all.',
      },
      {
        kind: 'bullet',
        head: 'a page of your own',
        text: 'public profiles at /u/yourname with an activity chart, social links, and header images. .md import keeps formatting.',
      },
      {
        kind: 'bullet',
        head: 'security',
        text: 'hashed passwords, rate-limited sign-in, expiring sessions, and cookie-free analytics.',
      },
      { kind: 'aside', text: 'live at author.computer.' },
    ],
  },
]
