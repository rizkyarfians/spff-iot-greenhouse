import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyApiRuntime,verifyRuntimeCopy} from '../verify-api-runtime.mjs';

function fixture(t){
 const base=dirname(fileURLToPath(import.meta.url)),root=mkdtempSync(join(base,'api-runtime-test-'));
 t.after(()=>{assert.ok(resolve(root).startsWith(base+sep));rmSync(root,{recursive:true,force:true});});
 const source=join(root,'source');mkdirSync(join(source,'routes'),{recursive:true});
 writeFileSync(join(source,'local.js'),'import {app} from "./app.js"; app.listen(3001);');
 writeFileSync(join(source,'app.js'),'export const app = {};');
 writeFileSync(join(source,'routes/index.js'),'const path = "/auth/login";');
 return {root,source};
}
test('empty core files and non-listening entry fail verification',t=>{
 const {source}=fixture(t);
 assert.equal(verifyApiRuntime('api',source).modules,3);
 writeFileSync(join(source,'local.js'),'');assert.throws(()=>verifyApiRuntime('api',source),/Empty compiled module/);
 writeFileSync(join(source,'local.js'),'process.exit(0);');assert.throws(()=>verifyApiRuntime('api',source),/behavior missing/);
});
test('staged bytes must match every freshly compiled file',t=>{
 const {root,source}=fixture(t),target=join(root,'target');cpSync(source,target,{recursive:true});
 assert.equal(verifyRuntimeCopy('api',source,target).modules,3);
 writeFileSync(join(target,'app.js'),'export const app = {unexpected:true};');
 assert.throws(()=>verifyRuntimeCopy('api',source,target),/copy mismatch/);
});

test('worker rejects empty modules and inert entry before runtime replacement',t=>{
 const {root}=fixture(t),source=join(root,'worker');mkdirSync(source);
 writeFileSync(join(source,'index.js'),'worker.start();');
 writeFileSync(join(source,'mqttWorker.js'),'export class MqttWorker {}');
 writeFileSync(join(source,'ingestionService.js'),'export class IngestionService {}');
 assert.equal(verifyApiRuntime('worker',source).modules,3);
 writeFileSync(join(source,'mqttWorker.js'),'');
 assert.throws(()=>verifyApiRuntime('worker',source),/Empty compiled module/);
 writeFileSync(join(source,'mqttWorker.js'),'export class MqttWorker {}');
 writeFileSync(join(source,'index.js'),'process.exit(0);');
 assert.throws(()=>verifyApiRuntime('worker',source),/behavior missing/);
});
