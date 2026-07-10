// The AI-output scrubber (client/src/markdown.ts), tested pure: jsdom stands
// in for the browser's DOMParser, which puts <svg>/<math> children in a
// foreign namespace where tagName keeps its lowercase — the exact spot where
// an uppercase-only comparison goes blind. A prompt-injected draft is the
// threat model, so script and style must die whole in every namespace.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'scrub-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [path.join(root, 'client/src/markdown.ts')],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
})

globalThis.DOMParser = new JSDOM('').window.DOMParser
const { renderMarkdown } = await import(path.join(cache, 'markdown.js'))

const check = (label, md, want, unwant = []) => {
  const out = renderMarkdown(md)
  for (const w of [].concat(want))
    if (!out.includes(w))
      throw new Error(`FAIL: ${label}\n  missing ${JSON.stringify(w)}\n  got ${out}`)
  for (const u of unwant)
    if (out.includes(u))
      throw new Error(`FAIL: ${label}\n  leaked ${JSON.stringify(u)}\n  got ${out}`)
  console.log(`PASS: ${label}`)
}

// plain markdown still renders
check('markdown renders through the allowlist', '**bold** and *soft*', [
  '<strong>bold</strong>',
  '<em>soft</em>',
])

// the html-namespace paths the scrubber always handled
check('bare <script> dies whole', 'before\n\n<script>alert(1)</script>\n\nafter', ['before'], [
  'alert(1)',
  '<script',
])
check('a <div> unwraps without losing its children', '<div><p>kept</p></div>', ['<p>kept</p>'], [
  '<div',
])

// foreign content: svg/mathml children keep lowercase tagName
check(
  '<script> inside <svg> dies whole, not unwrapped into visible text',
  '<svg><script>fetch("//evil")</script></svg>',
  [],
  ['fetch("//evil")', 'fetch(&quot;//evil&quot;)', '<script', '<svg']
)
check(
  '<style> inside <svg> dies whole',
  '<svg><style>body{display:none}</style></svg>',
  [],
  ['display:none', '<style']
)
check(
  '<script> inside <math> dies whole',
  '<math><script>alert(2)</script></math>',
  [],
  ['alert(2)', '<script']
)

console.log('scrub-test: all good')
