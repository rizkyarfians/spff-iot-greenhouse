import './SettingsWorkspace.css'

export function SettingChoice({label,value,disabled=false,onChange}:{
  label:string
  value:boolean|null
  disabled?:boolean
  onChange:(enabled:boolean)=>void
}) {
  return <div className="setting-choice" role="group" aria-label={label}>
    {([false,true] as const).map(enabled=><button key={String(enabled)} type="button"
      aria-pressed={value===enabled} disabled={disabled}
      onClick={()=>{if(value!==enabled)onChange(enabled)}}>
      {enabled?'Aktif':'Nonaktif'}
    </button>)}
  </div>
}
