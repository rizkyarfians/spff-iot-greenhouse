import {useEffect,useRef,useState} from 'react'
import type {ProtocolGuideState,ProtocolGuideRevision,GuideEditValue} from '@spff/contracts'
import {fetchProtocolGuide,saveProtocolGuide,fetchProtocolGuideHistory} from './api'
import {useAuth} from './authContext'
import {BookOpen,Square,SquareCheck,Pencil,Save,RotateCcw} from 'lucide-react'
import snapshot from './data/protocolGuide.json'
import {columnName,guideRows,applyGuideOverrides,guideColumnKind,type GuideDataset,type GuideCell} from './protocolGuide'
import './GuidePage.css'
import {AutomationMethod,AutomationMethodNote} from './AutomationMethod'

const guide=snapshot as GuideDataset
export function GuidePage(){
  const {user}=useAuth(),admin=user.role==='admin'
  const [crop,setCrop]=useState(guide.sheets[0].id)
  const [mobileLayout,setMobileLayout]=useState<'cards'|'table'>('cards')
  const [stored,setStored]=useState<ProtocolGuideState|null>(null)
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[showOriginal,setShowOriginal]=useState(false)
  const [draft,setDraft]=useState<Record<string,GuideEditValue>>({}),[note,setNote]=useState('')
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0)
  const [historyOpen,setHistoryOpen]=useState(false),[history,setHistory]=useState<ProtocolGuideRevision[]>([]),[historyError,setHistoryError]=useState('')
  const form=useRef<HTMLFormElement>(null),saveLock=useRef(false)
  const original=guide.sheets.find(item=>item.id===crop)??guide.sheets[0]
  const view=stored?.cropId===crop?stored:null
  const compatible=!!view&&view.sourceSha256===guide.sourceSha256
  useEffect(()=>{
    let active=true;const controller=new AbortController()
    setStored(null);setError('');setNotice('');setDraft({});setNote('');setEditing(false);setShowOriginal(false);setHistory([])
    fetchProtocolGuide(crop,controller.signal).then(next=>{if(active){setStored(next);if(next.sourceSha256!==guide.sourceSha256)setError('Panduan berubah. Muat ulang atau hubungi pengelola.')}})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Gagal memuat perubahan panduan.')})
    return()=>{active=false;controller.abort()}
  },[crop,reload])
  useEffect(()=>{
    if(!historyOpen)return
    let active=true;setHistoryError('');setHistory([])
    fetchProtocolGuideHistory(crop).then(rows=>{if(active)setHistory(rows)}).catch(e=>{if(active)setHistoryError(e instanceof Error?e.message:'Gagal memuat riwayat.')})
    return()=>{active=false}
  },[crop,view?.revision,historyOpen])
  const savedSheet=applyGuideOverrides(original,compatible?view.overrides:{})
  const sheet=showOriginal?original:editing?applyGuideOverrides(savedSheet,draft):savedSheet
  const rows=guideRows(sheet),changes=Object.entries(draft)
  function rowLabel(rowNumber:number){
    // Carry context only across an explicit Excel merge, never across blank cells.
    const owner=rows.find(row=>row.row<=rowNumber&&row.cells.some(cell=>cell.column===1&&row.row+cell.rowSpan>rowNumber))
    const hst=owner?.cells.find(cell=>cell.column===1)?.cell?.display
    return `Baris ${rowNumber}${hst?` · HST ${hst}`:''}`
  }
  function change(address:string,value:GuideEditValue){
    setDraft(current=>{const next={...current};if(value===(savedSheet.cells[address]?.value??null))delete next[address];else next[address]=value;return next})
    setError('');setNotice('')
  }
  async function save(){
    if(!admin||!compatible||!view||saveLock.current||!changes.length||!form.current?.reportValidity())return
    saveLock.current=true;setSaving(true);setError('');setNotice('')
    try{
      const next=await saveProtocolGuide(crop,{sourceSha256:guide.sourceSha256,expectedRevision:view.revision,changes:changes.map(([address,value])=>({address,value})),note})
      setStored(next);setEditing(false);setDraft({});setNote('');setNotice('Perubahan tersimpan.')
    }catch(e){setError(e instanceof Error?e.message:'Perubahan belum tersimpan. Draf tetap tersedia.')}
    finally{saveLock.current=false;setSaving(false)}
  }
  const displayValue=(value:GuideEditValue)=>value===null?'Kosong':typeof value==='boolean'?(value?'Dicentang':'Tidak dicentang'):String(value)

  const metadata=Array.from({length:8},(_,i)=>{const label=sheet.cells[`C${i+1}`],value=sheet.cells[`D${i+1}`];return label?[{label,value}]:[]}).flat()
  const notes=['F2','F3','F4'].map(key=>sheet.cells[key]).filter((cell):cell is GuideCell=>!!cell&&typeof cell.value==='string'&&cell.value!=='HST')
  const sourceHst=sheet.cells.F2?.value==='HST'?sheet.cells.F3:null
  return <section className={`guide-page guide-mobile-${mobileLayout}${editing?' guide-is-editing':''}`}>
    <div className="guide-toolbar">
      <label htmlFor="guide-crop"><span>Tanaman</span><select id="guide-crop" value={sheet.id} disabled={editing||saving} onChange={event=>setCrop(event.target.value)}>
        {guide.sheets.map(item=><option key={item.id} value={item.id}>{item.cropName}</option>)}
      </select></label>
      <div className="guide-edit-actions">
        {editing?<><span className="guide-draft-count">{changes.length} sel diubah</span><button type="button" disabled={saving} onClick={()=>{setEditing(false);setDraft({});setNote('');setError('')}}>Batal</button>
          <button className="guide-save" type="submit" form="guide-edit-form" disabled={saving||!changes.length}><Save size={18} aria-hidden="true"/>{saving?'Menyimpan…':'Simpan perubahan'}</button></>:
          <>{admin&&<button type="button" disabled={!compatible||!!error} onClick={()=>{sessionStorage.setItem('spff-guide-program-crop',crop);window.location.hash='#/fertigation'}}>Gunakan untuk program</button>}<button type="button" disabled={!view} aria-pressed={showOriginal} onClick={()=>setShowOriginal(value=>!value)}>{showOriginal?'Lihat versi tersimpan':'Lihat acuan Excel'}</button>
          {admin&&<button className="guide-save" type="button" disabled={!compatible||!!error} onClick={()=>{setShowOriginal(false);setEditing(true);setNotice('')}}><Pencil size={18} aria-hidden="true"/>Edit tabel</button>}
          <button type="button" aria-label="Muat ulang panduan" onClick={()=>setReload(value=>value+1)}><RotateCcw size={18} aria-hidden="true"/></button></>}
      </div>
    </div>
    {error&&<p className="guide-edit-error" role="alert">{error}</p>}
    {notice&&<p className="guide-edit-notice" role="status">{notice}</p>}
    <p className="guide-version">{showOriginal?'Panduan asli':!view?'Memuat panduan…':null}</p>
    {editing&&<p className="guide-edit-note">Edit sel tabel di bawah. Periksa kembali total kebutuhan setelah mengedit.</p>}

    <section className="guide-source-card" aria-labelledby="guide-crop-heading">
      <div className="guide-source-heading"><span className="guide-icon" aria-hidden="true"><BookOpen size={23}/></span><div><h2 id="guide-crop-heading">{sheet.sheetName}</h2><p>Informasi lahan dan tanaman</p></div>
        {sourceHst&&<span className="guide-hst"><strong>{sourceHst.display}</strong> HST <small>pada file</small></span>}
      </div>
      <dl className="guide-metadata">{metadata.map(({label,value},index)=><div key={index}><dt>{label.display}</dt><dd>{value?.display??'—'}</dd></div>)}</dl>
      {notes.length>0&&<div className="guide-source-notes" aria-label="Catatan pada Excel">{notes.map((note,index)=><p key={index}>{note.display}</p>)}</div>}
    </section>
    <AutomationMethodNote/>
    <form id="guide-edit-form" ref={form} className="guide-table-card" aria-labelledby="guide-table-heading" onSubmit={event=>{event.preventDefault();void save()}}>
      <header><h2 id="guide-table-heading">Jadwal dan kebutuhan</h2><p className="guide-table-hint">Geser tabel untuk melihat semua kolom.</p>
        <div className="guide-mobile-layout" role="group" aria-label="Tampilan panduan">
          <button type="button" aria-pressed={mobileLayout==='cards'} onClick={()=>setMobileLayout('cards')}>Kartu</button>
          <button type="button" aria-pressed={mobileLayout==='table'} onClick={()=>setMobileLayout('table')}>Tabel lengkap</button>
        </div>
      </header>
      <div className="guide-table-scroll" tabIndex={0} role="region" aria-label={`Tabel ${sheet.cropName}`} key={sheet.id}>
        <table role="table">
          <caption>{sheet.sheetName} — {showOriginal?'acuan Excel':'versi panduan tersimpan'}</caption>
          <colgroup><col style={{width:96}}/><col style={{width:80}}/>{Array.from({length:sheet.columnCount-2},(_,i)=><col key={i}/>)}</colgroup>
          <thead role="rowgroup"><tr role="row">{Array.from({length:sheet.columnCount},(_,column)=><th className={column<2?`guide-fixed-${column}`:undefined} scope="col" role="columnheader" key={column}>
            {sheet.cells[`${columnName(column)}${sheet.headerRow}`]?.display??''}
          </th>)}</tr></thead>
          <tbody role="rowgroup">{rows.map(row=><tr role="row" key={row.row} data-row-label={rowLabel(row.row)} aria-label={rowLabel(row.row)}>{row.cells.map(({address,column,cell,rowSpan,colSpan})=><td role="cell" key={address} rowSpan={rowSpan} colSpan={colSpan}
            data-label={`${sheet.cells[`${columnName(column)}${sheet.headerRow}`]?.display||columnName(column)} (${columnName(column)})`}
            className={`${!editing&&(cell?.value===null||cell?.value===undefined||cell?.display==='')?'guide-cell-empty ':''}${colSpan>1||[2,4].includes(column)?'guide-cell-wide ':''}${column<2?`guide-fixed-${column} `:''}${typeof cell?.value==='number'?'guide-number ':''}${!showOriginal&&((compatible&&Object.hasOwn(view.overrides,address))||Object.hasOwn(draft,address))?'guide-cell-changed':''}`}
            title={`${sheet.sheetName}!${address}`}>
            <span className="guide-mobile-field-label" aria-hidden="true">{sheet.cells[`${columnName(column)}${sheet.headerRow}`]?.display||columnName(column)} <small>({columnName(column)})</small></span>
            <div className="guide-cell-value">{editing?(guideColumnKind(column)==='boolean'?<input type="checkbox" checked={cell?.value===true} disabled={saving} aria-label={`Cek ${address}`} onChange={event=>change(address,event.target.checked)}/>:
              <input type={guideColumnKind(column)==='number'?'number':'text'} value={cell?.value===null||cell?.value===undefined?'':String(cell.value)} disabled={saving}
                aria-label={`${sheet.cells[`${columnName(column)}${sheet.headerRow}`]?.display??'Sel'} ${address}`}
                min={guideColumnKind(column)==='number'&&column!==1?0:undefined} step={column<2?1:'any'} maxLength={500}
                onChange={event=>change(address,guideColumnKind(column)==='number'?(event.target.value===''?null:event.target.valueAsNumber):event.target.value)}/> ):
              typeof cell?.value==='boolean'?<span className="guide-source-check" role="img" aria-label={cell.value?'Dicentang':'Belum dicentang'}>{cell.value?<SquareCheck size={19}/>:<Square size={19}/>}</span>:cell?.display??''}</div>
            {!editing&&column===3&&typeof cell?.value==='string'&&cell.value.trim()&&<AutomationMethod method={cell.value}/>}

          </td>)}</tr>)}</tbody>
        </table>
      </div>
      {editing&&<label className="guide-change-note">Catatan perubahan (opsional)<input value={note} maxLength={500} disabled={saving} onChange={event=>setNote(event.target.value)}/></label>}
      {editing&&<div className="guide-edit-actions guide-bottom-actions"><span className="guide-draft-count">{changes.length} sel diubah</span><button className="guide-save" type="submit" disabled={saving||!changes.length}><Save size={18} aria-hidden="true"/>{saving?'Menyimpan…':'Simpan perubahan'}</button></div>}
      <footer>{editing?'Periksa dosis, satuan, dan total sebelum menyimpan.':showOriginal?'Nilai perhitungan mengikuti hasil yang tersimpan di Excel.':'Perubahan panduan tidak mengubah program atau menjalankan pompa.'}</footer>
    </form>
    <details className="guide-history" open={historyOpen} onToggle={event=>setHistoryOpen(event.currentTarget.open)}><summary>Riwayat perubahan</summary>
      {historyError&&<p role="alert">{historyError}</p>}
      {!historyError&&!history.length&&<p>Belum ada riwayat yang ditampilkan.</p>}
      {history.map(item=><article key={item.revision}><h3>Revisi {item.revision} · {item.actor}</h3><p>{new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(item.savedAt))} WIB</p>
        {item.note&&<p>{item.note}</p>}<ul>{item.changes.map(change=><li key={change.address}><strong>{change.address}</strong>: {displayValue(change.before)} → {displayValue(change.after)}</li>)}</ul>
      </article>)}
      {history.length===20&&<p>Menampilkan 20 revisi terakhir.</p>}
    </details>
    <details className="guide-source-details"><summary>Sumber data</summary><p>{guide.sourceName}</p><p>Acuan Excel tetap tersimpan. Riwayat perubahan tetap tersimpan.</p></details>
  </section>
}
