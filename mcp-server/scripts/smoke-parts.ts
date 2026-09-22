import {NativeOperations} from '../src/native.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Disposable target required');
const output=resolve('../artifacts',`parts-${Date.now()}`);await mkdir(output,{recursive:true});
const n=new NativeOperations(),report:any[]=[];
async function call(name:string,args:Record<string,unknown>={}){const r=await n.handle(name,args);report.push({name,result:r});console.log(name,'OK');return r}
try{
 const start=await call('native_connect',{targetId});
 const made=await call('native_create_primitive',{shape:'box',origin:[.9,0,0],size:[.01,.02,.03]});
 const id=made.objects.find((x:any)=>!start.objects.some((y:any)=>y.id===x.id)).id;
 const colored=await call('native_set_material',{ids:[id],name:'赤レンガ',color:'#9e4538'});
 const materialId=colored.objects.find((o:any)=>o.id===id).materialId;assert.ok(materialId>0);
 assert.equal((await call('native_materials')).find((m:any)=>m.id===materialId).color,'#9e4538');
 await call('native_undo');assert.equal((await n.scene()).objects.find((o:any)=>o.id===id).materialId,0);await call('native_redo');
 const hidden=await call('native_visibility',{ids:[id],hidden:true});assert.equal(hidden.objects.find((o:any)=>o.id===id).hidden,true);
 await call('native_undo');assert.equal((await n.scene()).objects.find((o:any)=>o.id===id).hidden,false);
 const grouped=await call('native_group',{ids:[id],name:'検証用グループ'});
 const group=grouped.groups.find((g:any)=>!start.groups.some((p:any)=>p.id===g.id));assert.equal(group.name,'検証用グループ');assert.equal(grouped.objects.find((o:any)=>o.id===id).parentId,group.id);
 await call('native_undo');assert.equal((await n.scene()).groups.length,start.groups.length);await call('native_redo');
 const path=resolve(output,'roundtrip.plasticity');await call('native_save_copy',{path});
 await call('native_delete',{ids:[id]});assert.ok(!(await n.scene()).objects.some((o:any)=>o.id===id));
 const inspect=await n.scene();
 await call('native_open_document',{path,backupPath:resolve(output,'before-open.plasticity'),fingerprint:inspect.fingerprint});
 const loaded=await call('native_connect',{targetId});
 assert.equal(loaded.filename,path);
 assert.ok(loaded.objects.some((o:any)=>o.name===grouped.objects.find((o:any)=>o.id===id).name&&o.materialId===materialId));
 assert.equal(loaded.objects.length,grouped.objects.length);assert.ok(loaded.groups.some((g:any)=>g.name==='検証用グループ'));
 await call('native_view',{view:'front',mode:'orthographic',fit:true});
 await call('native_view',{view:'isometric',fit:true,materials:true});
 const projected=await n.cdp.run(`function(){const c=Array.from(this.viewports)[0].camera;let maximum=0;for(const {view} of (this.db.items??Array.from(this.db.geo.geometryModel.values()))){if(!view.boundingBox||this.db.nodes.isHidden(this.db.items?view:this.db.nodes.item2key(view)))continue;const b=view.boundingBox;for(let i=0;i<8;i++){const p=b.min.clone().set(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z).project(c);maximum=Math.max(maximum,Math.abs(p.x),Math.abs(p.y))}}return maximum}`,[],[],{readOnly:true});
 assert.ok(projected<=1,'Camera fit must keep every visible bounds corner in the viewport: '+projected);
 const shot=await call('native_screenshot');await writeFile(resolve(output,'preview.png'),Buffer.from(shot.content[0].data,'base64'));
 console.log('Parts and native document roundtrip verified:',output);
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report.map(r=>r.name==='native_screenshot'?{name:r.name}:r),null,2));await n.cdp.disconnect()}
