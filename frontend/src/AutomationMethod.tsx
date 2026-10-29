import './AutomationMethod.css'

/** Method support only: this does not indicate session readiness or pump state. */
export function AutomationMethod({method}:{method:string}){
 const normalized=method.trim().toLowerCase()
 const supported=normalized==='kocor'
 const unknown=!normalized||normalized==='belum ditentukan'
 return <span className={`automation-method ${supported?'is-supported':'is-manual'}`} title={supported?'Periksa kesiapan alat sebelum memulai.':unknown?'Pilih cara pemberian.':'Dilakukan oleh petani.'}>
  {supported?'Mendukung otomasi':unknown?'Metode belum ditentukan':'Dikerjakan petani'}
 </span>
}
export function AutomationMethodNote(){
 return <p className="automation-method-note"><strong>Otomasi hanya untuk kocor.</strong> Kegiatan lainnya dikerjakan petani.</p>
}
