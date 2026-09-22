import {clientEnv} from './client-env.js';
// Explicit, opt-in live test. Creates geometry only in the specified disposable window.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const targetId=process.env.PLASTICITY_TARGET;
if(!targetId)throw new Error('Set PLASTICITY_TARGET to a disposable Plasticity window ID');
const output=resolve('..','artifacts',`native-smoke-${Date.now()}`);
await mkdir(output,{recursive:true});
const client=new Client({name:'plasticity-live-verifier',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe',env:clientEnv});
const report:any[]=[];
async function call(name:string,args:Record<string,unknown>={}){
 const r=await client.callTool({name,arguments:args});
 if(r.isError)throw new Error(`${name}: ${JSON.stringify(r.content)}`);
 const content=r.content as any[];
 const value=content[0]?.type==='text'?JSON.parse(content[0].text):content;
 report.push({name,result:value});console.log(`${name}: OK`);return value;
}
function newId(before:any,after:any){const old=new Set(before.objects.map((o:any)=>o.id));const added=after.objects.filter((o:any)=>!old.has(o.id));assert.equal(added.length,1);return added[0].id;}
try{
 await client.connect(transport);
 const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='native_create_primitive'));
 const before=await call('native_connect',{targetId});
 assert.equal(before.filename,null,'Use an unsaved disposable window');
 let scene=await call('native_create_primitive',{shape:'box',origin:[2,0,0],size:[1,1,1]});
 const box=newId(before,scene);const boxScene=scene;
 const boxBounds=scene.objects.find((o:any)=>o.id===box).bbox;assert.deepEqual(boxBounds,{min:[2,0,0],max:[3,1,1]});
 scene=await call('native_create_primitive',{shape:'cylinder',origin:[2.5,0.5,-0.2],radius:0.2,height:1.4});
 const cylinder=newId(boxScene,scene);const cylinderScene=scene;
 const cb=scene.objects.find((o:any)=>o.id===cylinder).bbox;assert.ok(Math.abs(cb.max[2]-cb.min[2]-1.4)<0.001);
 scene=await call('native_create_primitive',{shape:'sphere',origin:[4,0,0.5],radius:0.5});
 const sphere=newId(cylinderScene,scene);const sphereBefore=scene.objects.find((o:any)=>o.id===sphere);
 scene=await call('native_move',{ids:[sphere],delta:[0,1,0]});
 const sphereAfter=scene.objects.find((o:any)=>o.id===sphere);
 assert.ok(Math.abs(sphereAfter.bbox.min[1]-sphereBefore.bbox.min[1]-1)<0.01,'Sphere moved by one scene unit');
 await call('native_undo');scene=await call('native_redo');
 assert.ok(Math.abs(scene.objects.find((o:any)=>o.id===sphere).bbox.min[1]-sphereAfter.bbox.min[1])<0.01);
 await call('native_select',{ids:[box,cylinder]});
 scene=await call('native_boolean',{targetIds:[box],toolIds:[cylinder],operation:'difference',keepTools:false});
 assert.equal(scene.objects.length,before.objects.length+2);
 const exportIds=scene.objects.filter((o:any)=>!before.objects.some((b:any)=>b.id===o.id)).map((o:any)=>o.id);
 const exportResult=await call('native_export_obj',{ids:exportIds,path:resolve(output,'demo.obj')});
 const obj=await readFile(exportResult.path,'utf8');assert.match(obj,/^v /m);assert.match(obj,/^f /m);
 const vertices=obj.split('\n').filter(l=>l.startsWith('v ')).map(l=>l.split(' ').slice(1).map(Number));
 const sphereVertices=vertices.filter(p=>p[0]!>3.4);assert.ok(sphereVertices.length>10);
 assert.ok(Math.abs(Math.min(...sphereVertices.map(p=>p[1]!))-sphereAfter.bbox.min[1])<0.01,'Export includes movement');
 const duplicate=await client.callTool({name:'native_export_obj',arguments:{ids:exportIds,path:exportResult.path}});assert.equal(duplicate.isError,true,'Existing files must not be overwritten');
 const shot=await client.callTool({name:'native_screenshot',arguments:{}});assert.ok(!shot.isError);const im=(shot.content as any[])[0];assert.equal(im.type,'image');await writeFile(resolve(output,'viewport.png'),Buffer.from(im.data,'base64'));
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
 console.log(`Live MCP verification passed. Artifacts: ${output}`);
}finally{await client.close()}
