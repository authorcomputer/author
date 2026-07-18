import { betterAuth } from 'better-auth'
import { anonymous, username } from 'better-auth/plugins'
import { getMigrations } from 'better-auth/db/migration'
import bcrypt from 'bcryptjs'
import { db } from './db.js'

export const TRUSTED_ORIGINS = [
  'http://localhost:3001',
  'https://author-computer.fly.dev',
  'https://author.computer',
  'https://www.author.computer',
]

// the address the server believes it lives at is trusted by definition —
// this is what lets test servers boot on whatever port happens to be free.
// normalized down to a real origin so a baseURL with a path still matches
// the browser's Origin header, and garbage never widens the allowlist
let selfUrl = null
try {
  selfUrl = new URL(process.env.BETTER_AUTH_URL || '')
} catch {}
if (selfUrl && selfUrl.origin !== 'null' && !TRUSTED_ORIGINS.includes(selfUrl.origin))
  TRUSTED_ORIGINS.push(selfUrl.origin)

const isProd = !!process.env.FLY_APP_NAME || process.env.NODE_ENV === 'production'
if (isProd && (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL)) {
  // never boot production on the dev secret or an http baseURL
  throw new Error('BETTER_AUTH_SECRET and BETTER_AUTH_URL must be set in production')
}
if (isProd && selfUrl?.protocol !== 'https:') {
  // judged on the parsed url, so odd casing or stray whitespace in a
  // genuinely-https secret can't crash-loop the boot — while a plain-http
  // baseURL, which would become a MITM-forgeable trusted origin, still does
  throw new Error('BETTER_AUTH_URL must be https in production')
}

// data a ghost produced follows them into their new account
const migrateGhostTx = db.transaction((fromId, toId) => {
  const newUser = db.prepare('SELECT username FROM user WHERE id = ?').get(toId)
  db.prepare('UPDATE docs SET owner_id = ? WHERE owner_id = ?').run(toId, fromId)
  db.prepare('UPDATE OR IGNORE collaborators SET user_id = ? WHERE user_id = ?').run(toId, fromId)
  db.prepare('DELETE FROM collaborators WHERE user_id = ?').run(fromId)
  db.prepare('UPDATE comments SET user_id = ?, username = ? WHERE user_id = ?').run(
    toId,
    newUser?.username || 'someone',
    fromId
  )
  for (const table of ['activity', 'ai_usage']) {
    for (const row of db.prepare(`SELECT day, count FROM ${table} WHERE user_id = ?`).all(fromId)) {
      db.prepare(
        `INSERT INTO ${table} (user_id, day, count) VALUES (?, ?, ?)
         ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count`
      ).run(toId, row.day, row.count)
    }
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(fromId)
  }
})

export function migrateGhost(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return
  migrateGhostTx(fromId, toId)
}

export const auth = betterAuth({
  database: db,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  secret: process.env.BETTER_AUTH_SECRET || 'author-dev-secret-not-for-production',
  trustedOrigins: TRUSTED_ORIGINS,
  session: {
    // ghosts have no way back in once their cookie dies — keep sessions long
    expiresIn: 60 * 60 * 24 * 60, // 60 days
    updateAge: 60 * 60 * 24, // rolled daily while in use
  },
  rateLimit: {
    enabled: true,
    customRules: {
      // ghost minting is free account creation — keep it slow
      '/sign-in/anonymous': { window: 3600, max: 20 },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    // keep bcrypt so accounts migrated from the old auth keep their hashes
    password: {
      hash: async (password) => bcrypt.hashSync(password, 10),
      verify: async ({ hash, password }) => bcrypt.compareSync(password, hash),
    },
  },
  plugins: [
    username({
      minUsernameLength: 2,
      maxUsernameLength: 24,
      usernameValidator: (u) => /^[a-z0-9_-]+$/.test(u),
    }),
    anonymous({
      emailDomainName: 'ghost.author.computer',
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const fromId = anonymousUser?.user?.id ?? anonymousUser?.id
        const toId = newUser?.user?.id ?? newUser?.id
        migrateGhost(fromId, toId)
      },
    }),
  ],
})

export async function runAuthMigrations() {
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

// bring accounts from the old hand-rolled `users` table into better-auth
export async function migrateLegacyUsers() {
  const legacy = db
    .prepare(
      `SELECT * FROM users WHERE id NOT IN (SELECT id FROM user)`
    )
    .all()
  if (legacy.length === 0) return
  const ctx = await auth.$context
  for (const u of legacy) {
    const email = u.email || `${u.username}@legacy.author.computer`
    const now = new Date()
    const created = await ctx.internalAdapter.createUser({
      id: u.id,
      name: u.username,
      email,
      emailVerified: false,
      username: u.username,
      displayUsername: u.username,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.internalAdapter.createAccount({
      userId: created.id,
      providerId: 'credential',
      accountId: created.id,
      password: u.password, // already bcrypt — verify() above understands it
      createdAt: now,
      updatedAt: now,
    })
    // carry profile fields over. the old "list published pieces" master
    // switch is dead — fold it here, at migration time, into the per-piece
    // choice: a legacy account that had it off gets every piece unlisted
    // before the server ever answers a request, so nothing they'd hidden is
    // served for even one boot. show_writing is stored as 1 and never read.
    if ((u.show_writing ?? 1) === 0) {
      db.prepare('UPDATE docs SET on_profile = 0 WHERE owner_id = ?').run(created.id)
    }
    db.prepare(
      `INSERT OR REPLACE INTO profiles (user_id, profile_public, show_writing, links)
       VALUES (?, ?, 1, ?)`
    ).run(created.id, u.profile_public || 0, u.links || '[]')
    console.log(`migrated legacy account: ${u.username}`)
  }
}
