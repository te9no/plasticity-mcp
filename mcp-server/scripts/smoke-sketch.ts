import {NativeOperations} from '../src/native.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const n=new NativeOperations(),targetId=process.env.PLASTICITY_TARGET;
if(!targetId)throw new Error('Disposable test target required');
const output=resolve('../artifacts',`sketch-${Date.now()}`);await mkdir(output,{recursive:true});
const report:any[]=[];
async function call(name:string,args:unknown={}){const data:any=await n.handle(name,args);report.push({name,data});console.log(name,'OK');return data}
const close=(a:number[],b:number[])=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i]!)<1e-5,`${a} != ${b}`));
function added(a:any,b:any){return b.objects.filter((o:any)=>!a.objects.some((p:any)=>p.id===o.id))}
try{
 let before=await call('native_connect',{targetId});assert.equal(before.filename,null);
 const poly=await call('native_sketch_curve',{kind:'polyline',closed:true,points:[[.1,.1,0],[.13,.1,0],[.13,.12,0],[.1,.12,0]]});
 const wires=added(before,poly);assert.equal(wires.length,1);close(wires[0].bbox.min,[.1,.1,0]);close(wires[0].bbox.max,[.13,.12,0]);
 const undone=await call('native_undo');assert.equal(undone.objects.length,before.objects.length);await call('native_redo');
 before=await call('native_scene');const circle=await call('native_sketch_circle',{center:[.2,.1,0],normal:[0,2,0],radius:.01});
 const ring=added(before,circle);assert.equal(ring.length,1);close(ring[0].bbox.min,[.19,.1,-.01]);close(ring[0].bbox.max,[.21,.1,.01]);
 const spline=await call('native_sketch_curve',{kind:'spline',points:[[.3,0,0],[.31,.01,0],[.32,0,0],[.33,.01,0]]});assert.equal(added(circle,spline).length,1);
 const box=await call('native_create_primitive',{shape:'box',origin:[.4,0,0],size:[.03,.02,.01]});const solid=added(spline,box)[0];
 const path=resolve(output,'box.iges');await call('native_export_iges',{ids:[solid.id],path});const contents=await readFile(path,'utf8');
 await assert.rejects(()=>n.handle('native_export_iges',{ids:[solid.id],path}),/EEXIST/);assert.equal(await readFile(path,'utf8'),contents);
 const imported=await call('native_import_iges',{path});const additions=added(box,imported);assert.ok(additions.length>=1);
 const min=[0,1,2].map(i=>Math.min(...additions.map((o:any)=>o.bbox.min[i]))),max=[0,1,2].map(i=>Math.max(...additions.map((o:any)=>o.bbox.max[i])));
 close(min,solid.bbox.min);close(max,solid.bbox.max);
 const reverted=await call('native_undo');assert.equal(reverted.objects.length,box.objects.length);await call('native_redo');
 console.log('Sketch and IGES verified:',output);
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await n.cdp.disconnect()}
