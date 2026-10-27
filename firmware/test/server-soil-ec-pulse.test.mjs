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

test('web water interlock firmware: hysteresis, enable/disable, durable revision and storage/readback failures',()=>{
 const directory=mkdtempSync(join(tmpdir(),'spff-interlock-'));
 try{
  execFileSync('g++',['-std=c++11','-Wall','-Wextra','-Werror','-I',resolve('firmware/SPFF_MASTER_1_4_30_WEB_WATER_INTERLOCK'),
    resolve('firmware/test/water-interlock.cpp'),'-o',join(directory,'test')],{stdio:'pipe'});
  execFileSync(join(directory,'test'),[],{stdio:'pipe'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('pulse handler stays compatible with firmware 1.4.30',()=>{
 const directory=mkdtempSync(join(tmpdir(),'spff-pulse-130-'));
 try{
  execFileSync('g++',['-std=c++11','-Wall','-Wextra','-Werror','-I',resolve('firmware/SPFF_MASTER_1_4_30_WEB_WATER_INTERLOCK'),
    resolve('firmware/test/server-soil-ec-pulse.cpp'),'-o',join(directory,'test')],{stdio:'pipe'});
  execFileSync(join(directory,'test'),[],{stdio:'pipe'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('independent AI: out-of-schedule pulse, scheduled preemption, clean return and fault retention',()=>{
 const directory=mkdtempSync(join(tmpdir(),'spff-independent-'));
 try{
  execFileSync('g++',['-std=c++11','-Wall','-Wextra','-Werror','-DSPFF_TEST_INDEPENDENT_AI',
   '-I',resolve('firmware/SPFF_MASTER_1_4_34_INDEPENDENT_AI'),resolve('firmware/test/server-soil-ec-pulse.cpp'),'-o',join(directory,'test')],{stdio:'pipe'});
  execFileSync(join(directory,'test'),[],{stdio:'pipe'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('production independent schedule output: timed ON/OFF, AI arbitration and pause/manual/fault gates',()=>{
 const directory=mkdtempSync(join(tmpdir(),'spff-schedules-'));
 try{
  execFileSync('g++',['-std=c++11','-Wall','-Wextra','-Werror','-I',resolve('firmware/SPFF_MASTER_1_4_34_INDEPENDENT_AI'),resolve('firmware/test/independent-schedule.cpp'),'-o',join(directory,'test')],{stdio:'pipe'});
  execFileSync(join(directory,'test'),[],{stdio:'pipe'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
