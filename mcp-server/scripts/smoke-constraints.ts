import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Disposable test target required');
const output=resolve('../artifacts',`constraints-${Date.now()}`);await mkdir(output,{recursive:true});
const report:any[]=[];
const client=new Client({name:'plasticity-constraint-test',version:'1.0.0'});
async function call(name:string,args:Record<string,unknown>={}){const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));const data=JSON.parse((r.content as any[])[0].text);report.push({name,data});console.log(name,'OK');return data}
const close=(a:number[],b:number[])=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i]!)<1e-5,`${a} != ${b}`));
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe'}));
 const sketch={points:[[0,0],[.028,.003],[.032,.018],[.001,.022]],constraints:[{type:'fixed',point:0,at:[0,0]},{type:'horizontal',a:0,b:1},{type:'vertical',a:1,b:2},{type:'horizontal',a:2,b:3},{type:'vertical',a:3,b:0},{type:'distance',a:0,b:1,value:.03},{type:'distance',a:1,b:2,value:.02}]};
 const solved=await call('native_sketch_solve',sketch);assert.ok(solved.maxResidualMeters<=1e-8);
 const before=await call('native_connect',{targetId});assert.equal(before.filename,null);
 const made=await call('native_sketch_constrained',{...sketch,closed:true,plane:'XZ',origin:[.6,.1,0]});
 const wire=made.scene.objects.find((o:any)=>!before.objects.some((p:any)=>p.id===o.id));assert.equal(wire.type,'Wire');
 close(wire.bbox.min,[.6,.1,0]);close(wire.bbox.max,[.63,.1,.02]);
 const recipe=made.recipe;recipe.constraints.find((c:any)=>c.type==='distance'&&c.a===0).value=.05;
 const changed=await call('native_sketch_constrained',{...recipe,replaceId:wire.id});
 assert.equal(changed.scene.objects.length,made.scene.objects.length);
 const fresh=changed.scene.objects.find((o:any)=>o.id===wire.id);assert.notEqual(fresh.versionId,wire.versionId);close(fresh.bbox.max,[.65,.1,.02]);
 const undone=await call('native_undo');close(undone.objects.find((o:any)=>o.id===wire.id).bbox.max,wire.bbox.max);
 const redone=await call('native_redo');close(redone.objects.find((o:any)=>o.id===fresh.id).bbox.max,fresh.bbox.max);
 const bad=await client.callTool({name:'native_sketch_constrained',arguments:{points:[[0,0],[1,0]],constraints:[{type:'fixed',point:0,at:[0,0]},{type:'fixed',point:1,at:[1,0]},{type:'distance',a:0,b:1,value:2}],replaceId:fresh.id}});assert.equal(bad.isError,true);
 const after=await call('native_scene');assert.deepEqual(after.objects,redone.objects);assert.equal(after.undoDepth,redone.undoDepth);
 await writeFile(resolve(output,'rectangle.recipe.json'),JSON.stringify(changed.recipe,null,2));
 console.log('Constrained sketch regeneration verified:',output);
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await client.close()}
