// turn a pasted URL into an embeddable player. each provider maps to a single
// trusted frame host (see the CSP frame-src list in server/index.js) and a
// canonical /embed/ path, so a paste can never smuggle in an arbitrary iframe.
export type Embed = { src: string; provider: string }

const YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/
const LOOM = /loom\.com\/(?:share|embed)\/([a-f0-9]{32})/
const SPOTIFY = /open\.spotify\.com\/(?:embed\/)?(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/
const TWEET = /(?:twitter|x)\.com\/\w+\/status\/(\d+)/

export function parseEmbed(raw: string): Embed | null {
  const url = raw.trim()
  let m
  if ((m = url.match(YOUTUBE)))
    return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${m[1]}` }
  if ((m = url.match(VIMEO)))
    return { provider: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}` }
  if ((m = url.match(LOOM)))
    return { provider: 'loom', src: `https://www.loom.com/embed/${m[1]}` }
  if ((m = url.match(SPOTIFY)))
    return { provider: 'spotify', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}` }
  if ((m = url.match(TWEET)))
    return { provider: 'tweet', src: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}` }
  return null
}
