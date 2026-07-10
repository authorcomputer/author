// The second copy (server/images.js), tested against a fake S3 that speaks
// just enough of the protocol: PUT, GET, DELETE, and a path-style
// ListObjectsV2. The SDK does the signing; this proves our logic —
// what we upload, what we fetch back, what we refuse to write, and that a
// bucket having a bad day never throws into the writer's face.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BUCKET = 'test-bucket'
const objects = new Map() // key -> Buffer
let failPuts = false // stays on: the sdk retries, so a one-shot 500 proves nothing
let listCalls = 0

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const parts = url.pathname.slice(1).split('/')
  const bucket = parts.shift()
  const key = decodeURIComponent(parts.join('/'))
  if (bucket !== BUCKET) {
    res.writeHead(404).end()
    return
  }

  if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
    listCalls++
    const prefix = url.searchParams.get('prefix') || ''
    const keys = [...objects.keys()].filter((k) => k.startsWith(prefix))
    const contents = keys
      .map(
        (k) =>
          `<Contents><Key>${xmlEscape(k)}</Key><Size>${objects.get(k).length}</Size>` +
          `<LastModified>2026-07-09T00:00:00.000Z</LastModified><ETag>&quot;e&quot;</ETag>` +
          `<StorageClass>STANDARD</StorageClass></Contents>`
      )
      .join('')
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
      `<Name>${BUCKET}</Name><Prefix>${xmlEscape(prefix)}</Prefix>` +
      `<KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>` +
      contents +
      `</ListBucketResult>`
    res.writeHead(200, { 'Content-Type': 'application/xml' }).end(body)
    return
  }

  if (req.method === 'PUT') {
    if (failPuts) {
      res.writeHead(500).end('<Error><Code>InternalError</Code></Error>')
      return
    }
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
    if (!buf) {
      res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>')
      return
    }
    res.writeHead(200, { 'Content-Length': buf.length }).end(buf)
    return
  }

  if (req.method === 'DELETE') {
    objects.delete(key)
    res.writeHead(204).end()
    return
  }
  res.writeHead(405).end()
})

await new Promise((r) => server.listen(0, r))
const port = server.address().port

process.env.BUCKET_NAME = BUCKET
process.env.AWS_ENDPOINT_URL_S3 = `http://127.0.0.1:${port}`
process.env.AWS_ACCESS_KEY_ID = 'test'
process.env.AWS_SECRET_ACCESS_KEY = 'test'
process.env.AWS_REGION = 'auto'

const { putImage, deleteImage, listImages, pullMissing, pushMissing, imagesReplicated } =
  await import('../server/images.js')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'))
const NAME_A = 'a'.repeat(24) + '.jpg'
const NAME_B = 'b'.repeat(24) + '.png'
const NAME_C = 'c'.repeat(24) + '.webp'

const ok = (label, cond) => {
  if (!cond) throw new Error(`FAIL: ${label}`)
  console.log(`PASS: ${label}`)
}

ok('replication is on when both env vars are set', imagesReplicated())

// ---------- upload ----------
ok('putImage uploads', await putImage(NAME_A, Buffer.from('alpha')))
ok('bucket holds the uploaded bytes', objects.get('uploads/' + NAME_A)?.toString() === 'alpha')
ok('uploaded under the uploads/ prefix, clear of author.db', [...objects.keys()].every((k) => k.startsWith('uploads/')))

// ---------- a bucket having a bad day never throws ----------
failPuts = true
const failed = await putImage(NAME_B, Buffer.from('bravo'))
ok('a persistently failing PUT returns false instead of throwing', failed === false)
ok('the failed upload left nothing in the bucket', !objects.has('uploads/' + NAME_B))
failPuts = false

// ---------- pull: fetch what the disk lacks ----------
objects.set('uploads/' + NAME_B, Buffer.from('bravo'))
const pulled = await pullMissing(dir)
ok('pullMissing downloaded both bucket objects', pulled.downloaded === 2 && pulled.failed === 0)
ok('pulled bytes land on disk intact', fs.readFileSync(path.join(dir, NAME_B), 'utf8') === 'bravo')
ok('no .part temp files survive', !fs.readdirSync(dir).some((f) => f.endsWith('.part')))

// ---------- pull is idempotent ----------
const again = await pullMissing(dir)
ok('a second pull downloads nothing', again.downloaded === 0)

// ---------- a hostile key never escapes the uploads dir ----------
const escapeKey = 'uploads/../../../../tmp/pwned-by-bucket.jpg'
objects.set(escapeKey, Buffer.from('pwn'))
objects.set('uploads/not-an-image.sh', Buffer.from('#!/bin/sh'))
const hostile = await pullMissing(dir)
ok('a traversing key is ignored, not written', hostile.downloaded === 0 && hostile.failed === 0)
ok('nothing was written outside the uploads dir', !fs.existsSync('/tmp/pwned-by-bucket.jpg'))
ok('a non-image key is ignored', !fs.existsSync(path.join(dir, 'not-an-image.sh')))
objects.delete(escapeKey)
objects.delete('uploads/not-an-image.sh')

// ---------- listImages only speaks of our own names ----------
const listed = await listImages()
ok('listImages returns exactly our two names', listed.size === 2 && listed.has(NAME_A) && listed.has(NAME_B))

// ---------- push: heal what an earlier upload failed to send ----------
fs.writeFileSync(path.join(dir, NAME_C), 'charlie')
const pushed = await pushMissing(dir)
ok('pushMissing uploads the disk-only file', pushed.uploaded === 1 && pushed.failed === 0)
ok('the healed file is in the bucket', objects.get('uploads/' + NAME_C)?.toString() === 'charlie')
const pushAgain = await pushMissing(dir)
ok('a second push uploads nothing', pushAgain.uploaded === 0)

// ---------- delete ----------
ok('deleteImage removes the copy', await deleteImage(NAME_A))
ok('the copy is gone from the bucket', !objects.has('uploads/' + NAME_A))
ok('deleteImage refuses a name that is not ours', (await deleteImage('../etc/passwd')) === false)

// ---------- switched off: every path is a quiet no-op ----------
delete process.env.BUCKET_NAME
ok('putImage is a no-op without a bucket', (await putImage(NAME_A, Buffer.from('x'))) === false)
ok('deleteImage is a no-op without a bucket', (await deleteImage(NAME_A)) === false)
ok('pullMissing is a no-op without a bucket', (await pullMissing(dir)).downloaded === 0)
ok('pushMissing is a no-op without a bucket', (await pushMissing(dir)).uploaded === 0)
ok('listImages is empty without a bucket', (await listImages()).size === 0)

fs.rmSync(dir, { recursive: true, force: true })
server.close()
console.log('\nALL PASS')
process.exit(0)
