export function token(): string | null {
  return localStorage.getItem('author.token')
}
export function username(): string | null {
  return localStorage.getItem('author.username')
}
export function setAuth(t: string, u: string) {
  localStorage.setItem('author.token', t)
  localStorage.setItem('author.username', u)
}
export function clearAuth() {
  localStorage.removeItem('author.token')
  localStorage.removeItem('author.username')
}

export async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(options.headers || {}),
    },
  })
  if (res.status === 401) {
    clearAuth()
    if (!location.pathname.startsWith('/login')) {
      const dest = location.pathname + location.search
      location.href = `/login?next=${encodeURIComponent(dest)}`
    }
    throw new Error('signed out')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error || `request failed (${res.status})`)
  }
  return res.json()
}

// POST that streams plain text back, invoking onChunk per delta.
export async function apiStream(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  signal?: AbortSignal
) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`request failed (${res.status})`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk(decoder.decode(value, { stream: true }))
  }
}

const PALETTE = ['#c2410c', '#0e7490', '#7c3aed', '#15803d', '#be185d', '#a16207']
export function colorFor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
  return PALETTE[h % PALETTE.length]
}
