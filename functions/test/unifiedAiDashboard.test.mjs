import test from 'node:test';
import assert from 'node:assert/strict';
import {getUnifiedAiDashboard} from '../lib/controllers/unifiedAiDashboardController.js';
import {unifiedAiDashboardSchema} from '@spff/contracts';

function payload(){
 return {
  schemaVersion:1,mode:'SHADOW_MODE',can_dispatch:false,status:'NO_DECISION',
  evaluated_at:null,planning_source:'POSTGRES_READ_ONLY',planning_status:'CURRENT',
  planning_recorded_at:'2026-11-04T14:45:00Z',flow_reference:null,
  tank_preview:{basis:'LINEAR_LEVEL_APPROXIMATION',capacity_l:5000,tank_height_cm:180,
   reported_level_pct:82,sensor_valid:true,estimated_water_height_cm:147.6,
   estimated_available_l:4100,fuzzy_demand_l:null,theoretical_balance_l:null,
   level_status:'ESTIMATED',comparison_status:'NOT_COMPARABLE',can_dispatch:false},
  fertilizer_tank_preview:{basis:'LINEAR_LEVEL_APPROXIMATION',capacity_l:500,tank_height_cm:90,
   reported_level_pct:68,sensor_valid:true,estimated_liquid_height_cm:61.2,
   estimated_liquid_volume_l:340,level_status:'ESTIMATED',can_dispatch:false},
  irrigation_schedule_preview:{status:'FUZZY_UNAVAILABLE',basis:'REPORTED_LIQUID_HEIGHT_UNCALIBRATED',
   today_date:'2026-11-04',tomorrow_date:'2026-11-05',reported_liquid_height_cm:147.6,
   illustrative_available_l:4100,fuzzy_demand_l:null,today_absolute_max_l:null,
   tomorrow_at_least_l:null,reserve_l:null,is_firm_schedule:false,can_dispatch:false},
  water_carryover:{status:'ACTIVE',plan_id:'test-plan',planning_date:'2026-11-04',
   next_review_date:'2026-11-05',frozen_fuzzy_target_l:120,device_reported_delivered_l:0,
   remaining_for_reassessment_l:120,credited_session_count:0,last_device_session_at:null,
   evidence_basis:'DEVICE_SESSION_UNCALIBRATED',requires_fresh_reassessment:true,can_dispatch:false},
  decision:{type:null,proposed_action:null,hold_reasons:[],configuration_version:null},
  feedback:{status:'UNAVAILABLE',reported_off:false,boot_matches:false,
   water_pump:null,fert_pump:null,reported_at:null},
  sensors:{recorded_at:'2026-11-04T14:45:00Z',soil_moisture_pct:null,soil_2_moisture_pct:null,
   soil_1_valid:null,soil_2_valid:null,control_moisture_source:null,
   water_tank_pct:82,stock_tank_pct:68,device_mode:'manual'},
  calculation:{water_l:null,stock_l:null,fertilizer_mass_g:null,duration_seconds:null,fuzzy_score:null},
  fuzzy_preview:null,fuzzy_preview_blockers:[],programs:[],note:'Isolated test fixture',
 };
}
function response(){
 return {code:200,headers:{},body:null,set(key,value){this.headers[key]=value;return this;},
  status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
}
test('dashboard route forwards existing Python litre values without recalculation',async t=>{
 const expected=unifiedAiDashboardSchema.parse(payload());
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async(url,options)=>{
  assert.equal(new URL(url).hostname,'127.0.0.1');
  assert.equal(new URL(url).pathname,'/dashboard/summary');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  return {ok:true,json:async()=>expected};
 };
 const res=response();await getUnifiedAiDashboard({},res);
 assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'no-store');
 assert.deepEqual(res.body.data,expected);
 assert.equal(res.body.data.tank_preview.estimated_available_l,4100);
 assert.equal(res.body.data.fertilizer_tank_preview.estimated_liquid_volume_l,340);
 assert.equal(res.body.data.water_carryover.remaining_for_reassessment_l,120);
});
test('missing Python summary and invalid data return an explicit unavailable response',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 for(const upstream of [{ok:false},{ok:true,json:async()=>({wrong:'shape'})}]){
  globalThis.fetch=async()=>upstream;
  const res=response();await getUnifiedAiDashboard({},res);
  assert.equal(res.code,503);assert.equal(res.body.success,false);assert.equal(res.body.data,null);
 }
});
test('upstream connection failures do not invent zero litres or expose internals',async t=>{
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async()=>{throw Error('private upstream details');};
 const res=response();await getUnifiedAiDashboard({},res);
 assert.equal(res.code,503);assert.equal(res.body.data,null);
 assert.ok(!res.body.message.includes('private upstream details'));
});

test('dashboard supports explicitly guide-bound operational Fuzzy while retaining no dispatch authority',()=>{
 const sample=payload();
 sample.operational_profile={status:'GUIDE_BOUND',version:'test-guide-1',program_id:'program-1',
  activity_id:'row-19',target_water_l:1000,calculation_ready:true,can_dispatch:false,blockers:[]};
 sample.fuzzy_preview={basis:'OPERATIONAL_PROFILE',config_version:'test-guide-1',
  input_key:'soil_2_moisture',moisture_pct:19.9,score:0.844445,illustrative_water_l:844.445,
  model_max_irrigation_l:1000,recorded_at:'2026-11-04T14:45:00Z'};
 sample.production_fuzzy={status:'READY',basis:'VERIFIED_GUIDE_FUZZY',
  evaluated_at:'2026-11-04T14:45:01Z',recorded_at:'2026-11-04T14:45:00Z',
  expires_at:'2026-11-04T14:47:00Z',profile_version:'test-guide-1',program_id:'program-1',
  activity_id:'row-19',input_key:'soil_2_moisture',moisture_pct:19.9,
  memberships:{LOW:1,MEDIUM:0,HIGH:0},dominant_input_classes:['LOW'],rule_outputs:['HIGH'],
  score:0.844445,max_water_l:1000,target_water_l:844.445,irrigation_needed:true,
  can_dispatch:false,blockers:[]};
 assert.equal(unifiedAiDashboardSchema.safeParse(sample).success,true);
 sample.operational_profile.can_dispatch=true;
 assert.equal(unifiedAiDashboardSchema.safeParse(sample).success,false);
 sample.operational_profile.can_dispatch=false;
 sample.production_fuzzy.can_dispatch=true;
 assert.equal(unifiedAiDashboardSchema.safeParse(sample).success,false);
});

