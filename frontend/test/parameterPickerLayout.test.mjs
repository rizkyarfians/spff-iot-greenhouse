import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parameterPickerLayout } from '../src/parameterPickerLayout.ts'

test('picker opens below the trigger when enough room is available', () => {
  const result = parameterPickerLayout({ left: 140, right: 340, top: 60, bottom: 90 }, { width: 800, height: 700 })
  assert.equal(result.top, 96)
  assert.equal(result.height, 300)
})

test('picker opens upward near the bottom instead of overflowing the page', () => {
  const result = parameterPickerLayout({ left: 140, right: 340, top: 360, bottom: 390 }, { width: 800, height: 500 })
  assert.equal(result.top + result.height, 354)
})

test('a wider panel stays aligned with the trigger beside the sidebar', () => {
  const viewport = { width: 1920, height: 920 }
  const result = parameterPickerLayout({ left: 325, right: 576, top: 640, bottom: 685 }, viewport)
  assert.equal(result.left, 325)
  assert.equal(result.width, 320)

  const rightEdge = parameterPickerLayout({ left: 1690, right: 1880, top: 640, bottom: 685 }, viewport)
  assert.equal(rightEdge.left + rightEdge.width, viewport.width - 8)
})

test('picker remains within narrow, short and keyboard-offset visual viewports', () => {
  for (const viewport of [
    { width: 320, height: 400 },
    { width: 390, height: 170, top: 200 },
    { width: 260, height: 100 },
  ]) {
    const result = parameterPickerLayout({ left: 10, right: 150, top: 250, bottom: 290 }, viewport)
    assert.ok(result.left >= (viewport.left ?? 0) + 8)
    assert.ok(result.left + result.width <= (viewport.left ?? 0) + viewport.width - 8)
    assert.ok(result.top >= (viewport.top ?? 0) + 8)
    assert.ok(result.top + result.height <= (viewport.top ?? 0) + viewport.height - 8)
  }
})

test('keyboard navigation never requests scrolling the whole page', () => {
  const source = readFileSync(new URL('../src/ParameterPicker.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /scrollIntoView/)
  assert.match(source, /list\.current\.scrollTop/)
  assert.match(source, /focus\(\{ preventScroll: true \}\)/)
  assert.match(source, /visualViewport/)
})
