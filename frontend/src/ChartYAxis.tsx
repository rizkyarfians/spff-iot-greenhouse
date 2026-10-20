import './ChartYAxis.css'

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2, notation: 'compact' })

export function ChartYAxis({ domain, width, bottom }: {
  domain: { min: number; max: number }; width: number; bottom: number
}) {
  return <g className="history-y-axis" pointerEvents="none" aria-label={`Skala ${domain.min} sampai ${domain.max}`}>
    {[0, 0.5, 1].map(fraction => {
      const value = domain.min + fraction * (domain.max - domain.min)
      const y = bottom - fraction * (bottom - 32)
      return <g key={fraction}>
        <line x1={56} x2={width - 28} y1={y} y2={y}/>
        <text x={46} y={y} textAnchor="end" dominantBaseline="middle">{number.format(value)}</text>
      </g>
    })}
  </g>
}
