// The line between a markdown document and text that merely contains a hash.
// Two independent signals is the rule; everything here is a case where getting
// it wrong would either mangle a writer's code or leave a report wearing its
// own punctuation.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
global.window = dom.window
global.document = dom.window.document
global.DOMParser = dom.window.DOMParser

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cache = path.join(root, 'node_modules', '.cache', 'markdown-paste-test')
mkdirSync(cache, { recursive: true })
await build({
  entryPoints: [path.join(root, 'client/src/markdown-paste.ts')],
  outdir: cache,
  bundle: true,
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
})
const { looksLikeMarkdown } = await import(path.join(cache, 'markdown-paste.js'))

let failed = 0
const is = (want, text, why) => {
  const got = looksLikeMarkdown(text)
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${why}`)
  if (!ok) failed++
}

// ---------- the real thing ----------
is(
  true,
  `# Deep Research Report: Cody Miller (Meter)

**Research question:** Who is Cody Miller of Meter?

**Date:** July 9, 2026

---

## Executive Summary

**No verifiable public evidence connects anyone named Cody Miller to Meter, Inc.**`,
  'the pasted research report reads as markdown'
)
is(true, '## Heading\n\n- one\n- two', 'a heading and a list')
is(true, '| a | b |\n|---|---|\n| 1 | 2 |', 'a table')
is(true, 'see [the docs](https://x.dev) and **note this**', 'a link and bold')
is(true, '> quoted\n\n1. first\n2. second', 'a quote and an ordered list')

// ---------- things that must NOT be mangled ----------
is(
  false,
  `# tally the rows
for r in rows:
    n += 1`,
  'python with a lone # comment is not markdown'
)
is(false, 'A sentence — with an em dash — and nothing else.', 'prose with em dashes is not markdown')
is(false, '# just one heading and ordinary prose beneath it', 'a single signal is not enough')
is(false, 'a * b * c and 2 - 1 = 1', 'stray asterisks and hyphens are not markdown')
is(false, 'https://example.com/a_b_c', 'a bare url is not markdown')
is(false, '', 'empty text is not markdown')
is(false, 'hi', 'a two-character note is not markdown')

// shell scripts are the nastiest near-miss: comments AND flags that look like lists
is(
  false,
  `#!/bin/sh
# restore the db if the volume came up empty
litestream restore -if-replica-exists "$DB"`,
  'a shell script with a comment and a -flag is not markdown'
)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
