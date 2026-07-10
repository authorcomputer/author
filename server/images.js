// The volume is not a backup. author.db rides litestream to Tigris every
// second; the uploads beside it ride nothing, so a restored volume brings
// back every word pointing at pictures that no longer exist anywhere.
// This is the second copy.
//
// Best-effort on purpose: text is sacred, images are not. A bucket that is
// absent, misconfigured, or down must never fail a writer's upload, and
// must never keep the server from booting. Every path here swallows its
// errors, says so, and lets the page go on.
import fs from 'node:fs'
import path from 'node:path'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

// litestream owns author.db/ in this bucket; the uploads live beside it
const PREFIX = 'uploads/'

// the only names we ever wrote: 12 random bytes, one known extension. a key
// from the bucket is untrusted input — it decides a path on our disk
const NAME_RE = /^[a-f0-9]{24}\.(?:jpg|png|webp|gif)$/
const TYPE_OF = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }

export const imagesReplicated = () =>
  !!(process.env.BUCKET_NAME && process.env.AWS_ENDPOINT_URL_S3)

let client = null
function s3() {
  if (!client) {
    client = new S3Client({
      // tigris has one region and answers to 'auto'; credentials come from
      // the standard AWS_* env vars `fly storage create` set as secrets
      region: process.env.AWS_REGION || 'auto',
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      // a custom endpoint plus a bucket in the host confuses more s3 clones
      // than it pleases — keep the bucket in the path
      forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE !== '0',
    })
  }
  return client
}
const bucket = () => process.env.BUCKET_NAME

// one image up. the writer already has it on disk; a failure here costs a
// backup, not a picture, so it is logged and forgiven — the sweep will
// find it later.
export async function putImage(name, body) {
  if (!imagesReplicated() || !NAME_RE.test(name)) return false
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: PREFIX + name,
        Body: body,
        ContentType: TYPE_OF[name.split('.').pop()],
      })
    )
    return true
  } catch (e) {
    console.error('image backup failed', name, e.message)
    return false
  }
}

// the local file is gone and nothing else points at it — let the copy go too
export async function deleteImage(name) {
  if (!imagesReplicated() || !NAME_RE.test(name)) return false
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: PREFIX + name }))
    return true
  } catch (e) {
    console.error('image backup delete failed', name, e.message)
    return false
  }
}

// every name the bucket holds, paged. an unrecognizable key is not ours and
// is never spoken again
export async function listImages() {
  const names = new Set()
  if (!imagesReplicated()) return names
  let token
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, ContinuationToken: token })
    )
    for (const obj of page.Contents || []) {
      const name = (obj.Key || '').slice(PREFIX.length)
      if (NAME_RE.test(name)) names.add(name)
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return names
}

const localNames = (dir) => {
  try {
    return new Set(fs.readdirSync(dir).filter((n) => NAME_RE.test(n)))
  } catch {
    return new Set()
  }
}

// boot, on a volume that may have come back empty: fetch what the bucket has
// and the disk does not. this one blocks the server, because a page whose
// picture is still downloading renders a broken image.
export async function pullMissing(dir) {
  if (!imagesReplicated()) return { downloaded: 0, failed: 0 }
  fs.mkdirSync(dir, { recursive: true })
  const here = localNames(dir)
  let downloaded = 0
  let failed = 0
  for (const name of await listImages()) {
    if (here.has(name)) continue
    try {
      const res = await s3().send(
        new GetObjectCommand({ Bucket: bucket(), Key: PREFIX + name })
      )
      // NAME_RE already refused anything with a slash or a dot-dot, so the
      // join cannot climb out of the uploads dir
      const tmp = path.join(dir, `.${name}.part`)
      await fs.promises.writeFile(tmp, await res.Body.transformToByteArray())
      await fs.promises.rename(tmp, path.join(dir, name))
      downloaded++
    } catch (e) {
      console.error('image restore failed', name, e.message)
      failed++
    }
  }
  return { downloaded, failed }
}

// the other direction, for whatever an earlier upload failed to send: push
// what the disk has and the bucket does not. runs off the boot path and on
// a slow timer, so a bucket that was down for an hour heals itself.
export async function pushMissing(dir) {
  if (!imagesReplicated()) return { uploaded: 0, failed: 0 }
  const there = await listImages()
  let uploaded = 0
  let failed = 0
  for (const name of localNames(dir)) {
    if (there.has(name)) continue
    const ok = await putImage(name, await fs.promises.readFile(path.join(dir, name)))
    ok ? uploaded++ : failed++
  }
  return { uploaded, failed }
}
