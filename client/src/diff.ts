// block-level prose diff, for the history panel: what a sitting of writing
// actually changed, told as the blocks that left against the blocks that
// arrived. pure — a stored version's JSON in, rows out — so tests can walk
// it without an editor.

// every block of a stored snapshot as one line of text: paragraphs and
// headings whole, list items one by one, media as placeholders. inline
// marks vanish (they split words across text nodes); empty blocks are
// structure, not content, and don't count.
export function blockTexts(doc: any): string[] {
  const textOf = (n: any): string =>
    n.text ??
    (n.content || [])
      .map(textOf)
      .join(n.type === 'paragraph' || n.type === 'heading' ? '' : ' ')
  const out: string[] = []
  const push = (b: any) => {
    if (b.type === 'image') out.push('[ image ]')
    else if (b.type === 'embed') out.push('[ embed ]')
    else if (b.type === 'bulletList' || b.type === 'orderedList') {
      for (const li of b.content || []) {
        const t = textOf(li).trim()
        if (t) out.push('· ' + t)
      }
    } else {
      const t = textOf(b).trim()
      if (t) out.push(t)
    }
  }
  for (const b of doc?.content || []) push(b)
  return out
}

export type DiffRow = { kind: 'old' | 'new'; text: string }

// longest-common-subsequence over blocks: what's in `before` but not the
// common thread left; what's in `after` but not the common thread arrived.
// unchanged blocks stay out of the story. capped so a monstrous page can't
// freeze the panel — beyond the cap the tail is compared coarsely (equal or
// shown whole), which errs toward showing too much, never too little.
const CAP = 500
export function diffBlocks(before: string[], after: string[]): DiffRow[] {
  const a = before.slice(0, CAP)
  const b = after.slice(0, CAP)
  const n = a.length
  const m = b.length
  // dp[i][j] = lcs length of a[i:] vs b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'old', text: a[i++] })
    } else {
      rows.push({ kind: 'new', text: b[j++] })
    }
  }
  while (i < n) rows.push({ kind: 'old', text: a[i++] })
  while (j < m) rows.push({ kind: 'new', text: b[j++] })
  // past the cap: anything beyond is compared bluntly
  for (const t of before.slice(CAP)) if (!after.includes(t)) rows.push({ kind: 'old', text: t })
  for (const t of after.slice(CAP)) if (!before.includes(t)) rows.push({ kind: 'new', text: t })
  return rows
}
