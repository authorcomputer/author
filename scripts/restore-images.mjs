// Boot, before the door opens: fetch any picture the volume is missing.
// litestream already restored the words; a page whose image is still in
// flight renders a broken frame, so this one waits.
//
// It must never keep the server down. A bucket that is unreachable,
// misconfigured, or empty costs us pictures, not the app — so every failure
// here is said out loud and then forgiven.
import path from 'node:path'
import { pullMissing, imagesReplicated } from '../server/images.js'

const uploadsDir = path.join(process.cwd(), 'data', 'uploads')

if (!imagesReplicated()) {
  console.log('images: no bucket configured — skipping restore')
  process.exit(0)
}

try {
  const started = Date.now()
  const { downloaded, failed } = await pullMissing(uploadsDir)
  const took = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`images: restored ${downloaded}, failed ${failed}, in ${took}s`)
} catch (e) {
  console.error('images: restore swept aside —', e.message)
}
process.exit(0)
