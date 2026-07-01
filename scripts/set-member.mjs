// Flip membership for a user. Usage: node scripts/set-member.mjs <username> <on|off>
import Database from 'better-sqlite3'
import path from 'node:path'

const [ident, state] = process.argv.slice(2)
if (!ident || !['on', 'off'].includes(state || '')) {
  console.error('usage: node scripts/set-member.mjs <username-or-id> <on|off>')
  process.exit(1)
}
const db = new Database(process.env.AUTHOR_DB || path.join(process.cwd(), 'data', 'author.db'))
const user = db.prepare('SELECT id, username FROM user WHERE username = ? OR id = ?').get(ident, ident)
if (!user) {
  console.error('no such user:', ident)
  process.exit(1)
}
db.prepare(
  `INSERT INTO profiles (user_id, member) VALUES (?, ?)
   ON CONFLICT(user_id) DO UPDATE SET member = excluded.member`
).run(user.id, state === 'on' ? 1 : 0)
console.log(`${user.username}: membership ${state}`)
