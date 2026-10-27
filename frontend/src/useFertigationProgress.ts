import {useEffect,useState} from 'react'
import type {FertigationProgress} from '@spff/contracts'
import {fetchFertigationProgress} from './api'
export function useFertigationProgress(deviceId:string,enabled=true,recipeId?:string){
 const [state,setState]=useState<{key:string;report:FertigationProgress|null;error:string}>({key:'',report:null,error:''})
 const key=`${deviceId}:${recipeId??''}`
 useEffect(()=>{
  if(!enabled||!deviceId)return
  let active=true,running=false
  const controller=new AbortController()
  const refresh=async()=>{if(running)return;running=true
   try{const report=await fetchFertigationProgress(deviceId,recipeId,controller.signal);if(active)setState({key,report,error:''})}
   catch(error){if(active)setState({key,report:null,error:error instanceof Error?error.message:'Gagal memuat rekomendasi.'})}
   finally{running=false}
  }
  void refresh();const timer=window.setInterval(()=>void refresh(),10000)
  return()=>{active=false;controller.abort();window.clearInterval(timer)}
 },[deviceId,enabled,recipeId,key])
 // Never show a previous device/program or a stale successful report after disconnect.
 return enabled&&state.key===key?state:{key,report:null,error:''}
}
