// restoring a version replaces the live page, so the confirm dialog makes
// a promise first: "the current text is kept as its own version". that
// promise is the contract — the keep can fail (a deploy mid-restore, a
// page too big for the body limit), and a failed keep must stop the
// restore cold. overwriting the page after silently dropping the safety
// copy would lose everything since the last snapshot.
export type RestoreOutcome = 'restored' | 'keep failed' | 'stale format'

export async function keepThenRestore(steps: {
  // stored content is whatever shape its day wrote — apply is the judge
  fetchVersion: () => Promise<{ content: any }>
  keep: () => Promise<unknown>
  apply: (content: any) => void
}): Promise<RestoreOutcome> {
  const full = await steps.fetchVersion()
  try {
    await steps.keep()
  } catch {
    return 'keep failed'
  }
  try {
    steps.apply(full.content)
  } catch {
    return 'stale format'
  }
  return 'restored'
}
