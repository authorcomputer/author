import { useState } from 'react'
import { localDay } from './api'

export default function Chart({ activity }: { activity: { day: string; count: number }[] }) {
  const [hover, setHover] = useState<{ day: string; count: number } | null>(null)
  const byDay = new Map(activity.map((a) => [a.day, a.count]))
  const days: { day: string; count: number }[] = []
  // the grid runs on the viewer's calendar — "today" is their today, and
  // date arithmetic (not ms offsets) keeps DST from skipping a day
  const now = new Date()
  for (let i = 181; i >= 0; i--) {
    const key = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))
    days.push({ day: key, count: byDay.get(key) || 0 })
  }
  // pad to start on Sunday so columns are calendar weeks
  const pad = new Date(days[0].day + 'T00:00:00').getDay()
  const cells: ({ day: string; count: number } | null)[] = [...Array(pad).fill(null), ...days]
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const level = (c: number) => (c === 0 ? 0 : c < 3 ? 1 : c < 8 ? 2 : c < 15 ? 3 : 4)
  const daysWriting = days.filter((d) => d.count > 0).length
  const fmt = (day: string) =>
    new Date(day + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })

  return (
    <div className="contrib" onMouseLeave={() => setHover(null)}>
      <div className="contrib-grid">
        {weeks.map((week, w) => (
          <div className="contrib-col" key={w}>
            {week.map((c, d) => (
              <div
                key={d}
                className={`contrib-cell lv${c ? level(c.count) : 0} ${c ? '' : 'pad'} ${
                  hover && c && hover.day === c.day ? 'hovered' : ''
                }`}
                onMouseEnter={() => c && setHover(c)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="hint contrib-caption">
        {hover
          ? `${fmt(hover.day)} — ${hover.count === 0 ? 'a quiet day' : `wrote ${hover.count}×`}`
          : `${daysWriting} writing day${daysWriting === 1 ? '' : 's'} in the last six months`}
      </div>
    </div>
  )
}
