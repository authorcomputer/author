import sanitizeHtml from 'sanitize-html'

// embedded players: only these exact /embed/ URL shapes are allowed through,
// mirroring the client's parseEmbed() — anything else is dropped as an iframe
export const EMBED_SRC_RE =
  /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[\w-]{11}|player\.vimeo\.com\/video\/\d+|www\.loom\.com\/embed\/[a-f0-9]{32}|open\.spotify\.com\/embed\/(?:track|album|playlist|episode|show)\/[a-zA-Z0-9]+|platform\.twitter\.com\/embed\/Tweet\.html\?id=\d+)$/

// Doc snapshots are rendered on the public read-only page with
// dangerouslySetInnerHTML — allow only what the editor actually produces.
// lives apart from the server so every writer of docs.html, the rebuild
// script included, passes through the same gate.
export function cleanHtml(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
      'blockquote', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'hr', 'span', 'a', 'img', 'iframe',
    ],
    allowedAttributes: {
      span: ['data-comment-id'],
      a: ['href'],
      img: ['src', 'alt'],
      iframe: ['src', 'data-provider', 'loading', 'frameborder', 'allow', 'allowfullscreen'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // images may only point at our own uploads; iframes only at a known player
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img')
        return !/^\/files\/[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(frame.attribs?.src || '')
      if (frame.tag === 'iframe') return !EMBED_SRC_RE.test(frame.attribs?.src || '')
      return false
    },
  })
}
