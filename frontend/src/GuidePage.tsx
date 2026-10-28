import {useState} from 'react'
import {BookOpen,Square,SquareCheck} from 'lucide-react'
import snapshot from './data/protocolGuide.json'
import {columnName,guideRows,type GuideDataset,type GuideCell} from './protocolGuide'
import './GuidePage.css'

const guide=snapshot as GuideDataset
export function GuidePage(){
  const [crop,setCrop]=useState(guide.sheets[0].id)
  const sheet=guide.sheets.find(item=>item.id===crop)??guide.sheets[0]
  const rows=guideRows(sheet)
  const metadata=Array.from({length:8},(_,i)=>{const label=sheet.cells[`C${i+1}`],value=sheet.cells[`D${i+1}`];return label?[{label,value}]:[]}).flat()
  const notes=['F2','F3','F4'].map(key=>sheet.cells[key]).filter((cell):cell is GuideCell=>!!cell&&typeof cell.value==='string'&&cell.value!=='HST')
  const sourceHst=sheet.cells.F2?.value==='HST'?sheet.cells.F3:null
  return <section className="guide-page">
    <div className="guide-toolbar">
      <label htmlFor="guide-crop"><span>Tanaman</span><select id="guide-crop" value={sheet.id} onChange={event=>setCrop(event.target.value)}>
        {guide.sheets.map(item=><option key={item.id} value={item.id}>{item.cropName}</option>)}
      </select></label>
    </div>
    <section className="guide-source-card" aria-labelledby="guide-crop-heading">
      <div className="guide-source-heading"><span className="guide-icon" aria-hidden="true"><BookOpen size={23}/></span><div><h2 id="guide-crop-heading">{sheet.sheetName}</h2><p>Informasi lahan dan tanaman</p></div>
        {sourceHst&&<span className="guide-hst"><strong>{sourceHst.display}</strong> HST <small>pada file</small></span>}
      </div>
      <dl className="guide-metadata">{metadata.map(({label,value},index)=><div key={index}><dt>{label.display}</dt><dd>{value?.display??'—'}</dd></div>)}</dl>
      {notes.length>0&&<div className="guide-source-notes" aria-label="Catatan pada Excel">{notes.map((note,index)=><p key={index}>{note.display}</p>)}</div>}
    </section>
    <section className="guide-table-card" aria-labelledby="guide-table-heading">
      <header><h2 id="guide-table-heading">Jadwal dan kebutuhan</h2><p>Geser tabel untuk melihat semua kolom.</p></header>
      <div className="guide-table-scroll" tabIndex={0} role="region" aria-label={`Tabel ${sheet.cropName}`} key={sheet.id}>
        <table>
          <caption>{sheet.sheetName} — data sesuai Excel</caption>
          <colgroup><col style={{width:96}}/><col style={{width:80}}/>{Array.from({length:sheet.columnCount-2},(_,i)=><col key={i}/>)}</colgroup>
          <thead><tr>{Array.from({length:sheet.columnCount},(_,column)=><th className={column<2?`guide-fixed-${column}`:undefined} scope="col" key={column}>
            {sheet.cells[`${columnName(column)}${sheet.headerRow}`]?.display??''}
          </th>)}</tr></thead>
          <tbody>{rows.map(row=><tr key={row.row}>{row.cells.map(({address,column,cell,rowSpan,colSpan})=><td key={address} rowSpan={rowSpan} colSpan={colSpan}
            className={`${column<2?`guide-fixed-${column} `:''}${typeof cell?.value==='number'?'guide-number':''}`}
            title={`${sheet.sheetName}!${address}`}>
            {typeof cell?.value==='boolean'?<span className="guide-source-check" role="img" aria-label={cell.value?'Dicentang pada Excel':'Belum dicentang pada Excel'}>{cell.value?<SquareCheck size={19}/>:<Square size={19}/>}</span>:cell?.display??''}
          </td>)}</tr>)}</tbody>
        </table>
      </div>
      <footer>Nilai perhitungan mengikuti hasil yang tersimpan di Excel.</footer>
    </section>
    <details className="guide-source-details"><summary>Sumber data</summary><p>{guide.sourceName}</p><p>Nama produk, satuan, urutan, dan nilai mengikuti file sumber. Halaman ini menampilkan panduan, tanpa mengubah pengaturan pompa.</p></details>
  </section>
}
