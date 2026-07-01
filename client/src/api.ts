import { authClient } from './auth-client'

// Sessions live in an httpOnly cookie (better-auth). We keep a small local
// mirror of who's signed in so route guards can be synchronous.
export type Me = { username: string; anon: boolean }

// bearer-token era debris — remove once, harmless if absent
localStorage.removeItem('author.token')
localStorage.removeItem('author.username')

export function me(): Me | null {
  try {
    return JSON.parse(localStorage.getItem('author.me') || 'null')
  } catch {
    return null
  }
}
export function setMe(m: Me | null) {
  if (m) localStorage.setItem('author.me', JSON.stringify(m))
  else localStorage.removeItem('author.me')
}
export function username(): string | null {
  return me()?.username ?? null
}
export async function refreshMe(): Promise<Me | null> {
  try {
    const r = await fetch('/api/me')
    if (!r.ok) {
      setMe(null)
      return null
    }
    const m = await r.json()
    setMe({ username: m.username, anon: !!m.anon })
    return me()
  } catch {
    return me()
  }
}
export async function signOut() {
  await authClient.signOut().catch(() => {})
  setMe(null)
}

export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

export async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (res.status === 401) {
    setMe(null)
    if (!location.pathname.startsWith('/login')) {
      const dest = location.pathname + location.search
      location.href = `/login?next=${encodeURIComponent(dest)}`
    }
    throw new ApiError('signed out')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(
      (body as any).error || `request failed (${res.status})`,
      (body as any).code
    )
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new ApiError(
      (errBody as any).error || `request failed (${res.status})`,
      (errBody as any).code
    )
  }
  if (!res.body) throw new ApiError('no response body')
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
