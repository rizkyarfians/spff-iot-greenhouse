import { useState, type PointerEvent, type KeyboardEvent } from 'react'
import type { ApiHistoryPoint } from '@spff/contracts'
import './ChartHover.css'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 })
const date = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
})

/** Uses the SVG transform so pointer positions also work in letterboxed charts. */
export function ChartHover({ data, points, unit, label, plotBottom }: {
  data: ApiHistoryPoint[]
  points: { x: number; y: number }[]
  unit: string
  label: string
  plotBottom: number
}) {
  const [selection, setSelection] = useState<{ data: ApiHistoryPoint[]; index: number }>()
  const index = selection?.data === data ? selection.index : undefined
  const selected = index === undefined ? undefined : data[index]
  const point = index === undefined ? undefined : points[index]

  function move(event: PointerEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement
    const transform = svg?.getScreenCTM()
    if (!svg || !transform || !points.length) return
    const cursor = svg.createSVGPoint()
    cursor.x = event.clientX
    cursor.y = event.clientY
    const x = cursor.matrixTransform(transform.inverse()).x
    let nearest = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - x) < Math.abs(points[nearest].x - x)) nearest = i
    }
    if (index !== nearest) setSelection({ data, index: nearest })
  }

  function keyboard(event: KeyboardEvent<SVGRectElement>) {
    if (event.key === 'Escape') { setSelection(undefined); return }
    const next = event.key === 'ArrowRight' ? Math.min((index ?? -1) + 1, data.length - 1)
      : event.key === 'ArrowLeft' ? Math.max((index ?? 1) - 1, 0)
      : event.key === 'Home' ? 0 : event.key === 'End' ? data.length - 1 : null
    if (next === null) return
    event.preventDefault()
    setSelection({ data, index: next })
  }

  return <g className="history-hover">
    {selected && point && <g pointerEvents="none">
      <line className="history-hover-guide" x1={point.x} x2={point.x} y1={12} y2={plotBottom}/>
      <circle className="history-hover-point" cx={point.x} cy={point.y} r={5}/>
      <foreignObject x={Math.max(8, Math.min(point.x - 116, 520))} y={6} width={232} height={124}>
        <div className="history-hover-tooltip" role="status">
          <span>{date.format(new Date(selected.recordedAt))} WIB</span>
          <strong>{number.format(selected.average)} {unit}</strong>
          <span>Rata-rata · {selected.samples} sampel</span>
          <span>Min {number.format(selected.min)} · Maks {number.format(selected.max)} {unit}</span>
        </div>
      </foreignObject>
    </g>}
    <rect x={28} y={0} width={704} height={plotBottom} fill="transparent"
      tabIndex={0} role="group"
      aria-label={`${label}. Gunakan panah kiri dan kanan untuk melihat nilai, Escape untuk menutup.`}
      onPointerMove={move} onPointerDown={move}
      onPointerLeave={event => { if (event.pointerType === 'mouse') setSelection(undefined) }}
      onFocus={() => { if (data.length) setSelection({ data, index: data.length - 1 }) }}
      onBlur={() => setSelection(undefined)} onKeyDown={keyboard}/>
  </g>
}
