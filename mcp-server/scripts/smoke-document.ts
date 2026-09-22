import {clientEnv} from './client-env.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Disposable test target required');
const output=resolve('../artifacts',`document-${Date.now()}`);await mkdir(output,{recursive:true});
const client=new Client({name:'plasticity-document-test',version:'1.0.0'}),report:any[]=[];
async function call(name:string,args:Record<string,unknown>={}){const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));const data=JSON.parse((r.content as any[])[0].text);report.push({name,data});return data}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe',env:clientEnv}));
 const initial=await call('native_connect',{targetId});
 const created=await call('native_create_primitive',{shape:'box',origin:[.8,0,0],size:[.01,.02,.03]});
 const object=created.objects.find((o:any)=>!initial.objects.some((p:any)=>p.id===o.id));assert.ok(object);
 const renamed=await call('native_rename',{id:object.id,name:'部品テスト'});assert.equal(renamed.objects.find((o:any)=>o.id===object.id).name,'部品テスト');
 const undone=await call('native_undo');assert.equal(undone.objects.find((o:any)=>o.id===object.id).name,object.name);
 const redone=await call('native_redo');assert.equal(redone.objects.find((o:any)=>o.id===object.id).name,'部品テスト');
 const path=resolve(output,'document.plasticity');await call('native_save_copy',{path});
 const data=await readFile(path);assert.ok(data.length>100);
 await assert.rejects(()=>call('native_save_copy',{path}),/EEXIST/);
 assert.deepEqual(await readFile(path),data);
 const after=await call('native_scene');assert.equal(after.filename,initial.filename);assert.deepEqual(after.objects,redone.objects);assert.equal(after.undoDepth,redone.undoDepth);
 console.log('MCP rename, Undo/Redo, native save copy and overwrite refusal verified:',path);
}finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));await client.close()}
