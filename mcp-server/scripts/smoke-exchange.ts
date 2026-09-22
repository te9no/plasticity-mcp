import {clientEnv} from './client-env.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Set PLASTICITY_TARGET to a disposable test window');
const client=new Client({name:'plasticity-exchange-test',version:'1.0.0'});
const output=resolve('../artifacts',`exchange-${Date.now()}`);await mkdir(output,{recursive:true});
const report:unknown[]=[];
async function call(name:string,args:Record<string,unknown>={}){const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));const data=JSON.parse((r.content as any[])[0].text);report.push({name,data});console.log(name,'OK');return data;}
const close=(actual:number[],expected:number[])=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i]!)<1e-5,`Expected ${actual} ≈ ${expected}`));
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe',env:clientEnv}));
 const before=await call('native_connect',{targetId});assert.equal(before.filename,null,'Use disposable test document');
 const created=await call('native_create_primitive',{shape:'box',origin:[0.02,0,0],size:[0.03,0.02,0.01]});
 const id=created.objects.find((o:any)=>!before.objects.some((b:any)=>b.id===o.id)).id;
 const rotated=await call('native_rotate',{ids:[id],pivot:[0.02,0,0],axis:[0,0,2],angleDegrees:90});
 const rb=rotated.objects.find((o:any)=>o.id===id).bbox;close(rb.min,[0,0,0]);close(rb.max,[0.02,0.03,0.01]);
 const scaled=await call('native_scale',{ids:[id],pivot:[0.02,0,0],factors:[2,3,4]});
 const sb=scaled.objects.find((o:any)=>o.id===id).bbox;close(sb.min,[-0.02,0,0]);close(sb.max,[0.02,0.09,0.04]);
 const undo=await call('native_undo');close(undo.objects.find((o:any)=>o.id===id).bbox.max,rb.max);await call('native_redo');
 const path=resolve(output,'roundtrip.step');const exported=await call('native_export_step',{ids:[id],path});assert.ok(exported.bytes>100);
 const step=await readFile(path,'utf8');assert.match(step,/MANIFOLD_SOLID_BREP/);
 const duplicate=await client.callTool({name:'native_export_step',arguments:{ids:[id],path}});assert.equal(duplicate.isError,true);assert.equal(await readFile(path,'utf8'),step);
 const imported=await call('native_import_step',{path});
 const additions=imported.objects.filter((o:any)=>!scaled.objects.some((b:any)=>b.id===o.id));assert.equal(additions.length,1);assert.equal(additions[0].type,'Solid');close(additions[0].bbox.min,sb.min);close(additions[0].bbox.max,sb.max);
 const reverted=await call('native_undo');assert.equal(reverted.objects.length,scaled.objects.length);await call('native_redo');
 console.log('Transform + exact STEP round-trip verified:',path);
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await client.close()}
