// The wiring, not just the module: a real server pointed at a fake bucket.
// An uploaded picture must reach the bucket before the writer is told its
// name; a picture no page still holds must leave the bucket with the page;
// and a volume that came up empty must be refilled from the bucket before
// the door opens. Anything less and a restore brings back words pointing at
// nothing.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'

const BUCKET = 'e2e-bucket'
const objects = new Map()
const run = Date.now().toString(36)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (ok, msg) => {
  console.log((ok ? 'PASS: ' : 'FAIL: ') + msg)
  if (!ok) failed++
}

// ---------- a fake S3, path-style, just enough of the protocol ----------
const s3 = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const parts = url.pathname.slice(1).split('/')
  const bucket = parts.shift()
  const key = decodeURIComponent(parts.join('/'))
  if (bucket !== BUCKET) return res.writeHead(404).end()

  if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
    const prefix = url.searchParams.get('prefix') || ''
    const keys = [...objects.keys()].filter((k) => k.startsWith(prefix))
    const contents = keys
      .map(
        (k) =>
          `<Contents><Key>${k}</Key><Size>${objects.get(k).length}</Size>` +
          `<LastModified>2026-07-09T00:00:00.000Z</LastModified><ETag>&quot;e&quot;</ETag></Contents>`
      )
      .join('')
    return res
      .writeHead(200, { 'Content-Type': 'application/xml' })
      .end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>${BUCKET}</Name><Prefix>${prefix}</Prefix><KeyCount>${keys.length}</KeyCount>` +
          `<MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
      )
  }
  if (req.method === 'PUT') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      objects.set(key, Buffer.concat(chunks))
      res.writeHead(200, { ETag: '"e"' }).end()
    })
    return
  }
  if (req.method === 'GET') {
    const buf = objects.get(key)
    if (!buf) return res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>')
    return res.writeHead(200, { 'Content-Length': buf.length }).end(buf)
  }
  if (req.method === 'DELETE') {
    objects.delete(key)
    return res.writeHead(204).end()
  }
  res.writeHead(405).end()
})
await new Promise((r) => s3.listen(0, r))
const s3Port = s3.address().port

const freePort = () =>
  new Promise((r) => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const p = srv.address().port
      srv.close(() => r(p))
    })
  })

// a real jpeg's opening bytes — magicOk() checks the signature, not the header
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 7)])

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'author-e2e-'))
fs.mkdirSync(path.join(cwd, 'data'), { recursive: true })
const ROOT = process.cwd()
const env = {
  ...process.env,
  BETTER_AUTH_SECRET: 'e2e-secret-0123456789abcdef0123456789',
  BUCKET_NAME: BUCKET,
  AWS_ENDPOINT_URL_S3: `http://127.0.0.1:${s3Port}`,
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_REGION: 'auto',
}

async function boot() {
  const port = await freePort()
  const child = spawn('node', [path.join(ROOT, 'server/index.js')], {
    cwd,
    env: { ...env, PORT: String(port), BETTER_AUTH_URL: `http://localhost:${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = []
  child.stdout.on('data', (d) => log.push(String(d)))
  child.stderr.on('data', (d) => log.push(String(d)))
  for (let i = 0; i < 80; i++) {
    if (log.join('').includes('listening')) break
    await sleep(250)
  }
  if (!log.join('').includes('listening')) {
    console.error(log.join(''))
    throw new Error('server never came up')
  }
  return { child, base: `http://localhost:${port}`, log }
}

const { child, base } = await boot()
const cookieOf = (r) => (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')

const signup = await fetch(`${base}/api/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ email: `img-${run}@test.local`, password: 'hunter22' }),
})
if (!signup.ok) throw new Error(`signup: ${signup.status} ${await signup.text()}`)
const cookie = cookieOf(signup)

const doc = await (
  await fetch(`${base}/api/docs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
    body: JSON.stringify({ title: 'image test' }),
  })
).json()

// ---------- 1. write-through: the copy exists before the writer has the url ----------
const up = await fetch(`${base}/api/docs/${doc.id}/header`, {
  method: 'POST',
  headers: { 'Content-Type': 'image/jpeg', Origin: base, Cookie: cookie },
  body: JPEG,
})
const { url } = await up.json()
const name = path.basename(url || '')

check(up.ok && /^\/files\/[a-f0-9]{24}\.jpg$/.test(url), 'the upload returned a /files url')
check(objects.has('uploads/' + name), 'the picture was in the bucket by the time the url came back')
check(
  Buffer.compare(objects.get('uploads/' + name) ?? Buffer.alloc(0), JPEG) === 0,
  'the bucket holds the very bytes that were uploaded'
)
check(fs.existsSync(path.join(cwd, 'data', 'uploads', name)), 'and it is on the volume too')

// ---------- 2. the copy leaves with the page ----------
await fetch(`${base}/api/docs/${doc.id}/header`, {
  method: 'DELETE',
  headers: { Origin: base, Cookie: cookie },
})
await sleep(500) // the bucket delete is fire-and-forget
check(!objects.has('uploads/' + name), 'removing the header took the bucket copy with it')

child.kill()
await sleep(400)

// ---------- 3. an empty volume is refilled before the door opens ----------
const orphanName = 'f'.repeat(24) + '.jpg'
objects.set('uploads/' + orphanName, JPEG)
fs.rmSync(path.join(cwd, 'data', 'uploads'), { recursive: true, force: true })

await new Promise((resolve, reject) => {
  const r = spawn('node', [path.join(ROOT, 'scripts/restore-images.mjs')], { cwd, env, stdio: 'inherit' })
  r.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('restore exited ' + code))))
})
check(
  fs.existsSync(path.join(cwd, 'data', 'uploads', orphanName)),
  'the boot restore pulled the picture back onto an empty volume'
)

// ---------- 4. no bucket configured: the restore is a quiet no-op, never fatal ----------
await new Promise((resolve, reject) => {
  const bare = { ...process.env, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET }
  delete bare.BUCKET_NAME
  delete bare.AWS_ENDPOINT_URL_S3
  const r = spawn('node', [path.join(ROOT, 'scripts/restore-images.mjs')], { cwd, env: bare, stdio: 'ignore' })
  r.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('bare restore exited ' + code))))
})
check(true, 'with no bucket configured the restore exits 0 and blocks nothing')

s3.close()
fs.rmSync(cwd, { recursive: true, force: true })
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
