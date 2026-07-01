// Shown when a free account runs past its monthly model allowance.
export default function MembershipModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk account-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-head">the free ink ran out</div>
        <div className="hint" style={{ marginBottom: 14 }}>
          five requests a month are on the house. for the full desk — 150 a day —
          membership is <b>$10/mo</b>.
        </div>
        <div style={{ fontSize: 13 }}>
          email{' '}
          <a
            className="accent"
            href="mailto:author@dutilh.net?subject=author*%20membership"
            style={{ borderBottom: '1px dotted' }}
          >
            author@dutilh.net
          </a>{' '}
          and you'll be writing again within the day.
        </div>
        <div className="ai-actions" style={{ marginTop: 18 }}>
          <button className="faint" onClick={onClose}>
            back to the page
          </button>
        </div>
      </div>
    </div>
  )
}
