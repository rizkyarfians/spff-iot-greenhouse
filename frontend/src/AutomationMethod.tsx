import './AutomationMethod.css'

/** Method support only: this does not indicate session readiness or pump state. */
export function AutomationMethod({method}:{method:string}){
 const normalized=method.trim().toLowerCase()
 const supported=normalized==='kocor'
 const unknown=!normalized||normalized==='belum ditentukan'
 return <span className={`automation-method ${supported?'is-supported':'is-manual'}`} title={supported?'Metode didukung alat. Sesi tetap memerlukan konfigurasi dan sensor yang siap.':unknown?'Tentukan cara pemberian sebelum menilai dukungan otomasi.':'Metode ini dilakukan manual; perangkat hanya mendukung otomasi kocor.'}>
  {supported?'Mendukung otomasi':unknown?'Metode belum ditentukan':'Manual · tidak didukung alat'}
 </span>
}
export function AutomationMethodNote(){
 return <p className="automation-method-note"><strong>Otomasi hanya untuk kocor.</strong> Tabur, tugal, dan semprot dilakukan manual. Dukungan metode belum berarti pompa aktif.</p>
}
