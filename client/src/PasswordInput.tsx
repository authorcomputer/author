import { useState } from 'react'

// a password you can look at before you commit to it — a misspelled
// secret at the door is a locked room with no key. the toggle appears
// once there's something to show.
export default function PasswordInput({
  value,
  onChange,
  placeholder = 'password',
  autoFocus,
  autoComplete = 'current-password',
  inputStyle,
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  autoComplete?: string
  inputStyle?: React.CSSProperties
  style?: React.CSSProperties
}) {
  const [shown, setShown] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, ...style }}>
      <input
        style={{ flex: 1, minWidth: 0, ...inputStyle }}
        placeholder={placeholder}
        type={shown ? 'text' : 'password'}
        value={value}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="faint"
          tabIndex={-1}
          style={{ whiteSpace: 'nowrap' }}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'hide' : 'show'}
        </button>
      )}
    </div>
  )
}
