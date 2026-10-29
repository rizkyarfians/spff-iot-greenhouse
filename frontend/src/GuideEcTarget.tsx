import type {GuideActivity,GuideEcConversion} from '@spff/contracts'
import {guideEcDisplay} from './guideEcDisplay'
import './GuideEcSettings.css'
const fmt=(value:number)=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(value)
export function GuideEcTarget({activity,conversion,error}:{activity:GuideActivity;conversion?:GuideEcConversion;error?:string}){
 const state=guideEcDisplay(activity,conversion)
 return <span className={`gp-ec-target is-${state.kind}`}>{state.target!==null?<><span>Target EC</span><strong>{fmt(state.target)} mS/cm</strong><small>{fmt(state.target*1000)} µS/cm</small></>:<span>{error&&state.kind!=='dry'?'Target EC belum dapat dimuat':state.label}</span>}</span>
}
