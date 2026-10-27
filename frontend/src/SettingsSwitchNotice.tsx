import type { SwitchNotice } from './settingsSwitchFeedback'

export function SettingsSwitchNotice({notice,onClose}:{notice:SwitchNotice|null;onClose:()=>void}) {
  if(!notice)return null
  return <div className={`settings-switch-notice settings-switch-notice--${notice.kind}`}
    role={notice.kind==='error'||notice.kind==='warning'?'alert':'status'} aria-atomic="true">
    <p>{notice.message}</p>
    <button type="button" onClick={onClose} aria-label="Tutup notifikasi">×</button>
  </div>
}
