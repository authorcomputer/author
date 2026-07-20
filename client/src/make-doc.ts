import StarterKit from '@tiptap/starter-kit'
import TiptapLink from '@tiptap/extension-link'
import { getSchema } from '@tiptap/core'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { prosemirrorJSONToYDoc } from 'y-prosemirror'
import { api, localDay } from './api'
import { CommentMark } from './comment-mark'

// a page minted from plain text: paragraphs in, a live yjs doc out — the
// same road the markdown importer drives, without the markdown. cleans up
// its own half-made page if the road washes out.
const EXTENSIONS = [StarterKit, TiptapLink, CommentMark]
const schema = getSchema(EXTENSIONS)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function docFromText(title: string, text: string): Promise<string> {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const json = {
    type: 'doc',
    content: lines.length
      ? lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }))
      : [{ type: 'paragraph' }],
  }
  const update = Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(schema, json, 'default'))

  const { id } = await api('/api/docs', { method: 'POST', body: JSON.stringify({ title }) })
  const ydoc = new Y.Doc()
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const provider = new WebsocketProvider(`${proto}//${location.host}/ws`, id, ydoc)
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sync timeout')), 10000)
      provider.once('sync', () => {
        clearTimeout(t)
        resolve()
      })
    })
    Y.applyUpdate(ydoc, update)
    ydoc.getMap('meta').set('title', title)
    await api(`/api/docs/${id}/html`, {
      method: 'POST',
      body: JSON.stringify({
        html: lines.map((l) => `<p>${esc(l)}</p>`).join(''),
        day: localDay(),
      }),
    })
    // give the websocket a beat to flush before tearing down
    await new Promise((r) => setTimeout(r, 400))
  } catch (e) {
    await api(`/api/docs/${id}`, { method: 'DELETE' }).catch(() => {})
    throw e
  } finally {
    provider.destroy()
    ydoc.destroy()
  }
  return id
}
