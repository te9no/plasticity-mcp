import {NativeOperations} from '../src/native.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Disposable test target required');
const n=new NativeOperations(),report:any[]=[];
const output=resolve('../artifacts',`recovery-${Date.now()}`);await mkdir(output,{recursive:true});
try{
 const initial=await n.handle('native_connect',{targetId});
 // No geometry change: simulate a renderer operation whose reply arrives after our timeout.
 await assert.rejects(()=>n.cdp.run('async function(){await new Promise(r=>setTimeout(r,1200));return true}',[],[],{timeoutMs:20}),/outcome unknown/);
 const pending=await n.handle('native_scene');assert.ok(pending.recovery);
 await assert.rejects(()=>n.handle('native_undo'),/Inspect native_scene/);
 await assert.rejects(()=>n.handle('native_recover',{operationId:pending.recovery.operationId,fingerprint:pending.fingerprint}),/not been confirmed settled/);
 await n.handle('native_connect',{targetId});assert.ok(n.cdp.recoveryState());
 for(let i=0;i<30&&(await n.cdp.inspectGuard()).active?.state==='pending';i++)await new Promise(r=>setTimeout(r,500));
 await assert.rejects(()=>n.handle('native_recover',{operationId:pending.recovery.operationId,fingerprint:'0'.repeat(64)}),/Scene changed/);
 const observed=await n.handle('native_scene');
 const recovered=await n.handle('native_recover',{operationId:observed.recovery.operationId,fingerprint:observed.fingerprint});
 assert.equal(recovered.recovery,null);assert.deepEqual(recovered.objects,initial.objects);
 report.push({pending,observed,recovered});
 console.log('Live timeout, blocked Undo, pending recovery rejection, reconnect, stale fingerprint rejection and recovery verified');
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await n.cdp.disconnect()}
