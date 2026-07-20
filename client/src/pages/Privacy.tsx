import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { me } from '../api'
import Logo from '../Logo'
import { attachSelectionInk } from '../highlight-ink'

export default function Privacy() {
  useEffect(() => attachSelectionInk(), [])
  return (
    <>
      <div className="pub-head">
        <Link to="/" title="author*">
          <Logo />
        </Link>
        <div className="spacer" />
        {me() && !me()!.anon ? (
          <Link to="/">[ your desk ]</Link>
        ) : (
          <Link to="/login">[ sign in &amp; write ]</Link>
        )}
      </div>
      <div className="pub-wrap">
        <h1 className="pub-title">privacy</h1>
        <div className="faint">plain language, the whole picture. last updated july 20, 2026.</div>
        <div className="ascii-rule" style={{ margin: '8px 0 28px' }}>
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        </div>
        <div className="pub-body">
          <h2>what we keep</h2>
          <p>
            <strong>Your account:</strong> an email address, a handle, and a password
            (stored hashed with bcrypt — we can't read it). Ghost sessions have none of
            these; a ghost who never takes a desk is swept, pages and all, after two
            weeks of quiet.
          </p>
          <p>
            <strong>Your writing:</strong> your pages, comments, versions, and header
            images — stored on an encrypted disk so the app can do its job. Private by
            default: only people you hand a writing link to can see a draft, and only
            pages you explicitly publish are public. Your profile page is off unless you
            turn it on.
          </p>
          <p>
            <strong>Usage counts:</strong> how many model requests you've made (to
            enforce the free allowance) and which days you wrote (for your contribution
            chart — shown publicly only if your profile is public).
          </p>
          <p>
            <strong>Your readers' addresses:</strong> if you open your letterbox,
            readers can leave an email address to receive your published pieces as
            letters. Each address is confirmed by the reader before it counts, is used
            only to send that one writer's letters, and is deleted the moment it
            unsubscribes — one click, at the bottom of every letter.
          </p>
          <h2>the model</h2>
          <p>
            When you invoke <em>ask</em>, <em>proof</em>, or ⌘K, the
            relevant draft text is sent to Anthropic's API to produce the response, and
            never otherwise. We don't train anything on your writing. Anthropic's own
            data handling is governed by{' '}
            <a
              href="https://www.anthropic.com/legal/privacy"
              target="_blank"
              rel="noreferrer"
              style={{ borderBottom: '1px dotted' }}
            >
              their privacy policy
            </a>
            .
          </p>
          <h2>the post office</h2>
          <p>
            Letters — subscription confirmations and pieces you post — are delivered
            through{' '}
            <a
              href="https://resend.com/legal/privacy-policy"
              target="_blank"
              rel="noreferrer"
              style={{ borderBottom: '1px dotted' }}
            >
              Resend
            </a>
            , an email delivery service: the reader's address and the letter itself
            pass through them to be sent, and never otherwise.
          </p>
          <h2>machine keys</h2>
          <p>
            You can mint an API key in settings that lets a machine — Claude, or any
            MCP client — sit at your desk: list and read your drafts and their
            comments, and start new pages. Keys are stored hashed (we can't read them
            either), shown to you once, and revocable in settings at any time. Until
            you mint one, no machine door exists for your account.
          </p>
          <h2>analytics</h2>
          <p>
            We use Seline, a cookie-free analytics service: page views and product
            events (like "someone ran the proof"), no advertising identifiers, no
            cross-site tracking. Editor page addresses are masked in your browser
            before anything is sent, and we never send your email anywhere.
          </p>
          <h2>cookies</h2>
          <p>
            Exactly one, and it's load-bearing: an httpOnly session cookie that keeps
            you signed in. No tracking cookies.
          </p>
          <h2>where it lives</h2>
          <p>
            On Fly.io infrastructure in the United States, encrypted at rest, with
            daily snapshots kept for five days. The database and your images are also
            continuously replicated to S3-compatible object storage (Tigris, on Fly),
            so a lost disk doesn't mean lost writing.
          </p>
          <h2>deleting things</h2>
          <p>
            Delete any page from your desk at any moment — it's gone, along with its
            comments and versions. For full account deletion, email{' '}
            <a
              href="mailto:author@dutilh.net?subject=delete%20my%20account"
              style={{ borderBottom: '1px dotted' }}
            >
              author@dutilh.net
            </a>{' '}
            and it'll be done within a few days.
          </p>
          <h2>questions</h2>
          <p>
            <a href="mailto:author@dutilh.net" style={{ borderBottom: '1px dotted' }}>
              author@dutilh.net
            </a>{' '}
            — a person reads it.
          </p>
        </div>
        <div className="pub-foot">
          ✽{' '}
          <Link to="/terms" style={{ borderBottom: '1px dotted' }}>
            terms
          </Link>{' '}
          ·{' '}
          <Link to="/" style={{ borderBottom: '1px dotted' }}>
            author*
          </Link>
        </div>
      </div>
    </>
  )
}
