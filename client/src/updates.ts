// The public changelog. Curated from the actual commit history — times are
// when each change shipped. Internal plumbing (build config, CI fixes) is
// folded into its neighbors.

export type Update = { time: string; title: string; note: string }
export type UpdateDay = { date: string; updates: Update[] }

export const UPDATES: UpdateDay[] = [
  {
    date: 'july 2, 2026',
    updates: [
      {
        time: '19:20',
        title: 'embeds',
        note: 'paste a youtube, vimeo, loom, spotify, or tweet link on its own line and it becomes a player — in the editor and on the published page.',
      },
      {
        time: '18:40',
        title: 'profiles, rearranged',
        note: 'a public profile now reads top to bottom — name, links, your writing chart, then your pages — and hovering an article floats a preview card in the margin.',
      },
      {
        time: '17:30',
        title: 'images in the page',
        note: 'paste or drag an image straight into your writing. it uploads quietly and lands where you dropped it.',
      },
      {
        time: '16:10',
        title: 'the published page, truer',
        note: 'headings keep their size and the “· · ·” divider carries over, so a published piece looks like the one you wrote.',
      },
      {
        time: '12:05',
        title: 'a byline of your own',
        note: 'read-only pages now say “written by” with a link to the author’s profile, instead of a generic line.',
      },
      {
        time: '11:20',
        title: 'the chart keeps your time',
        note: 'contribution days follow your own timezone now, so a late evening still counts as today.',
      },
      {
        time: '10:15',
        title: 'small kindnesses',
        note: 'clearer formatting buttons (each wears the style it applies), enter jumps from a title into the page, and every page you open scrolls to the top.',
      },
      {
        time: '09:30',
        title: 'ink & quill, at work',
        note: 'the mock editor on the front page now writes, reconsiders, and revises itself in a quiet loop.',
      },
      {
        time: '02:00',
        title: 'under the floorboards',
        note: 'the writing is now backed up continuously to separate storage and can be restored onto fresh hardware in minutes — the site moved to the west coast in the process.',
      },
    ],
  },
  {
    date: 'july 1, 2026',
    updates: [
      {
        time: '15:55',
        title: 'the doors open',
        note: 'anyone can take a desk with just an email and a password — invite codes retired. five model requests a month are on the house; membership ($10/mo) lifts it to 150 a day.',
      },
      {
        time: '15:48',
        title: 'the rail finds its place',
        note: 'the contribution chart and hover previews hug the page list instead of drifting to the far edge of wide monitors.',
      },
      {
        time: '15:44',
        title: 'quiet analytics',
        note: 'cookie-free page views and product events (seline), with editor urls masked before they ever leave your browser. no emails, no tracking cookies.',
      },
      {
        time: '15:38',
        title: 'choose what your profile shows',
        note: 'every published page gets its own “listed on your profile” toggle — in the share menu and in settings. header uploads now accept any image, any size; the browser quietly resizes.',
      },
      {
        time: '15:33',
        title: 'the desk learns some tricks',
        note: 'your six-month writing chart joins the desk, and hovering a page floats a little paper card with its header image and opening lines.',
      },
      {
        time: '15:29',
        title: '⌘U underlines',
        note: 'underline joins the formatting bubble and the keyboard.',
      },
      {
        time: '15:23',
        title: 'the formatting bubble',
        note: 'select any text and a small toolbar floats up: bold, italic, strike, code, headings, quotes, links — and a shortcut into ⌘K.',
      },
      {
        time: '15:26',
        title: 'a better calling card',
        note: 'links to author.computer unfurl with the a* mark and the tagline.',
      },
      {
        time: '15:14',
        title: 'friend feedback, applied',
        note: 'click anywhere on the empty page to start typing (notion-style), and every text button grew an invisible ~40px tap area.',
      },
      {
        time: '15:11',
        title: 'room for hundreds of pages',
        note: 'the desk paginates past 30 docs, profile & leave live in a small pinned corner, and your name in the header goes to your profile.',
      },
      {
        time: '15:07',
        title: 'ghosts welcome',
        note: 'start writing with no account at all. full editor, live collaboration, one model request on the house — and if you take a desk later, everything you wrote comes with you.',
      },
      {
        time: '14:39',
        title: 'pick your own pen name',
        note: 'rename your handle in settings; your cursors, comments, and profile follow.',
      },
      {
        time: '14:34',
        title: 'the chart whispers',
        note: 'hover any day on a contribution chart to see what it holds.',
      },
      {
        time: '14:31',
        title: 'locks on the doors',
        note: 'a security review pass: hashed passwords, rate-limited sign-in, expiring sessions, and the old test-account passwords rotated.',
      },
      {
        time: '14:22',
        title: 'desks by invitation',
        note: 'accounts arrive — email + password behind invite codes, daily model budgets to keep the lights on, and a fix for ⌘K mangling paragraph replacements.',
      },
      {
        time: '14:12',
        title: 'header images',
        note: 'give a page a banner — it syncs live to collaborators and crowns the published version.',
      },
      {
        time: '14:08',
        title: 'profiles & the great import',
        note: 'public profiles at /u/you with social links and a contribution chart, plus settings — and .md import that turns your old word processor’s files into pages, formatting intact.',
      },
      {
        time: '13:47',
        title: 'a place on the internet',
        note: 'author* learns to deploy — and soon after, moves into author.computer.',
      },
      {
        time: '13:39',
        title: 'the front door & the mark',
        note: 'the a* mark and favicon, a marketing page with a two-cursor mock editor, a proper share menu (writing links + read-only publishing), and headers on public pages.',
      },
      {
        time: '13:23',
        title: 'the first word',
        note: 'author* is born: live multiplayer editing with named cursors, an editor you can ask things of (feedback, checks, titles, ⌘K rewrites), comments in the margin, versions, and one-click publishing.',
      },
    ],
  },
]
