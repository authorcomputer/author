import { Link } from 'react-router-dom'
import { me } from '../api'
import Logo from '../Logo'

export default function Terms() {
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
        <h1 className="pub-title">terms</h1>
        <div className="faint">
          short, honest, written by the people who run it. last updated july 1, 2026.
        </div>
        <div className="ascii-rule" style={{ margin: '8px 0 28px' }}>
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        </div>
        <div className="pub-body">
          <h2>your writing is yours</h2>
          <p>
            We claim no ownership over anything you write here. You give us only the
            license needed to run the service: storing your pages, syncing them to your
            collaborators, rendering the ones you publish, and sending text to the
            model provider when you ask it to read. That's it.
          </p>
          <h2>the service</h2>
          <p>
            author* is a small, young product provided as-is. We work hard to keep it
            up and to keep your writing safe (encrypted disks, daily snapshots), but we
            can't promise perfection — export anything you can't afford to lose.
            Features, free-tier limits, and these terms may change; changes land on{' '}
            <Link to="/updates" style={{ borderBottom: '1px dotted' }}>
              updates
            </Link>{' '}
            and this page.
          </p>
          <h2>membership</h2>
          <p>
            The free desk includes a monthly allowance of model requests. Membership is
            $10/month for the full allowance, arranged by email — and cancelled the
            same way, any time, no questions.
          </p>
          <h2>house rules</h2>
          <p>
            Don't use author* for anything illegal, don't abuse shared links or other
            writers, and don't attack the service itself. We can remove content or
            close accounts that do — we'd rather never have to.
          </p>
          <h2>liability</h2>
          <p>
            To the maximum extent the law allows, our liability is limited to what
            you've paid us in the past twelve months. If something goes wrong, email us
            first —{' '}
            <a href="mailto:author@dutilh.net" style={{ borderBottom: '1px dotted' }}>
              author@dutilh.net
            </a>{' '}
            — nearly everything is fixable by two people talking.
          </p>
        </div>
        <div className="pub-foot">
          ✽{' '}
          <Link to="/privacy" style={{ borderBottom: '1px dotted' }}>
            privacy
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
