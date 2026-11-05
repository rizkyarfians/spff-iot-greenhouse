import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as contracts from '@spff/contracts';

const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/HstRealExecutionCard.tsx',import.meta.url),'utf8')
 .replace("import.meta.env.DEV&&import.meta.env.VITE_SPFF_AI_PREVIEW==='true'",'false');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
 jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const profile={programId:'11111111-1111-4111-8111-111111111111',activityId:'row-19',sourceRow:19,
 deviceId:'esp32-s3-01',product:'Ultradap',programRevision:2,ecProfileRevision:3,
 stockConcentrationGPerL:40,waterMeterPosition:'before_injector',
 hydraulicsReference:'Synthetic measured test reference',ecToleranceUs:100,maxDurationSec:600,flushDurationSec:30};
function render(setup,reasons=[]){
 const module={exports:{}};
 const load=id=>id==='react'?React:id==='@spff/contracts'?contracts:
  id==='./authContext'?{useAuth:()=>({user:{role:'admin'}})}:
  id==='./api'?{}:require(id);
 vm.runInNewContext(js,{require:load,module,exports:module.exports,Intl,Date,Number});
 return renderToStaticMarkup(React.createElement(module.exports.HstRealExecutionCard,{
  proposal:{obligation_id:'a'.repeat(64),program_id:profile.programId,activity_id:'row-19',source_row:19,
   product:'Ultradap',hst:20,target_g:400,remaining_g:400,delivered_g:0,review_reasons:[],status:'WAITING_APPROVAL'},
  shadowEnabled:false,preflight:{setup,reasons,canDispatch:false},preflightError:null,refreshPreflight:()=>{},
 }));
}
const setup={programRevision:2,ecProfileRevision:3,deviceId:'esp32-s3-01',profile:null,
 guide:{method:'Semprot',waterL:100,targetEcUsCm:900}};

test('Guide dose and EC are shown automatically without asking to re-enter them',()=>{
 const html=render(setup);
 assert.match(html,/Dari Panduan · otomatis/);
 assert.match(html,/0,4 kg/);assert.match(html,/900 µS\/cm/);
 assert.doesNotMatch(html,/type="number"/);
});
test('missing Guide EC shows the prerequisite instead of an unusable installation form',()=>{
 const html=render({...setup,ecProfileRevision:null,guide:{...setup.guide,targetEcUsCm:null}},[
  'measured_guide_ec_conversion_profile_required','manual_session_control_not_acknowledged']);
 assert.match(html,/Lengkapi pengukuran EC campuran di Panduan terlebih dahulu/);
 assert.doesNotMatch(html,/Lengkapi data instalasi sekali/);
 assert.doesNotMatch(html,/manual_session_control_not_acknowledged/);
 assert.match(html,/Perangkat belum mengonfirmasi mode sesi MANUAL/);
});
test('a current saved profile is summarized and requires no repeated configuration',()=>{
 const html=render({...setup,profile});
 assert.match(html,/Profil instalasi tersimpan/);assert.match(html,/Stok 40 g\/L/);
 assert.doesNotMatch(html,/Simpan data instalasi/);
 assert.doesNotMatch(html,/Gunakan profil tersimpan/);
});
test('an EC profile that cannot convert the current Guide explains the missing source data',()=>{
 const html=render({...setup,guide:{...setup.guide,targetEcUsCm:null,ecReason:'EC air baku belum diisi pada pengaturan program.'}});
 assert.match(html,/EC air baku belum diisi/);
 assert.doesNotMatch(html,/Lengkapi data instalasi sekali/);
});
test('a suggestion from another activity requires explicit confirmation before reuse',()=>{
 const html=render({...setup,suggestedProfile:{...profile,activityId:'row-11',sourceRow:11}});
 assert.match(html,/campuran stok dan instalasinya masih sama/);
 assert.match(html,/<button[^>]+disabled=""[^>]*>Gunakan profil tersimpan<\/button>/);
 assert.match(html,/Campuran stok dan instalasi masih sama dengan profil tersimpan/);
});
