import {lstatSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function files(root,dir=root) {
  return readdirSync(dir).flatMap(name=>{
    const path=join(dir,name),info=lstatSync(path);
    if(info.isSymbolicLink())throw Error('Unexpected compiled-runtime symlink: '+path);
    return info.isDirectory()?files(root,path):[path.slice(root.length+1)];
  });
}
export function verifyApiRuntime(kind,path) {
  if(!['api','contracts'].includes(kind))throw Error('Expected api or contracts');
  const root=realpathSync(path),all=files(root),js=all.filter(name=>name.endsWith('.js'));
  if(!js.length)throw Error('No compiled JavaScript in '+root);
  for(const name of js)if(readFileSync(join(root,name)).length===0)throw Error('Empty compiled module: '+name);
  const required=kind==='api'?{
    'local.js':/\bapp\.listen\s*\(/,
    'app.js':/export\s+(?:const|let|var)\s+app\s*=/,
    'routes/index.js':/['"]\/auth\/login['"]/,
  }:{'index.js':/\bexport\b/};
  for(const [name,pattern] of Object.entries(required))if(!pattern.test(readFileSync(join(root,name),'utf8')))
    throw Error('Required runtime behavior missing: '+name);
  return {root,files:all,modules:js.length};
}
export function verifyRuntimeCopy(kind,source,target) {
  const a=verifyApiRuntime(kind,source),b=verifyApiRuntime(kind,target);
  for(const name of a.files)if(!readFileSync(join(a.root,name)).equals(readFileSync(join(b.root,name))))
    throw Error('Compiled copy mismatch: '+name);
  return {modules:a.modules,files:a.files.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{
    const [kind,source,target]=process.argv.slice(2);
    const result=target?verifyRuntimeCopy(kind,source,target):verifyApiRuntime(kind,source);
    console.log('RUNTIME_VERIFY=PASS; kind='+kind+'; modules='+result.modules);
  }catch(error){console.error('STOP: '+error.message);process.exitCode=1;}
}
