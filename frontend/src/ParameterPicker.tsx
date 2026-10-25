import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { filterParameters, type ParameterOption } from './parameterSearch'
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
  const filtered = filterParameters(options, query)
  const activeIndex = Math.max(0, Math.min(active, filtered.length - 1))
  const selected = options.find(option => option.value === value)

  useEffect(() => { if (open) input.current?.focus() }, [open])
  useEffect(() => {
    if (open) list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, query])

  function choose(option: ParameterOption) {
    onChange(option.value)
    setOpen(false)
    trigger.current?.focus()
  }

  return <div className={`parameter-picker page-select compact-select ${className}`} onBlur={event => {
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
    {open && <div id={`${id}-panel`} className="parameter-picker-panel" role="dialog" aria-labelledby={`${id}-label`}>
      <input ref={input} type="search" role="combobox" autoComplete="off"
        aria-label={`Cari ${label.toLowerCase()}`} placeholder="Cari: air, jarak, pupuk…"
        aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-list`}
        aria-activedescendant={filtered.length ? `${id}-option-${activeIndex}` : undefined}
        value={query} onChange={event => { setQuery(event.target.value); setActive(0) }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
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
