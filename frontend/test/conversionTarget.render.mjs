import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'

const server=await createServer({root:new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),server:{middlewareMode:true},appType:'custom'})
try{
 const {ConversionTargetView}=await server.ssrLoadModule('/src/ConversionTarget.tsx')
 const render=props=>renderToStaticMarkup(createElement(ConversionTargetView,{title:'Pemupukan HST 20',activityId:'row-16',...props}))
 const html=render({conversion:{activityId:'row-16',status:'ready',targetEcMsCm:2.608,concentrationGPerL:31.35},waterEcMsCm:0.152})
 for(const text of ['Hasil konversi EC','2,608','2.608','µS/cm','31,35 g/L','0,152 mS/cm','Belum berarti target ini sudah diterapkan'])assert.ok(html.includes(text),text)
 const blocked=render({conversion:{activityId:'row-16',status:'blocked',targetEcMsCm:null,reason:'Profil konversi belum tersedia'}})
 assert.ok(blocked.includes('Profil konversi belum tersedia'));assert.ok(!blocked.includes('2,608'))
 const changed=render({conversion:{activityId:'row-11',status:'ready',targetEcMsCm:2.608}})
 assert.ok(!changed.includes('2,608'))
 assert.ok(render({loading:true}).includes('Memuat hasil konversi'))
 assert.ok(render({error:'API unavailable'}).includes('role="alert"'))
 console.log('Conversion card render checks passed: ready, blocked, wrong activity, loading and error')
}finally{await server.close()}
