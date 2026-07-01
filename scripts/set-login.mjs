// Rename a user and/or set their password, updating display-name snapshots.
// Usage: node scripts/set-login.mjs <user-id-or-username> <new-name|-> [new-password]
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import path from 'node:path'

const [ident, newName, newPass] = process.argv.slice(2)
if (!ident) {
  console.error('usage: node scripts/set-login.mjs <id-or-username> <new-name|-> [new-password]')
  process.exit(1)
}
const db = new Database(process.env.AUTHOR_DB || path.join(process.cwd(), 'data', 'author.db'))
const user = db.prepare('SELECT * FROM users WHERE id = ? OR username = ?').get(ident, ident)
if (!user) {
  console.error('no such user:', ident)
  process.exit(1)
}
if (newName && newName !== '-' && newName !== user.username) {
  if (!/^[a-z0-9_-]{2,24}$/.test(newName)) {
    console.error('bad handle (2–24 of a-z 0-9 - _):', newName)
    process.exit(1)
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(newName)) {
    console.error('handle taken:', newName)
    process.exit(1)
  }
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newName, user.id)
  db.prepare('UPDATE comments SET username = ? WHERE user_id = ?').run(newName, user.id)
  db.prepare('UPDATE versions SET username = ? WHERE username = ?').run(newName, user.username)
  console.log(`renamed ${user.username} → ${newName}`)
}
if (newPass) {
  if (newPass.length < 6) {
    console.error('password too short (min 6)')
    process.exit(1)
  }
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(
    bcrypt.hashSync(newPass, 10),
    user.id
  )
  console.log('password set')
}
