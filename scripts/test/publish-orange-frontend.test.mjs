import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,lstatSync} from 'node:fs';
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

for(const kind of ['empty','missing'])test('a '+kind+' live HTML entry can be recovered',t=>{
  const {build,live,backup}=fixture(t);
  if(kind==='empty')writeFileSync(join(live,'index.html'),'');
  else rmSync(join(live,'index.html'));
  const result=publishFrontendBuild(build,live,backup);
  assert.equal(result.previousEntry,kind);
  assert.equal(readFileSync(join(live,'index.html'),'utf8'),readFileSync(join(build,'index.html'),'utf8'));
  assert.equal(JSON.parse(readFileSync(join(backup,'index-before-state.json'),'utf8')).kind,kind);
  if(kind==='empty')assert.equal(readFileSync(join(backup,'index-before.html')).length,0);
});

test('HTML symlink is backed up and replaced without changing its target',t=>{
  const {build,live,backup}=fixture(t),target=join(live,'old-entry.html');
  writeFileSync(target,'original linked html');rmSync(join(live,'index.html'));
  try{symlinkSync(target,join(live,'index.html'));}catch(error){if(error.code==='EPERM'){t.skip('Host disallows symlinks');return;}throw error;}
  const result=publishFrontendBuild(build,live,backup);
  assert.equal(result.previousEntry,'symlink');assert.equal(lstatSync(join(live,'index.html')).isSymbolicLink(),false);
  assert.equal(readFileSync(target,'utf8'),'original linked html');
  assert.equal(readFileSync(join(backup,'index-before.html'),'utf8'),'original linked html');
});
