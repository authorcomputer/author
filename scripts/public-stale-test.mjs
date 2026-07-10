// The published page (client/src/pages/Public.tsx), tested against the race
// router reuse creates: /p/a → /p/b changes only the param, so the component
// never unmounts and a's fetch keeps running. jsdom is the browser, a
// hand-resolved fetch is the jittery network — b answers first, a limps in
// late, and the page at /p/b must still be b's article.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'public-stale-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [path.join(root, 'client/src/pages/Public.tsx')],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
  logLevel: 'silent',
})

// the dom, before anything client-side is imported — api.ts touches
// localStorage and the analytics stub touches window at module load
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.localStorage = dom.window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// a network that answers only when the test says so
const inflight = new Map()
globalThis.fetch = (url) => new Promise((resolve) => inflight.set(String(url), resolve))

const { createElement: h, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route, useNavigate } = await import('react-router-dom')
const { default: Public } = await import(path.join(cache, 'Public.js'))

let nav
function GrabNav() {
  nav = useNavigate()
  return null
}

const reactRoot = createRoot(document.getElementById('root'))
await act(async () => {
  reactRoot.render(
    h(
      MemoryRouter,
      { initialEntries: ['/p/a'] },
      h(GrabNav),
      h(Routes, null, h(Route, { path: '/p/:slug', element: h(Public) }))
    )
  )
})

const respond = (url, body, ok = true) =>
  act(async () => inflight.get(url)({ ok, json: async () => body }))
const text = () => document.getElementById('root').textContent
const ok = (label, cond) => {
  if (!cond) throw new Error(`FAIL: ${label}\n  page: ${text()}`)
  console.log(`PASS: ${label}`)
}

ok('a is fetched on arrival', inflight.has('/api/public/a'))

// move to b while a is still in the air
await act(async () => nav('/p/b'))
ok('b is fetched after navigation', inflight.has('/api/public/b'))

await respond('/api/public/b', { title: 'the b piece', html: '<p>b body</p>' })
ok('b renders at /p/b', text().includes('the b piece'))

// a's answer straggles in — it belongs to a page the reader already left
await respond('/api/public/a', { title: 'the a piece', html: '<p>a body</p>' })
ok('late a does not overwrite b', text().includes('the b piece') && !text().includes('the a piece'))
ok('late a does not retitle the tab', document.title === 'the b piece · author*')

// and a late failure must not flip a loaded page to the missing notice
await act(async () => nav('/p/c'))
await act(async () => nav('/p/d'))
await respond('/api/public/d', { title: 'the d piece', html: '<p>d body</p>' })
await respond('/api/public/c', {}, false)
ok('late 404 does not haunt a loaded page', text().includes('the d piece'))

console.log('public-stale-test: all good')
