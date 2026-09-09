import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {resolve} from 'node:path';
import {appendFile} from 'node:fs/promises';
const client=new Client({name:'tokyo-connectors-mcp-only',version:'1.0.0'}),output=resolve('../models/tokyo-station');
async function call(name,args={}){const r=await client.callTool({name,arguments:args},undefined,{timeout:120000});await appendFile(resolve(output,'connectors-calls.jsonl'),JSON.stringify({name,arguments:args,isError:!!r.isError})+'\n');if(r.isError)throw new Error(JSON.stringify(r.content));return JSON.parse(r.content[0].text)}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe'}));
 const scene=await call('native_connect',{targetId:process.env.PLASTICITY_TARGET});
 if(scene.objects.some(o=>o.name?.startsWith('15-connectors/')))throw new Error('Connectors already exist');
 const m=await call('native_materials'),material=name=>m.find(m=>m.name===name).id;
 const parts=[];let i=0;
 const box=(x,y,z,w,d,h,name,mat)=>parts.push({shape:'box',origin:[x,y,z].map(v=>v/1000),size:[w,d,h].map(v=>v/1000),name:`15-connectors/${name}-${++i}`,materialId:material(mat)});
 for(const x of [-21,15]){
  box(x,-10.5,0,6,21,22,'brick-link','Tokyo red brick');
  box(x,-10.7,22,6,21.4,1,'roof-link','Slate roof');
  for(const z of [1,8,15,21.3])box(x,-10.85,z,6,.5,.65,'course','Warm limestone');
  for(const z of [2.3,9.3,16.3]){
   box(x+1.35,-11.15,z,3.3,.65,4.8,'window-frame','Warm limestone');
   box(x+1.73,-11.36,z+.4,2.54,.25,4,'glass','Dark blue glazing');
   box(x+2.9,-11.43,z+.4,.18,.15,4,'mullion','Warm limestone');
  }
 }
 const result=await call('native_create_primitives',{parts});await call('native_group',{ids:result.createdIds,name:'15-central-connectors'});
 await call('native_view',{view:'isometric',fit:true,materials:true,edges:false});
 await call('native_save_copy',{path:resolve(output,'tokyo-station-final.plasticity')});
 console.log('Station connectors and final native file saved');
}finally{await client.close()}
