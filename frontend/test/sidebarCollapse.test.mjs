import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/ResponsiveLayout.css', import.meta.url), 'utf8')

test('desktop sidebar has reversible accessible controls and a persisted preference', () => {
  assert.match(app, /localStorage.getItem\('spff-sidebar-collapsed'\)/)
  assert.match(app, /localStorage.setItem\('spff-sidebar-collapsed', String\(sidebarCollapsed\)\)/)
  assert.match(app, /aria-expanded=\{!sidebarCollapsed\} aria-controls="main-sidebar"/)
  assert.match(app, /setSidebarCollapsed\(value => !value\)/)
  assert.match(app, /aria-label=\{item.label\}/)
  assert.match(app, /title=\{sidebarCollapsed \? item.label : undefined\}/)
})

test('collapsed layout is limited to desktop and changes the shared sidebar width', () => {
  assert.match(css, /\.sidebar-collapse-button \{ display: none; \}/)
  assert.match(css, /@media \(min-width: 1280px\) \{\s*\.sidebar-collapse-button/)
  assert.match(css, /\.app-shell.sidebar-is-collapsed \{ --desktop-sidebar: 76px; \}/)
  assert.match(css, /\.sidebar-is-collapsed \.drawer-nav-label/)
})
