import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {guideRows} from '../src/protocolGuide.ts'
const dataset=JSON.parse(readFileSync(new URL('../src/data/protocolGuide.json',import.meta.url),'utf8'))
test('guide records the supplied workbook fingerprint and contains all six source tables',()=>{
 assert.equal(dataset.sourceSha256,'74652e62eb3254bb6096983b2aba41d414a0d1bce1dc43adc0a69c83c0e9523f')
 assert.deepEqual(dataset.sheets.map(s=>s.cropName),['Ubi Jalar','Kacang Tanah','Jagung Manis','Terong','Buncis','Butternut Pumpkin'])
 assert.deepEqual(dataset.sheets.map(s=>guideRows(s).length),[20,16,10,31,23,9])
})
test('merged source cells cover each table position once without losing populated values',()=>{
 for(const sheet of dataset.sheets){
  const occupied=new Set(),rows=guideRows(sheet)
  for(const row of rows)for(const cell of row.cells){
   for(let y=row.row;y<row.row+cell.rowSpan;y++)for(let x=cell.column;x<cell.column+cell.colSpan;x++){
    const key=`${x}:${y}`;assert.ok(!occupied.has(key),`${sheet.sheetName} duplicate ${key}`);occupied.add(key)
   }
  }
  assert.equal(occupied.size,(sheet.lastRow-sheet.headerRow)*sheet.columnCount)
  const visible=new Map(rows.flatMap(row=>row.cells).map(cell=>[cell.address,cell]))
  for(const [address,cell]of Object.entries(sheet.cells)){
   if(Number(address.match(/\d+/)[0])<=sheet.headerRow)continue
   assert.deepEqual(visible.get(address)?.cell,cell,`${sheet.sheetName}!${address} must be visible`)
  }
 }
})
test('guide retains source irregularities, negative HST, original methods and stored formula results',()=>{
 const [ubi,kacang,,terong,buncis,butternut]=dataset.sheets
 assert.equal(ubi.cells.F3.value,35) // saved result; must not recalculate TODAY().
 assert.equal(kacang.cells.B11.value,-10)
 assert.equal(kacang.cells.L21.value,'gr/L') // preserve source's inconsistent total unit.
 assert.equal(terong.cells.J10.value,1200)
 assert.equal(terong.cells.D7.value,6000)
 assert.equal(buncis.cells.H10.display,'2.23')
 assert.ok(buncis.cells.H10.value>2.23)
 assert.equal(butternut.cells.D7.value,4285.714286)
 const row=guideRows(ubi).find(row=>row.row===12)
 assert.equal(row.cells.find(cell=>cell.address==='D12').cell,null) // no inferred application method.
 assert.equal(row.cells.find(cell=>cell.address==='G12').cell.value,false)
 assert.equal(ubi.cells.D11.value,'Tabur')
})
