// The public changelog. Curated from the actual commit history — one entry
// per day, telling the story of what that day brought. Internal plumbing
// (build config, CI fixes) is folded in where it matters.

export type UpdateDay = { date: string; title: string; note: string }

export const UPDATES: UpdateDay[] = [
  {
    date: 'july 2, 2026',
    title: 'the page grows richer',
    note: 'paste a youtube, vimeo, loom, spotify, or tweet link on its own line and it becomes a player — in the editor and on the published page. images too: paste or drag one straight into your writing and it lands where you dropped it. published pages got truer to what you wrote (headings keep their size, the “· · ·” divider carries over), public profiles now read top to bottom with a floating preview card when you hover an article, and under the floorboards the writing is backed up continuously to separate storage — the site moved to the west coast in the process.',
  },
  {
    date: 'july 1, 2026',
    title: 'author* opens its doors',
    note: 'author* is born and grows up in a single day: live multiplayer editing with named cursors, an editor you can ask things of (feedback, checks, titles, ⌘K rewrites), comments in the margin, versions, and one-click publishing. accounts arrive and the invite codes retire by evening — anyone can take a desk with just an email and a password, or write as a ghost with no account at all. along the way: public profiles with contribution charts and .md import, header images, the formatting bubble, a security pass (hashed passwords, rate-limited sign-in, expiring sessions), cookie-free analytics, and a home at author.computer.',
  },
]
