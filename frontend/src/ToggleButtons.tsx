import type {ButtonHTMLAttributes} from 'react'
import './SettingsWorkspace.css'

/** Keep each control's existing confirmation, pending state, and command handler. */
export function ToggleButtons({children,className,disabled,disabledOn=false,allowOff=false,onValueChange,onClick,'aria-checked':checked,
  'aria-label':label,role:_role,type:_type,...buttonProps}:ButtonHTMLAttributes<HTMLButtonElement>&{disabledOn?:boolean;allowOff?:boolean;onValueChange?:(active:boolean)=>void}) {
  const value=checked===true||checked==='true'
  const card=className?.includes('sensor-enable-card')
  const choices=<div className="setting-choice" role="group" aria-label={label}>
    {([false,true] as const).map(enabled=><button {...buttonProps} key={String(enabled)}
      type="button" aria-pressed={enabled===value} disabled={disabled||(enabled&&disabledOn)}
      onClick={event=>{if(enabled!==value||(!enabled&&allowOff)){if(onValueChange)onValueChange(enabled);else onClick?.(event)}}}>{enabled?'Aktif':'Nonaktif'}</button>)}
  </div>
  return card?<div className="binary-setting-row">{children}{choices}</div>:choices
}
