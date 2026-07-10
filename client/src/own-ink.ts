// tiptap's 'update' fires for every doc-changing transaction — a
// collaborator's afternoon of typing arrives through yjs and fires it on
// every open tab. anything that credits *this* viewer (the activity chart,
// the html snapshot) must first ask whose pen moved.
import type { Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from 'y-prosemirror'

// housekeeping transactions (mark sweeps) change the doc without anyone
// writing — dispatchers tag them with this meta so they don't count
export const PLUMBING = 'author:plumbing'

// the viewer's own pen: not a remote edit arriving over yjs, not the
// binding that pours the doc in on load, not tagged plumbing. undo/redo
// rides through yjs too but is still this person's hand.
export function isOwnInk(tr: Transaction): boolean {
  if (!tr.docChanged) return false
  if (tr.getMeta(PLUMBING)) return false
  const meta = tr.getMeta(ySyncPluginKey)
  if (!meta) return true
  return !!meta.isUndoRedoOperation && !meta.binding
}
