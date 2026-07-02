import { marked } from 'marked'

// the model answers in markdown; render it, but scrub the result — a draft
// could prompt-inject the model into emitting <script>, and this lands in the
// writer's own session. allowlist the tags the editor itself produces.
const ALLOWED = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'PRE',
  'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'HR', 'SPAN',
])

function scrub(node: Element) {
  for (const el of Array.from(node.children)) {
    if (!ALLOWED.has(el.tagName)) {
      // drop the tag, keep its text (so a stray <img>/<script> becomes nothing)
      el.replaceWith(document.createTextNode(el.textContent || ''))
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name === 'href') {
        const ok = /^https?:\/\//i.test(attr.value) || attr.value.startsWith('mailto:')
        if (!ok) el.removeAttribute('href')
      } else if (name !== 'class') {
        el.removeAttribute(attr.name) // strips on*, style, src, etc.
      }
    }
    if (el.tagName === 'A' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noreferrer noopener')
    }
    scrub(el)
  }
}

export function renderMarkdown(md: string): string {
  const html = marked.parse(md || '', { breaks: true, async: false }) as string
  const doc = new DOMParser().parseFromString(html, 'text/html')
  scrub(doc.body)
  return doc.body.innerHTML
}
