type Anchor = { left: number; right: number; top: number; bottom: number }
type Viewport = { width: number; height: number; left?: number; top?: number }

export function parameterPickerLayout(anchor: Anchor, viewport: Viewport) {
  const margin = 8
  const gap = 6
  const x = viewport.left ?? 0
  const y = viewport.top ?? 0
  const width = Math.min(320, Math.max(0, viewport.width - margin * 2))
  const left = Math.max(x + margin, Math.min(anchor.right - width, x + viewport.width - margin - width))
  const below = Math.max(0, y + viewport.height - margin - anchor.bottom - gap)
  const above = Math.max(0, anchor.top - gap - y - margin)
  const upward = below < 300 && above > below
  const available = upward ? above : below
  if (available < 120) {
    // A short visual viewport (e.g. mobile keyboard) may need an overlay.
    const height = Math.min(300, Math.max(0, viewport.height - margin * 2))
    return { left, top: y + margin, width, height }
  }
  const height = Math.min(300, available, Math.max(0, viewport.height - margin * 2))
  const top = upward ? anchor.top - gap - height : anchor.bottom + gap
  return { left, top: Math.max(y + margin, Math.min(top, y + viewport.height - margin - height)), width, height }
}
