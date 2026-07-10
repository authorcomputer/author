// The editor's glue seams, tested pure — no DOM, no server. Four small
// contracts that Editor.tsx leans on:
//   · own-ink: a collaborator's typing (or our own mark sweep) must never
//     credit this viewer's activity chart
//   · paste: "copy image" from a web page ships an external <img> and no
//     words — the clipboard's file must win, not a silent nothing
//   · command-bus: a ⌘K stream outliving its page must go nowhere, never
//     into the next doc's panel
//   · restore: the promised "current text is kept first" is a contract —
//     a failed keep stops the restore before anything is overwritten
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'editor-state-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [
    path.join(root, 'client/src/own-ink.ts'),
    path.join(root, 'client/src/paste.ts'),
    path.join(root, 'client/src/command-bus.ts'),
    path.join(root, 'client/src/restore.ts'),
  ],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
})

const { getSchema } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { EditorState } = await import('@tiptap/pm/state')
const { ySyncPluginKey } = await import('y-prosemirror')
const { isOwnInk, PLUMBING } = await import(path.join(cache, 'own-ink.js'))
const { defaultPasteKeeps } = await import(path.join(cache, 'paste.js'))
const { listenCommandResults, publishCommandResult } = await import(
  path.join(cache, 'command-bus.js')
)
const { keepThenRestore } = await import(path.join(cache, 'restore.js'))

let failed = 0
const check = (name, cond) => {
  console.log(`${cond ? '  ok ' : 'FAIL '} ${name}`)
  if (!cond) failed++
}

// ---- own-ink: whose pen moved? ----
console.log('\n· own-ink')
{
  const schema = getSchema([StarterKit.configure({ history: false })])
  const st = EditorState.create({
    schema,
    doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('hello'))]),
  })
  const typing = () => st.tr.insertText(' world', 6)
  check('local typing is own ink', isOwnInk(typing()))
  check(
    'a collaborator’s edit arriving over yjs is not',
    !isOwnInk(typing().setMeta(ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: false }))
  )
  check(
    'my own undo riding through yjs still is',
    isOwnInk(typing().setMeta(ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: true }))
  )
  check(
    'the initial binding pouring the doc in is not',
    !isOwnInk(typing().setMeta(ySyncPluginKey, { binding: {}, isChangeOrigin: true }))
  )
  check('a tagged mark sweep is not', !isOwnInk(typing().setMeta(PLUMBING, true)))
  check('a transaction that changes no words is not', !isOwnInk(st.tr.setMeta('x', 1)))
}

// ---- paste: does the default paste keep anything? ----
console.log('\n· paste')
{
  check(
    'chrome “copy image” (external img, no words) keeps nothing',
    !defaultPasteKeeps('<meta charset="utf-8"><img src="https://example.com/x.png" alt="a chart">', '')
  )
  check(
    'word/edge clipboard wrapping keeps nothing either',
    !defaultPasteKeeps('<html><body><!--StartFragment--><img src="https://x.test/p.jpg"><!--EndFragment--></body></html>', '')
  )
  check(
    'an image rendition alongside real text keeps the text',
    defaultPasteKeeps('<p>real words</p><img src="https://x.test/render.png">', 'real words')
  )
  check('plain text with no html keeps the text', defaultPasteKeeps('', 'just words'))
  check('a bare screenshot (no text types at all) keeps nothing', !defaultPasteKeeps('', ''))
  check(
    'one of our own /files/ images keeps the image',
    defaultPasteKeeps('<img src="/files/img_abc.jpg">', '')
  )
  check(
    'an entity that might be a character defers to the default',
    defaultPasteKeeps('<p>&amp;</p>', '')
  )
  check(
    'style blocks are not words',
    !defaultPasteKeeps('<style>p { color: red }</style><img src="https://x.test/a.png">', '')
  )
}

// ---- command-bus: a stream must die with its page ----
console.log('\n· command-bus')
{
  const seen = []
  const result = (text) => ({ instruction: 'shorter', range: null, sourceText: '', text, running: true })

  // doc A: panel listening, stream flowing
  const editorA = { isDestroyed: false }
  const offA = listenCommandResults((r) => seen.push(['A', r.text]))
  publishCommandResult(editorA, result('first'))
  check('a live stream reaches its own panel', seen.length === 1 && seen[0][1] === 'first')

  // navigate: doc A unmounts (editor destroyed, panel unlistens), doc B's
  // panel takes the bus — the still-running stream from A must go nowhere
  editorA.isDestroyed = true
  offA()
  const editorB = { isDestroyed: false }
  const offB = listenCommandResults((r) => seen.push(['B', r.text]))
  publishCommandResult(editorA, result('stale rewrite of doc A'))
  check('a stream from a closed doc never reaches the new panel', seen.length === 1)

  // doc B's own command still works
  publishCommandResult(editorB, result('doc B’s own rewrite'))
  check('the new doc’s own stream still lands', seen.length === 2 && seen[1][0] === 'B')

  // unlistening lets go of only your own hook
  const offC = listenCommandResults(() => seen.push(['C']))
  offB() // B's stale cleanup fires after C registered
  publishCommandResult(editorB, result('x'))
  check('a late unlisten cannot evict the newer panel', seen.length === 3 && seen[2][0] === 'C')
  offC()
}

// ---- restore: no keep, no restore ----
console.log('\n· restore')
{
  // the safety save fails (deploy mid-restore, 413 on a big page) — the
  // live page must stand untouched
  let applied = null
  const outcome = await keepThenRestore({
    fetchVersion: async () => ({ content: { type: 'doc', content: [] } }),
    keep: async () => {
      throw new Error('503 mid-deploy')
    },
    apply: (c) => {
      applied = c
    },
  })
  check('a failed keep aborts the restore', outcome === 'keep failed')
  check('nothing was overwritten', applied === null)
}
{
  // the happy path still restores, and the keep lands first
  const order = []
  let applied = null
  const outcome = await keepThenRestore({
    fetchVersion: async () => (order.push('fetch'), { content: 'old words' }),
    keep: async () => order.push('keep'),
    apply: (c) => {
      order.push('apply')
      applied = c
    },
  })
  check('a kept restore restores', outcome === 'restored' && applied === 'old words')
  check('the keep lands before the page changes', order.join('>') === 'fetch>keep>apply')
}
{
  // a version too old for the schema reports itself without a crash
  const outcome = await keepThenRestore({
    fetchVersion: async () => ({ content: { type: 'ancient' } }),
    keep: async () => {},
    apply: () => {
      throw new Error('unknown node type')
    },
  })
  check('a stale version reports stale format', outcome === 'stale format')
}
{
  // the version fetch failing keeps hands off the page entirely
  let touched = false
  const err = await keepThenRestore({
    fetchVersion: async () => {
      throw new Error('gone')
    },
    keep: async () => (touched = true),
    apply: () => (touched = true),
  }).catch((e) => e)
  check('a failed fetch touches nothing', err instanceof Error && !touched)
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
