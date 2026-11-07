import type {ButtonHTMLAttributes} from 'react'
import './SettingsWorkspace.css'

/** Keep each control's existing confirmation, pending state, and command handler. */
export function ToggleButtons({children,className,disabled,onClick,'aria-checked':checked,
  'aria-label':label,role:_role,type:_type,...buttonProps}:ButtonHTMLAttributes<HTMLButtonElement>) {
  const value=checked===true||checked==='true'
  const card=className?.includes('sensor-enable-card')
  const choices=<div className="setting-choice" role="group" aria-label={label}>
    {([false,true] as const).map(enabled=><button {...buttonProps} key={String(enabled)}
      type="button" aria-pressed={enabled===value} disabled={disabled}
      onClick={event=>{if(enabled!==value)onClick?.(event)}}>{enabled?'Aktif':'Nonaktif'}</button>)}
  </div>
  return card?<div className="binary-setting-row">{children}{choices}</div>:choices
}
