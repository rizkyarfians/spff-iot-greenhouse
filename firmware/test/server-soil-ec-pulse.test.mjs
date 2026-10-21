import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
test('production firmware pulse handler: deadlines, durable dedup, reset, interlocks and explicit ownership release',()=>{
 const directory=mkdtempSync(join(tmpdir(),'spff-pulse-'));
 try{
  execFileSync('g++',['-std=c++11','-Wall','-Wextra','-Werror','-I',resolve('firmware/SPFF_MASTER_1_4_29_SERVER_SOIL_EC_PULSE'),
   resolve('firmware/test/server-soil-ec-pulse.cpp'),'-o',join(directory,'test')],{stdio:'pipe'});
  execFileSync(join(directory,'test'),[],{stdio:'pipe'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
