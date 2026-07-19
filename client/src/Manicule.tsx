// the pointing hand. the solid glyph carries the ink the outline one never
// had, but at UI sizes the fist swallows the finger — so every hand is set
// a step larger than its line, enough for the point to read as a point.
export default function Manicule({ left = false }: { left?: boolean }) {
  return <span className="manicule">{left ? '☚' : '☛'}</span>
}
