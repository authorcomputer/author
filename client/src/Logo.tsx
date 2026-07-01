export default function Logo({ size = 18, word = false }: { size?: number; word?: boolean }) {
  return (
    <span className="logo" style={{ fontSize: size }}>
      {word ? 'author' : 'a'}
      <span className="accent">*</span>
    </span>
  )
}
