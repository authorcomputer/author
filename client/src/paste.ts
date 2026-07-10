// would the default paste keep anything? tiptap parses text/html whenever
// the clipboard offers it, and the schema only recognizes /files/ images —
// so "copy image" on a web page (an external <img>, not a word of text)
// pastes as nothing at all. when nothing would survive, the caller should
// hand the clipboard's image *file* to the uploader instead.
export function defaultPasteKeeps(html: string, plain: string): boolean {
  if (!html) return !!plain.trim()
  // an image we already host parses fine — repasting one is a real paste
  if (/<img[^>]*\ssrc="\/files\//i.test(html)) return true
  // entities are left standing: anything that might read as a character
  // should defer to the default paste, not eat it
  const words = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim()
  return !!words
}
