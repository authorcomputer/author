// The highlighter-ink overlay (client/src/highlight-ink.ts), headless: a
// real Tiptap editor in jsdom with comment marks, the ink attached, marks
// added and removed through transactions, dark mode flipped, everything
// torn down. jsdom has no layout, so the library resolves zero rects and
// hands back inert handles — what this proves is the lifecycle: attach,
// diff, recolor, and cleanup never throw, and no handles leak. Run it
// before touching highlight-ink.ts or the comment-mark DOM shape.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// jsdom swallows exceptions thrown inside rAF callbacks (where the ink's
// sync runs) and only reports them here — count them, they fail the run
const swallowed = []
const virtualConsole = new VirtualConsole()
virtualConsole.forwardTo(console, { jsdomErrors: 'none' })
virtualConsole.on('jsdomError', (e) => swallowed.push(e))

const dom = new JSDOM(
  '<!doctype html><html><body><div class="ed-scroll"><div id="mount"></div></div></body></html>',
  { url: 'http://localhost', pretendToBeVisual: true, virtualConsole }
)
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.MutationObserver = dom.window.MutationObserver
// the library type-checks its Target with instanceof against the globals
global.Element = dom.window.Element
global.HTMLElement = dom.window.HTMLElement
global.Node = dom.window.Node
global.Range = dom.window.Range
global.Selection = dom.window.Selection
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
// layout-adjacent APIs jsdom doesn't ship — the library feature-detects,
// so stubs that report "nothing here" push it down to inert/css paths
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
}
global.matchMedia = dom.window.matchMedia.bind(dom.window)
if (!global.CSS) global.CSS = { supports: () => false }
// no layout in jsdom: zero rects is the honest answer, and it routes the
// library to its inert-handle path instead of a missing-method crash
dom.window.Range.prototype.getClientRects = () => []
dom.window.Range.prototype.getBoundingClientRect = () =>
  ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 })

const cache = path.join(root, 'node_modules', '.cache', 'ink-smoke-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [
    path.join(root, 'client/src/highlight-ink.ts'),
    path.join(root, 'client/src/comment-mark.ts'),
  ],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
})

const { Editor } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { attachCommentInk, attachSelectionInk } = await import(path.join(cache, 'highlight-ink.js'))
const { CommentMark } = await import(path.join(cache, 'comment-mark.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frame = () => sleep(30) // enough for the rAF-debounced sync to run

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failures++
}

const editor = new Editor({
  element: document.getElementById('mount'),
  extensions: [StarterKit, CommentMark],
  content:
    '<p>plain words, then <span data-comment-id="c1" data-comment-kind="note">a noted stretch</span> to paint.</p>',
})

check('editor renders the comment span', !!editor.view.dom.querySelector('span.comment-mark'))

const detach = attachCommentInk(editor)
await frame()
check('ink attaches over an existing mark without throwing', true)

// a second comment arrives by transaction — the diff must pick it up
editor.commands.setTextSelection({ from: 1, to: 6 })
editor.commands.setComment('c2', 'edit')
await frame()
check(
  'a mark added later is seen by the sync',
  editor.view.dom.querySelectorAll('span.comment-mark').length === 2
)

// the lamp flips — every handle gets recolored in place
document.documentElement.dataset.mode = 'dark'
await frame()
delete document.documentElement.dataset.mode
await frame()
check('dark-mode flip recolors without throwing', true)

// a mark removed by transaction — its handle must be dropped, not leaked
editor.commands.setTextSelection({ from: 1, to: 6 })
editor.commands.unsetMark('comment')
await frame()
check(
  'a removed mark leaves the sync',
  editor.view.dom.querySelectorAll('span.comment-mark').length === 1
)

detach()
editor.destroy()
await frame()
check('detach and destroy leave quietly', true)

// the reader-page selection ink: attach and detach, nothing more to prove
// headlessly (jsdom selections have no geometry)
const stop = attachSelectionInk()
document.dispatchEvent(new dom.window.Event('selectionchange'))
await frame()
stop()
check('selection ink attaches and detaches', true)

check('no exceptions swallowed by the event loop', swallowed.length === 0)
for (const e of swallowed) console.error('  swallowed:', e.detail ?? e)

if (failures) {
  console.error(`\n${failures} failed`)
  process.exit(1)
}
console.log('\nink smoke: all good')
process.exit(0)
