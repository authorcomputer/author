// the post office: everything that leaves author* as email goes through
// here. resend underneath; with no key configured every send is a dry run
// that logs instead — dev and the test suites never touch the wire, and a
// missing key can never fail a request that shouldn't depend on it.
// keys live in the environment only — this repo is public.

const KEY = process.env.RESEND_API_KEY
const FROM_DOMAIN = process.env.EMAIL_FROM || 'post@author.computer'

export const emailConfigured = () => !!KEY

// a display name rides in front of the fixed, verified address — the
// address proves the domain, the name says whose letter it is
const fromLine = (name) => `${String(name || 'author*').replace(/["<>]/g, '')} <${FROM_DOMAIN}>`

async function resend(path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`)
  return res.json()
}

// one email. `link` is the letter's primary url — dry runs log it so the
// flow stays walkable (and testable) without a key
export async function sendEmail({ to, fromName, subject, html, link, unsubUrl }) {
  if (!KEY) {
    console.log(
      `email (dry): to=${to} subject=${JSON.stringify(subject)} link=${link || ''} unsub=${unsubUrl || ''}`
    )
    return { dry: true }
  }
  return resend('/emails', {
    from: fromLine(fromName),
    to: [to],
    subject,
    html,
    ...(unsubUrl
      ? {
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
      : {}),
  })
}

// many letters, one per address (each carries its own unsubscribe key).
// resend's batch door takes 100 at a time; a beat between chunks stays
// under its rate limit. returns how many were accepted — a chunk that
// fails ends the walk without throwing, so the caller settles the ledger
// on what actually left, never on what was meant to.
export async function sendBatch(letters) {
  if (!KEY) {
    for (const l of letters)
      console.log(
        `email (dry): to=${l.to} subject=${JSON.stringify(l.subject)} link=${l.link || ''} unsub=${l.unsubUrl || ''}`
      )
    return letters.length
  }
  let sent = 0
  for (let i = 0; i < letters.length; i += 100) {
    const chunk = letters.slice(i, i + 100)
    if (i > 0) await new Promise((r) => setTimeout(r, 600))
    try {
      await sendChunk(chunk)
    } catch (e) {
      console.error('post stopped mid-walk', e)
      return sent
    }
    sent += chunk.length
  }
  return sent
}

function sendChunk(chunk) {
  return resend(
    '/emails/batch',
    chunk.map((l) => ({
        from: fromLine(l.fromName),
        to: [l.to],
        subject: l.subject,
        html: l.html,
        ...(l.unsubUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${l.unsubUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            }
          : {}),
      }))
  )
}
