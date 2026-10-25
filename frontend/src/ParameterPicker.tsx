import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import { filterParameters, type ParameterOption } from './parameterSearch'
import { parameterPickerLayout } from './parameterPickerLayout'
import './ParameterPicker.css'

export function ParameterPicker({ label, value, options, onChange, className = '', hideLabel = false }: {
  label: string
  value: string
  options: ParameterOption[]
  onChange: (value: string) => void
  className?: string
  hideLabel?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const filtered = filterParameters(options, query)
  const activeIndex = Math.max(0, Math.min(active, filtered.length - 1))
  const selected = options.find(option => option.value === value)

  useLayoutEffect(() => {
    if (!open) return
    function position() {
      if (!trigger.current || !wrapper.current) return
      const viewport = window.visualViewport
      const bounds = parameterPickerLayout(trigger.current.getBoundingClientRect(), {
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      })
      const parent = wrapper.current.getBoundingClientRect()
      setPanelStyle({ left: bounds.left - parent.left, top: bounds.top - parent.top,
        right: 'auto', width: bounds.width, height: bounds.height })
    }
    position()
    input.current?.focus({ preventScroll: true })
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open])
  useEffect(() => {
    if (!open || !list.current) return
    const option = list.current.children[activeIndex] as HTMLElement | undefined
    if (!option) return
    // Scroll ONLY the option list, never all scrollable ancestors/page.
    const container = list.current.getBoundingClientRect()
    const item = option.getBoundingClientRect()
    if (item.top < container.top) list.current.scrollTop -= container.top - item.top
    else if (item.bottom > container.bottom) list.current.scrollTop += item.bottom - container.bottom
  }, [open, activeIndex, query])

  function choose(option: ParameterOption) {
    onChange(option.value)
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  return <div ref={wrapper} className={`parameter-picker page-select compact-select ${className}`} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <span id={`${id}-label`} className={hideLabel ? 'sr-only' : undefined}>{label}</span>
    <button ref={trigger} type="button" className="parameter-picker-trigger"
      aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open}
      aria-haspopup="dialog" aria-controls={open ? `${id}-panel` : undefined}
      onClick={() => { setQuery(''); setActive(0); setOpen(!open) }}>
      <span id={`${id}-value`}>{selected?.label ?? 'Pilih parameter'}</span>
      <ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && <div id={`${id}-panel`} style={panelStyle} className="parameter-picker-panel" role="dialog" aria-labelledby={`${id}-label`}>
      <input ref={input} type="search" role="combobox" autoComplete="off"
        aria-label={`Cari ${label.toLowerCase()}`} placeholder="Cari: air, jarak, pupuk…"
        aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`}
        aria-activedescendant={filtered.length ? `${id}-option-${activeIndex}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus({ preventScroll: true }) }
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(activeIndex + 1, filtered.length - 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(activeIndex - 1, 0)) }
          if (event.key === 'Enter') { event.preventDefault(); if (filtered[activeIndex]) choose(filtered[activeIndex]) }
        }}/>
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} className="parameter-picker-options">
        {filtered.map((option, index) => <div key={option.value} id={`${id}-option-${index}`}
          role="option" aria-selected={option.value === value}
          className={index === activeIndex ? 'is-active' : undefined}
          onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}>
          <span>{option.label}</span>
          {option.group && <small>{option.group}</small>}
        </div>)}
      </div>
      {filtered.length === 0 && <p className="parameter-picker-empty" role="status">Parameter tidak ditemukan.</p>}
    </div>}
  </div>
}
