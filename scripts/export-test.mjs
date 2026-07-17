// The way out of the house (client/src/export.ts), tested pure: no DOM,
// no server. A tiptap JSON doc must come back as sane markdown — marks
// nested right, lists indented, quotes prefixed, comment marks silently
// left behind — and as bare text with paragraph breaks.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'export-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [path.join(root, 'client/src/export.ts')],
  outdir: cache,
  bundle: true,
  format: 'esm',
})
const { docToMarkdown, docToText, standaloneHtml, fileStem } = await import(
  path.join(cache, 'export.js')
)

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
  docToMarkdown({
    type: 'doc',
    content: [
      p(
        t('plain '),
        t('bold', 'bold'),
        t(' '),
        t('both', 'bold', 'italic'),
        t(' '),
        t('x=1', 'code'),
        t(' '),
        {
          type: 'text',
          text: 'here',
          marks: [{ type: 'link', attrs: { href: 'https://a.com' } }],
        }
      ),
    ],
  }),
  'plain **bold** ***both*** `x=1` [here](https://a.com)\n'
)
check(
  'comment marks are left behind',
  docToMarkdown({
    type: 'doc',
    content: [p({ type: 'text', text: 'noted', marks: [{ type: 'comment', attrs: { id: 'c1' } }] })],
  }),
  'noted\n'
)

console.log('blocks')
check(
  'heading + quote + rule',
  docToMarkdown({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [t('title')] },
      { type: 'blockquote', content: [p(t('said')), p(t('twice'))] },
      { type: 'horizontalRule' },
    ],
  }),
  '## title\n\n> said\n>\n> twice\n\n---\n'
)
check(
  'code block keeps blank lines',
  docToMarkdown({
    type: 'doc',
    content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'a\n\nb' }] }],
  }),
  '```\na\n\nb\n```\n'
)
check(
  'lists nest',
  docToMarkdown({
    type: 'doc',
    content: [
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
    ],
  }),
  '- one\n- two\n  1. a\n  2. b\n'
)
check(
  'image and embed become links out',
  docToMarkdown(
    {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: '/files/abc.jpg' } },
        { type: 'embed', attrs: { src: 'https://www.youtube.com/embed/x' } },
      ],
    },
    'https://author.computer'
  ),
  '![](https://author.computer/files/abc.jpg)\n\nhttps://www.youtube.com/embed/x\n'
)

console.log('text')
check(
  'bare text with breaks',
  docToText({
    type: 'doc',
    content: [p(t('one'), { type: 'hardBreak' }, t('two')), p(t('three'))],
  }),
  'one\ntwo\n\nthree\n'
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
