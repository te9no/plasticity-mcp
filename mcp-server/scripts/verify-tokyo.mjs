import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {writeFile,appendFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const client=new Client({name:'tokyo-native-roundtrip',version:'1.0.0'}),output=resolve('../models/tokyo-station');
async function call(name,args={}){const r=await client.callTool({name,arguments:args},undefined,{timeout:120000});await appendFile(resolve(output,'verify-calls.jsonl'),JSON.stringify({name,arguments:args,isError:!!r.isError})+'\n');if(r.isError)throw new Error(JSON.stringify(r.content));return JSON.parse(r.content[0].text)}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe'}));
 const targetId=process.env.PLASTICITY_TARGET,before=await call('native_connect',{targetId});assert.equal(before.objects.length,1082);
 await call('native_open_document',{path:resolve(output,'tokyo-station-final.plasticity'),backupPath:resolve(output,`before-roundtrip-${Date.now()}.plasticity`),fingerprint:before.fingerprint});
 const after=await call('native_connect',{targetId});assert.equal(after.objects.length,1082);
 const reference=JSON.parse(await readFile(resolve(output,'manifest.json'),'utf8')).scene;
 const comparable=scene=>scene.objects.map(o=>({name:o.name,materialId:o.materialId,parentId:o.parentId})).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 assert.deepEqual(comparable(after),comparable(reference));
 let maxBoundsDifferenceMeters=0;
 for(const actual of after.objects){const expected=reference.objects.find(o=>o.name===actual.name);for(const end of ['min','max'])for(let i=0;i<3;i++)maxBoundsDifferenceMeters=Math.max(maxBoundsDifferenceMeters,Math.abs(actual.bbox[end][i]-expected.bbox[end][i]))}
 // Bounds are tessellation-derived, not exact B-Rep bounds. Native reopen re-meshes curved faces.
 assert.ok(maxBoundsDifferenceMeters<=.00005,'Native remeshing bounds difference exceeds 0.05 mm: '+maxBoundsDifferenceMeters);
 await call('native_view',{view:'isometric',fit:true,materials:true,edges:false});
 await writeFile(resolve(output,'roundtrip-verification.json'),JSON.stringify({passed:true,objects:after.objects.length,path:after.filename,compared:['names','materials','parent groups','tessellated bounds (0.05 mm tolerance)'],maxBoundsDifferenceMeters,documentChanged:before.documentToken!==after.documentToken},null,2));
 console.log('1082-part native file roundtrip passed, with names, materials, groups and bounds preserved');
}finally{await client.close()}
