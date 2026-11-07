import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoryPumpPolicy } from '../lib/middleware/advisoryAi.js';

function request(method,path,body={}) {
  let passed=false;
  let status;
  let response;
  const res={status(code){status=code;return this;},json(value){response=value;return this;}};
  advisoryPumpPolicy({method,path,body},res,()=>{passed=true;});
  return {passed,status,response};
}

test('legacy AI starts and resume are refused even when dispatch flags are enabled',()=>{
  for(const path of ['/unified-ai/hst/approvals','/unified-ai/hst/dose-volume/approvals',
    '/unified-ai/hst/real-sessions','/adaptive-fertigation/sessions','/fertigation/pulse-sessions/']){
    const result=request('POST',path);
    assert.equal(result.passed,false);
    assert.equal(result.status,410);
    assert.equal(result.response.code,'AI_ADVISORY_ONLY');
  }
  assert.equal(request('PUT','/unified-ai/hst/mode').status,410);
  assert.equal(request('POST','/adaptive-fertigation/sessions/session-1/control',{operation:'resume'}).status,410);
});

test('estimation, HST schedule monitoring, manual control and emergency STOP remain reachable',()=>{
  for(const [method,path,body] of [
    ['GET','/unified-ai/dashboard'],['GET','/unified-ai/hst/proposals'],
    ['GET','/fertigation/hst-starts'],['POST','/unified-ai/hst/dose-volume/plans'],
    ['POST','/unified-ai/hst/dose-volume/sessions/session-1/stop'],
    ['POST','/fertigation/pulse-sessions/session-1/stop'],
    ['POST','/adaptive-fertigation/sessions/session-1/control',{operation:'stop'}],
    ['PUT','/automatic-control'],
  ]){
    assert.equal(request(method,path,body).passed,true,path);
  }
});
