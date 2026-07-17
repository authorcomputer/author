// The way out of the house (client/src/export.ts), tested against the real
// schema: tiptap JSON becomes a PM doc, then markdown via prosemirror-markdown
// — metacharacters escaped, fences lengthened, lists indented, comment marks
// silently left behind — and the html door strips review ink and absolutizes
// upload srcs without touching prose that merely looks like an attribute.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
global.window = dom.window
global.document = dom.window.document
global.DOMParser = dom.window.DOMParser // exportableHtml reaches for the bare global

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'export-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [
    path.join(root, 'client/src/export.ts'),
    path.join(root, 'client/src/comment-mark.ts'),
    path.join(root, 'client/src/embed-node.ts'),
  ],
  outdir: cache,
  bundle: true,
  format: 'esm',
})
const { docToMarkdown, exportableHtml, standaloneHtml, fileStem } = await import(
  path.join(cache, 'export.js')
)
const { CommentMark } = await import(path.join(cache, 'comment-mark.js'))
const { Embed } = await import(path.join(cache, 'embed-node.js'))

const { getSchema } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { default: Underline } = await import('@tiptap/extension-underline')
const { default: TiptapLink } = await import('@tiptap/extension-link')
const { default: TiptapImage } = await import('@tiptap/extension-image')
const { Node: PMNode } = await import('@tiptap/pm/model')

const schema = getSchema([StarterKit, Underline, TiptapLink, TiptapImage, CommentMark, Embed])
const md = (content, origin = '') =>
  docToMarkdown(PMNode.fromJSON(schema, { type: 'doc', content }), origin)

let failed = 0
function check(name, got, want) {
  if (got === want) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}\n    want: ${JSON.stringify(want)}\n    got:  ${JSON.stringify(got)}`)
  }
}

const t = (text, ...marks) => ({ type: 'text', text, marks: marks.map((m) => ({ type: m })) })
const p = (...content) => ({ type: 'paragraph', content })

console.log('marks')
check(
  'bold italic code link',
  md([
    p(
      t('plain '),
      t('bold', 'bold'),
      t(' '),
      t('both', 'bold', 'italic'),
      t(' '),
      t('x=1', 'code'),
      t(' '),
      { type: 'text', text: 'here', marks: [{ type: 'link', attrs: { href: 'https://a.com' } }] }
    ),
  ]),
  'plain **bold** ***both*** `x=1` [here](https://a.com)\n'
)
check(
  'comment marks are left behind',
  md([p({ type: 'text', text: 'noted', marks: [{ type: 'comment', attrs: { id: 'c1' } }] })]),
  'noted\n'
)

console.log('the author’s literal characters survive')
check('a paragraph that looks like a list stays prose', md([p(t('1. step'))]), '1\\. step\n')
check('literal asterisks stay asterisks', md([p(t('3 * 4 * 5'))]), '3 \\* 4 \\* 5\n')
check(
  'a fence inside a code block does not break out',
  md([{ type: 'codeBlock', content: [{ type: 'text', text: 'a\n```\nb' }] }]),
  '````\na\n```\nb\n````\n'
)

console.log('blocks')
check(
  'heading + quote + rule',
  md([
    { type: 'heading', attrs: { level: 2 }, content: [t('title')] },
    { type: 'blockquote', content: [p(t('said')), p(t('twice'))] },
    { type: 'horizontalRule' },
  ]),
  '## title\n\n> said\n>\n> twice\n\n---\n'
)
check(
  'lists nest',
  md([
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(t('one'))] },
        {
          type: 'listItem',
          content: [
            p(t('two')),
            {
              type: 'orderedList',
              content: [
                { type: 'listItem', content: [p(t('a'))] },
                { type: 'listItem', content: [p(t('b'))] },
              ],
            },
          ],
        },
      ],
    },
  ]),
  '- one\n- two\n  1. a\n  2. b\n'
)
check(
  'ordered list keeps start=0',
  md([
    {
      type: 'orderedList',
      attrs: { start: 0 },
      content: [
        { type: 'listItem', content: [p(t('zero'))] },
        { type: 'listItem', content: [p(t('one'))] },
      ],
    },
  ]),
  '0. zero\n1. one\n'
)
check(
  'indented code inside a list item keeps its indentation',
  md([
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            p(t('item')),
            { type: 'codeBlock', content: [{ type: 'text', text: 'if x:\n  y()' }] },
          ],
        },
      ],
    },
  ]),
  '- item\n\n  ```\n  if x:\n    y()\n  ```\n'
)
check(
  'image and embed become links out',
  md(
    [
      { type: 'image', attrs: { src: '/files/abc.jpg' } },
      { type: 'embed', attrs: { src: 'https://www.youtube.com/embed/x' } },
    ],
    'https://author.computer'
  ),
  '![](https://author.computer/files/abc.jpg)\n\nhttps://www.youtube.com/embed/x\n'
)

console.log('html leaves clean')
check(
  'comment spans unwrapped, srcs absolutized',
  exportableHtml(
    '<p><span class="comment-mark" data-comment-id="c1" data-comment-kind="note">kept <b>words</b></span></p><p><img src="/files/abc.jpg"></p>',
    'https://author.computer'
  ),
  '<p>kept <b>words</b></p><p><img src="https://author.computer/files/abc.jpg"></p>'
)
check(
  'prose that looks like an attribute is not rewritten',
  exportableHtml('<pre><code>src="/files/abc.jpg"</code></pre>', 'https://author.computer'),
  '<pre><code>src="/files/abc.jpg"</code></pre>'
)

console.log('html shell')
const html = standaloneHtml('a < title', '<p><img src="/files/abc.jpg"></p>', 'https://author.computer')
check('title escaped', html.includes('<title>a &lt; title</title>'), true)
check('img src absolute', html.includes('src="https://author.computer/files/abc.jpg"'), true)

console.log('filenames')
check('slugged', fileStem("Ari’s Draft: Q3 plans!"), 'aris-draft-q3-plans')
check('empty falls back', fileStem('   '), 'untitled')

if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall good')
