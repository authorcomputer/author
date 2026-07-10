// Two doors into an account, both must hold. A session alone must not be
// enough to rewrite the password — a borrowed browser would turn a visit
// into a takeover with no reset flow to undo it. And the signup desk must
// not whisper which addresses already live here — a 409 that says "taken"
// is an oracle for anyone with a list of emails.
const BASE = process.env.AUTHOR_BASE || 'http://localhost:3001'
const run = Date.now().toString(36)

const cookieOf = (res) => (res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ')
async function post(path, body, cookie) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}
async function signIn(email, password) {
  return post('/api/auth/sign-in/email', { email, password })
}

const email = `hardening-${run}@test.local`
const firstPw = 'first-word'
const secondPw = 'second-word'

const up = await post('/api/signup', { email, password: firstPw })
if (!up.ok) throw new Error(`signup: ${up.status} ${await up.text()}`)
const cookie = cookieOf(up)

// a bare session may not move the lock
const bare = await post('/api/password', { password: 'stolen-word' }, cookie)
if (bare.ok)
  throw new Error('FAIL: /api/password accepted a new password with no current password')
console.log(`PASS: password change without the current password is refused (${bare.status})`)

const wrong = await post('/api/password', { current: 'not-the-word', password: 'stolen-word' }, cookie)
if (wrong.ok) throw new Error('FAIL: /api/password accepted a wrong current password')
console.log(`PASS: a wrong current password is refused (${wrong.status})`)

// and a refused attempt must leave the old password standing
const still = await signIn(email, firstPw)
if (!still.ok) throw new Error(`FAIL: original password no longer signs in (${still.status})`)
console.log('PASS: refused attempts leave the original password intact')

// the owner, holding the old word, may set a new one
const good = await post('/api/password', { current: firstPw, password: secondPw }, cookie)
if (!good.ok) throw new Error(`FAIL: legitimate change refused: ${good.status} ${await good.text()}`)
const fresh = await signIn(email, secondPw)
if (!fresh.ok) throw new Error(`FAIL: new password does not sign in (${fresh.status})`)
const stale = await signIn(email, firstPw)
if (stale.ok) throw new Error('FAIL: old password still signs in after the change')
console.log('PASS: with the current password, the change lands and the old word dies')

// signing up with a taken address must not say so
const again = await post('/api/signup', { email, password: 'whatever-word' })
if (again.ok) throw new Error('FAIL: duplicate signup succeeded outright')
if (again.status === 409) throw new Error('FAIL: duplicate signup answers 409 — a distinct tell')
const tell = ((await again.json()).error || '').toLowerCase()
if (/already|exists|has a desk|taken|registered/.test(tell))
  throw new Error(`FAIL: duplicate signup names the address as known: "${tell}"`)
console.log(`PASS: a taken address gets the same flat no as any other stumble (${again.status})`)

console.log('ALL PASS')
process.exit(0)
