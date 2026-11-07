import {constants,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,chmodSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

function inside(root,name) {
  if(typeof name!=='string'||!name||isAbsolute(name)||name.includes('\\'))throw Error('Invalid asset path: '+name);
  const path=resolve(root,name);
  if(!path.startsWith(root+sep))throw Error('Asset escapes build root: '+name);
  return path;
}
function regular(path) {
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size===0)throw Error('Expected nonempty regular file: '+path);
  return path;
}
function safeParent(root,path) {
  const parts=relative(root,dirname(path)).split(sep).filter(Boolean);
  let current=root;
  for(const part of parts){
    current=join(current,part);
    if(!existsSync(current))mkdirSync(current,{mode:0o755});
    const info=lstatSync(current);
    if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unexpected asset directory: '+current);
  }
}
function atomicCopy(source,target) {
  const temp=join(dirname(target),'.frontend-publish-'+randomUUID());
  try{copyFileSync(source,temp,constants.COPYFILE_EXCL);chmodSync(temp,0o644);renameSync(temp,target);}
  finally{if(existsSync(temp))rmSync(temp);}
}

/** Restore conflicting bytes with a backup; commit the HTML entry only after all dependencies verify. */
export function publishFrontendBuild(buildPath,livePath,backupPath) {
  const build=realpathSync(buildPath),live=realpathSync(livePath);
  if(build===live||build.startsWith(live+sep)||live.startsWith(build+sep))throw Error('Build and live directories must be separate');
  const manifest=JSON.parse(readFileSync(join(build,'.vite/manifest.json'),'utf8'));
  const html=readFileSync(regular(join(build,'index.html')),'utf8');
  const modules=[...html.matchAll(/<script\b([^>]*)>/gi)].flatMap(match=>{
    const attrs=match[1],type=/\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const src=/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    return type==='module'&&src?[src.replace(/^\//,'')]:[];
  });
  if(!Object.values(manifest).some(entry=>entry.isEntry&&modules.includes(entry.file)))throw Error('HTML module entry missing from manifest');
  for(const entry of Object.values(manifest)) {
    for(const key of [...(entry.imports??[]),...(entry.dynamicImports??[])])if(!manifest[key])throw Error('Missing manifest dependency: '+key);
    for(const name of [entry.file,...(entry.assets??[]),...(entry.css??[])])regular(inside(build,name));
  }
  const files=[];
  function collect(dir) {
    for(const name of readdirSync(dir)) {
      if(dir===build&&(name==='.vite'||name==='index.html'))continue;
      const path=join(dir,name),info=lstatSync(path);
      if(info.isSymbolicLink())throw Error('Unexpected build symlink: '+path);
      if(info.isDirectory())collect(path);
      else {regular(path);files.push(relative(build,path).split(sep).join('/'));}
    }
  }
  collect(build);
  const backupResolved=resolve(backupPath);
  if(backupResolved===live||backupResolved.startsWith(live+sep))throw Error('Backup must be outside the live frontend');
  mkdirSync(backupResolved,{recursive:true,mode:0o700});
  const backup=realpathSync(backupResolved);
  if(backup===live||backup.startsWith(live+sep))throw Error('Backup resolves inside the live frontend');
  regular(join(live,'index.html'));
  const indexBackup=join(backup,'index-before.html');
  if(!existsSync(indexBackup))copyFileSync(join(live,'index.html'),indexBackup,constants.COPYFILE_EXCL);
  let replaced=0,added=0;
  for(const name of files) {
    const source=inside(build,name),target=inside(live,name);
    safeParent(live,target);
    if(existsSync(target)) {
      const info=lstatSync(target);
      if(!info.isFile()||info.isSymbolicLink())throw Error('Unexpected live asset: '+target);
      if(readFileSync(source).equals(readFileSync(target)))continue;
      const saved=inside(backup,'assets-before/'+name);
      safeParent(backup,saved);
      if(!existsSync(saved))copyFileSync(target,saved,constants.COPYFILE_EXCL);
      replaced++;
    }else added++;
    atomicCopy(source,target);
  }
  for(const name of files)if(!readFileSync(inside(build,name)).equals(readFileSync(inside(live,name))))throw Error('Asset verification failed: '+name);
  atomicCopy(join(build,'index.html'),join(live,'index.html'));
  if(!readFileSync(join(build,'index.html')).equals(readFileSync(join(live,'index.html'))))throw Error('HTML verification failed');
  return {files:files.length,replaced,added,backup};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==5)throw Error('Usage: node publish-orange-frontend.mjs BUILD_DIST LIVE_DIST BACKUP_DIR');
    const result=publishFrontendBuild(...process.argv.slice(2));
    console.log('FRONTEND_PUBLISH=SUCCESS; '+JSON.stringify(result));
  }catch(error){console.error('STOP: '+error.message);process.exitCode=1;}
}
