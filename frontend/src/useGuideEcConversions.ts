import {useEffect,useState} from 'react'
import type {GuideProgram,GuideEcConversion} from '@spff/contracts'
import {fetchGuideEcConversions} from './api'
export function useGuideEcConversions(program:GuideProgram|null){
 const [state,setState]=useState<{key:string;rows:GuideEcConversion[];error:string}>({key:'',rows:[],error:''})
 const programId=program?.programId??''
 const [reload,setReload]=useState(0),key=program?`${program.programId}:${program.revision}`:''
 useEffect(()=>{
  if(!programId)return
  let active=true,inFlight=false
  async function read(){if(inFlight)return;inFlight=true;try{const rows=await fetchGuideEcConversions(programId);if(active)setState({key,rows,error:''})}catch(e){if(active)setState({key,rows:[],error:e instanceof Error?e.message:'Target EC belum dapat dimuat.'})}finally{inFlight=false}}
  void read();const timer=setInterval(()=>void read(),15000)
  return()=>{active=false;clearInterval(timer)}
 },[programId,key,reload])
 return {rows:state.key===key?state.rows:[],error:state.key===key?state.error:'',refresh:()=>setReload(v=>v+1)}
}
