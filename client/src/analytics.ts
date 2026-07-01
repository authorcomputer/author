// Seline (seline.com) — lightweight, cookie-free analytics.
// Queue-safe wrapper: calls made before the async script loads are replayed
// by seline in {method, args} form. The queue stub lives here (not inline in
// index.html) so the content-security-policy needs no unsafe-inline scripts.
;(window as any).seline = (window as any).seline || { queue: [] }

function call(method: 'track' | 'setUser' | 'page', ...args: unknown[]) {
  const s = (window as any).seline
  if (!s) return
  if (typeof s[method] === 'function') s[method](...args)
  else if (Array.isArray(s.queue)) s.queue.push({ method, args })
}

export function track(name: string, data?: Record<string, unknown>) {
  call('track', name, data)
}

// no emails, no personal fields — just the internal id and handle
export function identify(fields: { userId: string; username?: string; ghost?: boolean }) {
  call('setUser', fields)
}
