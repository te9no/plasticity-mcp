import {NativeOperations} from '../src/native.js';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Disposable target required');
const n=new NativeOperations();
let child:ReturnType<typeof spawn>|undefined;
try{
 const before=await n.handle('native_connect',{targetId});
 const code=`import {PlasticityCdp} from './dist/cdp.js';const c=new PlasticityCdp();await c.connect(${JSON.stringify(targetId)});await c.run('async function(){await new Promise(r=>setTimeout(r,2500));return true}');await c.disconnect();`;
 child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:'ignore'});
 let active:any;
 for(let i=0;i<40;i++){active=(await n.cdp.inspectGuard()).active;if(active)break;await new Promise(r=>setTimeout(r,100))}
 assert.equal(active?.state,'pending');
 const exited=new Promise<void>(r=>child!.once('exit',()=>r()));child.kill();await exited;
 await n.cdp.disconnect();
 const restarted=new NativeOperations();
 try{
  const observed=await restarted.handle('native_connect',{targetId});assert.equal(observed.recovery.operationId,active.operationId);
  await assert.rejects(()=>restarted.handle('native_undo'),/Inspect native_scene/);
  for(let i=0;i<50&&(await restarted.cdp.inspectGuard()).active?.state==='pending';i++)await new Promise(r=>setTimeout(r,200));
  const scene=await restarted.scene();await restarted.handle('native_recover',{operationId:scene.recovery.operationId,fingerprint:scene.fingerprint});
  assert.deepEqual((await restarted.scene()).objects,before.objects);
 }finally{await restarted.cdp.disconnect()}
 console.log('Killed MCP worker; durable journal, blocked retry and restart recovery verified');
}finally{if(child&&child.exitCode===null)child.kill();await n.cdp.disconnect()}
