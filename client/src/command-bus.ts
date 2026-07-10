// ⌘K starts in the text and lands in the ask panel — this bus carries the
// stream between them, module-level on purpose: the panel mounts after the
// command starts. but a stream can outlive its page (navigating away
// destroys the editor while the model is still talking), and doc A's
// rewrite must never pop into doc B's panel — so every publish names the
// editor it was asked in, and a dead editor's stream goes nowhere.
export type CommandResult = {
  instruction: string
  range: { from: number; to: number } | null
  sourceText: string
  text: string
  running: boolean
}

type Receive = (r: CommandResult | null) => void

let receive: Receive | undefined

// the newest panel owns the bus; unlistening only lets go of your own hook
export function listenCommandResults(fn: Receive) {
  receive = fn
  return () => {
    if (receive === fn) receive = undefined
  }
}

export function publishCommandResult(
  editor: { isDestroyed: boolean },
  r: CommandResult | null
) {
  if (editor.isDestroyed) return
  receive?.(r)
}
