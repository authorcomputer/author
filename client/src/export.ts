// what a page becomes when it leaves the house — markdown, html, or bare
// text a reader can carry anywhere. the serializer walks tiptap JSON by
// hand so export needs no extra deps; review metadata (comment marks,
// co-written tags) is ink about the ink and stays home.

type JNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: JNode[]
}

function abs(src: string, origin: string): string {
  return src.startsWith('/') ? origin + src : src
}

/* ---- inline text with marks ---- */

function inlineMd(nodes: JNode[] | undefined, origin: string): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'image')
        return `![${(n.attrs?.alt as string) || ''}](${abs((n.attrs?.src as string) || '', origin)})`
      let t = n.text ?? ''
      if (!t) return ''
      const marks = n.marks ?? []
      const has = (m: string) => marks.some((x) => x.type === m)
      if (has('code')) {
        t = '`' + t + '`'
      } else {
        if (has('bold')) t = `**${t}**`
        if (has('italic')) t = `*${t}*`
        if (has('strike')) t = `~~${t}~~`
        if (has('underline')) t = `<u>${t}</u>`
      }
      const link = marks.find((x) => x.type === 'link')
      const href = link?.attrs?.href as string | undefined
      if (href) t = `[${t}](${href})`
      return t
    })
    .join('')
}

/* ---- blocks ---- */

function blockMd(n: JNode, origin: string, indent = ''): string {
  switch (n.type) {
    case 'paragraph':
      return inlineMd(n.content, origin)
    case 'heading': {
      const level = Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 6)
      return '#'.repeat(level) + ' ' + inlineMd(n.content, origin)
    }
    case 'blockquote':
      return (n.content ?? [])
        .map((c) => blockMd(c, origin))
        .join('\n\n')
        .split('\n')
        .map((l) => ('> ' + l).trimEnd())
        .join('\n')
    case 'codeBlock': {
      const lang = (n.attrs?.language as string) || ''
      const body = (n.content ?? []).map((c) => c.text ?? '').join('')
      return '```' + lang + '\n' + body + '\n```'
    }
    case 'bulletList':
      return listMd(n, origin, indent, () => '- ')
    case 'orderedList': {
      let i = Number(n.attrs?.start) || 1
      return listMd(n, origin, indent, () => `${i++}. `)
    }
    case 'horizontalRule':
      return '---'
    case 'image':
      return `![${(n.attrs?.alt as string) || ''}](${abs((n.attrs?.src as string) || '', origin)})`
    case 'embed':
      return (n.attrs?.src as string) || ''
    default:
      return inlineMd(n.content, origin)
  }
}

function listMd(list: JNode, origin: string, indent: string, bullet: () => string): string {
  return (list.content ?? [])
    .map((item) => {
      const b = bullet()
      const pad = ' '.repeat(b.length)
      const parts = (item.content ?? []).map((c) =>
        c.type === 'bulletList' || c.type === 'orderedList'
          ? blockMd(c, origin, indent + pad)
          : blockMd(c, origin)
      )
      return (
        indent +
        b +
        parts
          .join('\n')
          .split('\n')
          .map((l, i) => (i === 0 ? l : c(l, indent + pad)))
          .join('\n')
      )
    })
    .join('\n')
}

// nested list lines already carry their own indent; plain continuation lines don't
function c(line: string, pad: string): string {
  return line.startsWith(pad) ? line : pad + line
}

export function docToMarkdown(doc: JNode, origin = globalThis.location?.origin ?? ''): string {
  return (doc.content ?? [])
    .map((n) => blockMd(n, origin))
    .filter((s) => s !== '')
    .join('\n\n') + '\n'
}

export function docToText(doc: JNode): string {
  const walk = (n: JNode): string => {
    if (n.text) return n.text
    if (n.type === 'hardBreak') return '\n'
    return (n.content ?? []).map(walk).join('')
  }
  return (doc.content ?? [])
    .map(walk)
    .filter((s) => s.trim() !== '')
    .join('\n\n') + '\n'
}

/* ---- a standalone page the html download can be opened as ---- */

export function standaloneHtml(
  title: string,
  bodyHtml: string,
  origin = globalThis.location?.origin ?? ''
): string {
  const body = bodyHtml.replace(/src="\/(files\/[^"]+)"/g, `src="${origin}/$1"`)
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc}</title>
<style>
  body { max-width: 640px; margin: 40px auto; padding: 0 24px;
         font-family: Georgia, 'Times New Roman', serif; font-size: 17px;
         line-height: 1.6; color: #1c1a17; background: #fdfcf9; }
  img { max-width: 100%; }
  blockquote { border-left: 2px solid #c9c4ba; margin-left: 0; padding-left: 16px; }
  pre { background: #f4f1ea; padding: 12px; overflow-x: auto; }
  code { background: #f4f1ea; padding: 1px 3px; }
  iframe.embed { width: 100%; aspect-ratio: 16 / 9; border: 0; }
</style>
<body>
<h1>${esc}</h1>
${body}
</body>
</html>
`
}

/* ---- handing the file over ---- */

export function fileStem(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled'
  )
}

export function download(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
