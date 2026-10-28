export type GuideCell={value:string|number|boolean|null;display:string;formula?:string}
export type GuideSheet={id:string;sheetName:string;cropName:string;headerRow:number;lastRow:number;columnCount:number;merges:string[];cells:Record<string,GuideCell|undefined>}
export type GuideDataset={sourceName:string;sourceSha256:string;sheets:GuideSheet[]}
export function columnName(index:number):string {
  let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name
  return name
}
function position(address:string){
  const match=/^([A-Z]+)(\d+)$/.exec(address)
  if(!match)throw new Error(`Invalid source cell: ${address}`)
  let column=0;for(const letter of match[1])column=column*26+letter.charCodeAt(0)-64
  return {column:column-1,row:Number(match[2])}
}
/** Preserve original blank cells and merges. Never infer a method/product from the preceding row. */
export function guideRows(sheet:GuideSheet){
  const merged=new Map<string,{rowSpan:number;colSpan:number}>(),covered=new Set<string>()
  for(const range of sheet.merges){
    const [first,last]=range.split(':');const start=position(first),end=position(last??first)
    if(start.row<=sheet.headerRow||start.row>sheet.lastRow||start.column>=sheet.columnCount)continue
    const rowEnd=Math.min(end.row,sheet.lastRow),colEnd=Math.min(end.column,sheet.columnCount-1)
    merged.set(first,{rowSpan:rowEnd-start.row+1,colSpan:colEnd-start.column+1})
    for(let row=start.row;row<=rowEnd;row++)for(let col=start.column;col<=colEnd;col++){
      const address=`${columnName(col)}${row}`;if(address!==first)covered.add(address)
    }
  }
  return Array.from({length:sheet.lastRow-sheet.headerRow},(_,i)=>{
    const row=sheet.headerRow+i+1
    return {row,cells:Array.from({length:sheet.columnCount},(_,column)=>{
      const address=`${columnName(column)}${row}`
      return {address,column,cell:sheet.cells[address]??null,...(merged.get(address)??{rowSpan:1,colSpan:1}),covered:covered.has(address)}
    }).filter(cell=>!cell.covered)}
  })
}
