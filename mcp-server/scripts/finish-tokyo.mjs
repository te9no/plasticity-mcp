import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {writeFile,appendFile,readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const targetId=process.env.PLASTICITY_TARGET;if(!targetId)throw new Error('Target required');
const output=resolve('../models/tokyo-station'),client=new Client({name:'tokyo-station-mcp-finishing',version:'1.0.0'});
const log=resolve(output,'finish-calls.jsonl');
async function call(name,args={}){const r=await client.callTool({name,arguments:args},undefined,{timeout:120000});await appendFile(log,JSON.stringify({name,arguments:args,isError:!!r.isError})+'\n');if(r.isError)throw new Error(JSON.stringify(r.content));return name==='native_screenshot'?r:JSON.parse(r.content[0].text)}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe'}));
 await call('native_connect',{targetId});
 await call('native_view',{view:'front',fit:true,materials:true,edges:false});
 let shot=await call('native_screenshot');await writeFile(resolve(output,'front.png'),Buffer.from(shot.content[0].data,'base64'));
 await call('native_view',{view:'isometric',fit:true,materials:true,edges:false});
 shot=await call('native_screenshot');await writeFile(resolve(output,'isometric.png'),Buffer.from(shot.content[0].data,'base64'));
 if(process.argv.includes('--preview-only'))process.exitCode=0;
 else{
  const scene=await call('native_scene'),ids=scene.objects.map(o=>o.id);
  await call('native_export_step',{ids,path:resolve(output,'tokyo-station.step')});console.log('STEP exported');
  await call('native_export_obj',{ids,path:resolve(output,'tokyo-station.obj')});console.log('OBJ exported');
  const files=(await readdir(output)).filter(f=>f.endsWith('.jsonl'));const calls=(await Promise.all(files.map(f=>readFile(resolve(output,f),'utf8')))).flatMap(t=>t.trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)));
  if(calls.some(c=>c.name==='native_execute_script'||/^native_import/.test(c.name)))throw new Error('Unexpected geometry source');
  await writeFile(resolve(output,'manifest.json'),JSON.stringify({name:'Tokyo Station Marunouchi facade',scale:'approximately 1:1000',coordinateUnits:'meters',method:'Named MCP tools only; no geometry imports or renderer scripts',successfulCalls:calls.filter(c=>!c.isError).length,objects:scene.objects.length,scene,materials:await call('native_materials'),sources:['https://www.tokyostationcity.com/learning/station_building/','https://www.gov-online.go.jp/hlj/ja/february_2025/february_2025-03.html'],limitations:'Exterior study. Dimensions except nominal overall length are inferred. Not a measured survey or print-ready unified solid.'},null,2));
  console.log('Complete:',ids.length,'CAD parts');
 }
}finally{await client.close()}
