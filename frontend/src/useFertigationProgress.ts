import {useCallback,useEffect,useState} from 'react'
import type {FertigationProgress} from '@spff/contracts'
import {fetchFertigationProgress} from './api'
export function useFertigationProgress(deviceId:string,enabled=true,recipeId?:string){
 const [state,setState]=useState<{key:string;report:FertigationProgress|null;error:string;loading:boolean}>({key:'',report:null,error:'',loading:false})
 const [revision,setRevision]=useState(0)
 const retry=useCallback(()=>setRevision(value=>value+1),[])
 const key=`${deviceId}:${recipeId??''}`
 useEffect(()=>{
  if(!enabled||!deviceId)return
  let active=true,running=false
  const controller=new AbortController()
  const refresh=async()=>{if(running)return;running=true
   setState(previous=>previous.key===key?{...previous,loading:true}:{key,report:null,error:'',loading:true})
   try{const report=await fetchFertigationProgress(deviceId,recipeId,controller.signal);if(active)setState({key,report,error:'',loading:false})}
   catch(error){if(active)setState({key,report:null,error:error instanceof Error?error.message:'Gagal memuat rekomendasi.',loading:false})}
   finally{running=false}
  }
  void refresh();const timer=window.setInterval(()=>void refresh(),10000)
  return()=>{active=false;controller.abort();window.clearInterval(timer)}
 },[deviceId,enabled,recipeId,key,revision])
 // Never show a previous device/program or a stale successful report after disconnect.
 return {...(enabled&&state.key===key?state:{key,report:null,error:'',loading:false}),retry}
}
