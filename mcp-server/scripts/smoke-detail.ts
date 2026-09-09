import {NativeOperations} from '../src/native.js';
import assert from 'node:assert/strict';
const n=new NativeOperations();
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Disposable test target required');
try{
 const before:any=await n.handle('native_connect',{targetId});
 const created:any=await n.handle('native_create_primitive',{shape:'box',origin:[6,0,0],size:[1,1,1]});
 const id=created.objects.find((o:any)=>!before.objects.some((b:any)=>b.id===o.id)).id;
 const top:any=await n.handle('native_topology',{id});assert.equal(top.edgeIds.length,12);assert.equal(top.faceIds.length,6);
 console.log('Topology OK',top);
 const extruded:any=await n.handle('native_extrude_faces',{id,faceIds:[top.faceIds[0]],distance:0.3});
 assert.ok(extruded.objects.length>created.objects.length);console.log('Extrusion OK');
 const filleted:any=await n.handle('native_fillet',{id,edgeIds:[top.edgeIds[0]],radius:0.1});
 const fresh:any=await n.handle('native_topology',{id});assert.ok(fresh.faceIds.length>6);console.log('Fillet OK',filleted.objects.find((o:any)=>o.id===id));
 await assert.rejects(()=>n.handle('native_fillet',{id,edgeIds:[top.edgeIds[0]],radius:0.1}),/Stale/);
 console.log('Stale topology rejection OK');
}finally{await n.cdp.disconnect()}
