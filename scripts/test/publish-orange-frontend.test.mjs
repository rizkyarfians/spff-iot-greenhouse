import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep} from 'node:path';
import {publishFrontendBuild} from '../publish-orange-frontend.mjs';

function fixture(t) {
  const base=dirname(fileURLToPath(import.meta.url)),root=mkdtempSync(join(base,'spff-frontend-test-'));
  t.after(()=>{assert.ok(resolve(root).startsWith(base+sep));rmSync(root,{recursive:true,force:true});});
  const build=join(root,'build'),live=join(root,'live'),backup=join(root,'backup');
  for(const dir of [join(build,'assets'),join(build,'.vite'),join(live,'assets')])mkdirSync(dir,{recursive:true});
  writeFileSync(join(live,'index.html'),'old html');writeFileSync(join(live,'assets','old.js'),'old tab entry');
  writeFileSync(join(live,'assets','login-samehash.png'),'incorrect existing image bytes');
  writeFileSync(join(build,'assets','login-samehash.png'),'correct build image bytes');
  writeFileSync(join(build,'assets','new.js'),'new application');
  writeFileSync(join(build,'index.html'),'<div id="root"></div><script type="module" src="/assets/new.js"></script>');
  writeFileSync(join(build,'.vite','manifest.json'),JSON.stringify({'index.html':{isEntry:true,file:'assets/new.js',assets:['assets/login-samehash.png']}}));
  return {build,live,backup};
}

test('conflicting existing asset is backed up and restored before publishing HTML',t=>{
  const {build,live,backup}=fixture(t);
  const result=publishFrontendBuild(build,live,backup);
  assert.equal(result.replaced,1);
  assert.equal(readFileSync(join(live,'assets','login-samehash.png'),'utf8'),'correct build image bytes');
  assert.equal(readFileSync(join(backup,'assets-before','assets','login-samehash.png'),'utf8'),'incorrect existing image bytes');
  assert.equal(readFileSync(join(live,'assets','old.js'),'utf8'),'old tab entry');
  assert.equal(readFileSync(join(backup,'index-before.html'),'utf8'),'old html');
  assert.equal(readFileSync(join(live,'index.html'),'utf8'),readFileSync(join(build,'index.html'),'utf8'));
  assert.equal(publishFrontendBuild(build,live,backup).replaced,0);
  assert.equal(readFileSync(join(backup,'index-before.html'),'utf8'),'old html');
});

test('incomplete build cannot change the live entry or assets',t=>{
  const {build,live,backup}=fixture(t);
  writeFileSync(join(build,'.vite','manifest.json'),JSON.stringify({'index.html':{isEntry:true,file:'assets/new.js',imports:['missing']}}));
  assert.throws(()=>publishFrontendBuild(build,live,backup),/Missing manifest dependency/);
  assert.equal(readFileSync(join(live,'index.html'),'utf8'),'old html');
  assert.equal(readFileSync(join(live,'assets','login-samehash.png'),'utf8'),'incorrect existing image bytes');
});

test('HTML without a module and paths outside the build are refused',t=>{
  const {build,live,backup}=fixture(t);
  writeFileSync(join(build,'index.html'),'<div id="root"></div>');
  assert.throws(()=>publishFrontendBuild(build,live,backup),/HTML module entry/);
  writeFileSync(join(build,'index.html'),'<script type="module" src="/assets/new.js"></script>');
  writeFileSync(join(build,'.vite','manifest.json'),JSON.stringify({'index.html':{isEntry:true,file:'assets/new.js',assets:['../escape.png']}}));
  assert.throws(()=>publishFrontendBuild(build,live,backup),/escapes build root/);
});
