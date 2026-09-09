import {NativeOperations} from '../src/native.js';
import assert from 'node:assert/strict';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Disposable target required');
const n=new NativeOperations();
try{
 const start=await n.handle('native_connect',{targetId});
 const made=await n.handle('native_create_primitives',{parts:[{shape:'box',origin:[.1,.4,0],size:[.02,.02,.02],name:'batch box'},{shape:'sphere',origin:[.15,.4,0],radius:.01,name:'batch sphere'},{shape:'cylinder',origin:[.18,.4,0],radius:.01,height:.03,name:'batch cylinder'}]});
 assert.equal(made.createdIds.length,3);assert.equal(made.scene.undoDepth,start.undoDepth+1);
 assert.ok(made.scene.objects.some((o:any)=>o.name==='batch cylinder'));
 await n.handle('native_undo');assert.equal((await n.scene()).objects.length,start.objects.length);await n.handle('native_redo');
 await assert.rejects(()=>n.handle('native_create_primitives',{parts:[{shape:'box',origin:[0,0,0],size:[.1,.1,.1]},{shape:'sphere',origin:[0,0,0]}]}),/Radius required/);
 assert.equal((await n.scene()).objects.length,start.objects.length+3);
 // Exercise both remaining boolean operations on overlapping boxes.
 for(const operation of ['union','intersection']){
  const b=await n.handle('native_create_primitives',{parts:[{shape:'box',origin:[.3,.4,0],size:[.02,.02,.02]},{shape:'box',origin:[.31,.4,0],size:[.02,.02,.02]}]});
  const result=await n.handle('native_boolean',{targetIds:[b.createdIds[0]],toolIds:[b.createdIds[1]],operation});
  const solid=result.objects.find((o:any)=>o.id===b.createdIds[0]);assert.ok(solid);
  const width=solid.bbox.max[0]-solid.bbox.min[0];assert.ok(Math.abs(width-(operation==='union'?.03:.01))<1e-6);
 }
 console.log('Batch primitives, one-step Undo/Redo, input rejection, boolean union and intersection verified');
}finally{await n.cdp.disconnect()}
