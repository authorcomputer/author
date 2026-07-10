import { marked } from 'marked'

// the model answers in markdown; render it, but scrub the result — a draft
// could prompt-inject the model into emitting <script>, and this lands in the
// writer's own session. allowlist the tags the editor itself produces.
const ALLOWED = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE',
  'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'A', 'HR', 'SPAN',
])

function scrub(node: Element) {
  for (const el of Array.from(node.children)) {
    // depth-first first, so a disallowed wrapper's children are already clean
    // before we move them up (a nested <script> can't survive an unwrap)
    scrub(el)
    // svg/mathml elements report tagName in lowercase — compare case-blind or
    // a <script> inside <svg> slips past both gates as a benign unknown
    const tag = el.tagName.toUpperCase()
    if (!ALLOWED.has(tag)) {
      // drop <script>/<style> whole; unwrap any other disallowed tag (e.g. a
      // stray <div>) so its allowed children aren't lost with it
      const dangerous = tag === 'SCRIPT' || tag === 'STYLE'
      el.replaceWith(...(dangerous ? [] : Array.from(el.childNodes)))
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name === 'href') {
        const ok = /^https?:\/\//i.test(attr.value) || attr.value.startsWith('mailto:')
        if (!ok) el.removeAttribute('href')
      } else {
        el.removeAttribute(attr.name) // strips on*, style, src, class, etc.
      }
    }
    if (tag === 'A' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noreferrer noopener')
    }
  }
}

export function renderMarkdown(md: string): string {
  const html = marked.parse(md || '', { breaks: true, async: false }) as string
  const doc = new DOMParser().parseFromString(html, 'text/html')
  scrub(doc.body)
  return doc.body.innerHTML
}
