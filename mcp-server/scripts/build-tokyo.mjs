// This client only sends named MCP tool calls. It never executes renderer scripts or imports geometry.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const targetId=process.env.PLASTICITY_TARGET;
if(!targetId)throw new Error('Set PLASTICITY_TARGET to the dedicated model window.');
const output=resolve('../models/tokyo-station');
await mkdir(resolve('../models'),{recursive:true});
// Refuse an existing run before connecting or changing the document.
await mkdir(output);
const run=Date.now(),log=resolve(output,`mcp-calls-${run}.jsonl`);
const client=new Client({name:'tokyo-station-mcp-only',version:'1.0.0'});
const allowed=new Set(['native_connect','native_scene','native_save_copy','native_delete','native_create_primitive','native_create_primitives','native_set_material','native_materials','native_rotate','native_scale','native_boolean','native_rename','native_group','native_view','native_export_step','native_export_obj','native_screenshot','native_open_document']);
let scene,calls=0;const palette={};
async function call(name,args={}){
 assert.ok(allowed.has(name),'Not permitted in this MCP-only build: '+name);
 const result=await client.callTool({name,arguments:args},undefined,{timeout:120000});
 await appendFile(log,JSON.stringify({sequence:++calls,name,arguments:args,isError:!!result.isError})+'\n');
 if(result.isError)throw new Error(JSON.stringify(result.content));
 if(name==='native_screenshot')return result;
 const data=JSON.parse(result.content[0].text);if(data.objects)scene=data;if(data.scene)scene=data.scene;
 return data;
}
const mm=x=>x/1000,V=xs=>xs.map(mm);
let parts=[],counter=0;
const box=(group,label,x,y,z,w,d,h,mat)=>parts.push({shape:'box',origin:V([x,y,z]),size:V([w,d,h]),name:`${group}/${label}-${++counter}`,materialId:palette[mat]});
const sphere=(group,label,x,y,z,r,mat)=>parts.push({shape:'sphere',origin:V([x,y,z]),radius:mm(r),name:`${group}/${label}-${++counter}`,materialId:palette[mat]});
const cylinder=(group,label,x,y,z,r,h,mat)=>parts.push({shape:'cylinder',origin:V([x,y,z]),radius:mm(r),height:mm(h),name:`${group}/${label}-${++counter}`,materialId:palette[mat]});
async function flush(){for(let i=0;i<parts.length;i+=100){const data=await call('native_create_primitives',{parts:parts.slice(i,i+100)});assert.equal(data.createdIds.length,parts.slice(i,i+100).length);console.log('Created',scene.objects.length,'CAD parts')}parts=[]}
const byName=fragment=>{const o=scene.objects.find(o=>o.name?.includes(fragment));if(!o)throw new Error('Part not found: '+fragment);return o.id};
async function rotate(fragment,pivot,axis,angle){await call('native_rotate',{ids:[byName(fragment)],pivot:V(pivot),axis,angleDegrees:angle})}
function windowAt(group,x,y,z,w=3.3,h=5.0){
 box(group,'stone-window-frame',x-w/2,y-.65,z,w,.65,h,'stone');
 box(group,'recessed-glass',x-w/2+.38,y-.84,z+.4,w-.76,.22,h-.8,'glass');
 box(group,'window-mullion',x-.09,y-.9,z+.4,.18,.16,h-.8,'stone');
 box(group,'window-transom',x-w/2+.38,y-.91,z+h*.55,w-.76,.16,.16,'stone');
}
function facade(group,x0,width,depth,height,bays){
 box(group,'brick-mass',x0-width/2,-depth/2,0,width,depth,height,'brick');
 for(const z of [1,8,15,height-.7])box(group,'limestone-course',x0-width/2-.2,-depth/2-.35,z,width+.4,depth+.7,.65,'stone');
 for(let i=0;i<bays;i++)for(const z of [2.3,9.3,16.3])windowAt(group,x0-width/2+(i+.5)*width/bays,-depth/2,z,3.2,4.8);
 for(const x of [x0-width/2+.2,x0+width/2-1])for(let z=1;z<height-1;z+=1.65)box(group,'corner-quoin',x,-depth/2-.55,z,.85,.55,.65,'stone');
}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/index.js')],stderr:'pipe'}));
 await call('native_connect',{targetId});
 if(scene.objects.length){
  if(process.env.PLASTICITY_ALLOW_CLEAR_TARGET!==targetId)throw new Error('Target is not empty. Use a new document, or explicitly authorize this exact test target with PLASTICITY_ALLOW_CLEAR_TARGET.');
  await call('native_save_copy',{path:resolve(output,`before-tokyo-${run}.plasticity`)});
  await call('native_delete',{ids:scene.objects.map(o=>o.id)});
 }
 const base=await call('native_create_primitive',{shape:'box',origin:V([-183,-65,-3]),size:V([366,108,3])});
 const baseId=base.objects[0].id;await call('native_rename',{id:baseId,name:'00-plaza/base'});
 for(const [key,name,color,roughness,metalness] of [
  ['stone','Warm limestone','#eadac0',.8,0],['brick','Tokyo red brick','#9d4638',.9,0],['roof','Slate roof','#313b48',.6,.12],['copper','Copper roof trim','#966552',.55,.28],['glass','Dark blue glazing','#203c4e',.22,.25],['plaza','Marunouchi paving','#b7b6ad',.95,0],['grass','Lawn','#75846a',1,0],['gold','Finial brass','#b89455',.3,.65]
 ]){await call('native_set_material',{ids:[baseId],name,color,roughness,metalness});palette[key]=(await call('native_materials')).find(m=>m.name===name).id}
 await call('native_set_material',{ids:[baseId],materialId:palette.plaza});
 // Main facade: 335 mm station length, an approximately 1:1000 display model.
 facade('10-central',0,30,26,23,5);
 for(const sign of [-1,1]){
  const side=sign<0?'south':'north';
  facade(`20-${side}-wing`,sign*65,88,21,22,13);
  facade(`30-${side}-terminal`,sign*152,31,24,21,5);
  // Slightly projecting middle pavilion breaks up the repetitive facade.
  facade(`25-${side}-pavilion`,sign*65,16,25,23,3);
  // Main octagonal dome pavilion, constructed by intersecting two boxes via MCP below.
  box(`40-${side}-dome`,'octagon-a',sign*123-18,-18,0,36,36,29,'brick');
  box(`40-${side}-dome`,'octagon-b',sign*123-18,-18,0,36,36,29,'brick');
  for(const z of [1,8,15,22,28.4])box(`40-${side}-dome`,'front-course',sign*123-18,-18.4,z,36,.6,.65,'stone');
  for(const dx of [-12,-6,0,6,12])for(const z of [2.3,9.3,16.3])windowAt(`40-${side}-dome`,sign*123+dx,-18,z,3.5,4.9);
  // High drum, hemispherical roof, lantern and finial.
  cylinder(`40-${side}-dome`,'drum',sign*123,0,26,15.8,5.2,'brick');
  cylinder(`40-${side}-dome`,'copper-cornice',sign*123,0,30.3,17.2,1.2,'copper');
  sphere(`40-${side}-dome`,'roof-shell',sign*123,0,31.4,17,'roof');
  cylinder(`40-${side}-dome`,'lantern',sign*123,0,41.2,1.4,2.4,'copper');
  sphere(`40-${side}-dome`,'lantern-cap',sign*123,0,43.6,1.7,'copper');
  cylinder(`40-${side}-dome`,'spire',sign*123,0,44.8,.22,3.8,'gold');
  // Clocks and the little roof oculus housings.
  cylinder(`40-${side}-dome`,'clock-rim',sign*123,-18.4,25,2.0,.5,'copper');
  cylinder(`40-${side}-dome`,'clock-face',sign*123,-18.95,25,1.65,.18,'stone');
  box(`40-${side}-dome`,'clock-hour',sign*123-.13,-19.2,25,.26,.15,1.0,'roof');
  box(`40-${side}-dome`,'clock-minute',sign*123,-19.22,24.88,1.1,.15,.24,'roof');
  // Small end towers recall the copper corner turrets.
  cylinder(`30-${side}-terminal`,'corner-turret',sign*164,-9,0,3.2,24,'brick');
  cylinder(`30-${side}-terminal`,'turret-band',sign*164,-9,20.5,3.35,.6,'stone');
  sphere(`30-${side}-terminal`,'turret-cap',sign*164,-9,24,3.4,'roof');
  cylinder(`30-${side}-terminal`,'turret-spire',sign*164,-9,27.2,.15,1.8,'gold');
 }
 // Central entrance and pediment.
 box('10-central','entrance-portal',-5.5,-14,0,11,1.3,8.5,'stone');
 box('10-central','entrance-shadow',-4.6,-14.35,.5,9.2,.45,7.4,'glass');
 cylinder('10-central','pediment-rim',0,-13.6,24.1,6.8,.8,'stone');
 cylinder('10-central','pediment-brick',0,-14.45,24.1,6.25,.3,'brick');
 cylinder('10-central','oculus',0,-14.8,26,1.6,.2,'glass');
 // The central plaza is intentionally simple; station architecture remains the focus.
 for(const x of [-138,-79,79,138])box('00-plaza','lawn',x-20,-53,.04,40,12,.2,'grass');
 for(let x=-170;x<=170;x+=10)box('00-plaza','paving-joint',x,-64,.015,.10,105,.025,'stone');
 box('00-plaza','approach',-12,-65,.05,24,49,.08,'stone');
 await flush();
 for(const sign of [-1,1]){
  const side=sign<0?'south':'north',prefix=`40-${side}-dome`;
  await rotate(`${prefix}/octagon-b`,[sign*123,0,0],[0,0,1],45);
  await call('native_boolean',{targetIds:[byName(`${prefix}/octagon-a`)],toolIds:[byName(`${prefix}/octagon-b`)],operation:'intersection'});
  const roof=byName(`${prefix}/roof-shell`);await call('native_scale',{ids:[roof],pivot:V([sign*123,0,31.4]),factors:[1,1,.6]});
  const old=new Set(scene.objects.map(o=>o.id));await call('native_create_primitive',{shape:'box',origin:V([sign*123-20,-20,10]),size:V([40,40,21.4])});
  const cutter=scene.objects.find(o=>!old.has(o.id)).id;await call('native_boolean',{targetIds:[roof],toolIds:[cutter],operation:'difference'});
  for(const label of ['clock-rim','clock-face'])await rotate(`${prefix}/${label}`,[sign*123,label==='clock-rim'?-18.4:-18.95,25],[1,0,0],90);
 }
 for(const [label,y,z] of [['pediment-rim',-13.6,24.1],['pediment-brick',-14.45,24.1],['oculus',-14.8,26]])await rotate(`10-central/${label}`,[0,y,z],[1,0,0],90);
 // Pitched slate roofs and dormers; created as solids and rotated using the dedicated tool.
 const roofs=[['10-central',0,30,13,29],['20-south-wing',-65,88,11,27.2],['20-north-wing',65,88,11,27.2],['30-south-terminal',-152,31,12,26.5],['30-north-terminal',152,31,12,26.5],['25-south-pavilion',-65,16,13,30],['25-north-pavilion',65,16,13,30]];
 for(const [g,x,w,d,z] of roofs){box(g,'pitched-front',x-w/2,-d,z,w,d,.8,'roof');box(g,'pitched-back',x-w/2,0,z,w,d,.8,'roof');box(g,'ridge',x-w/2,-.35,z+.4,w,.7,.65,'copper')}
 for(const sign of [-1,1])for(const x of [32,48,82,98]){
  box(`20-${sign<0?'south':'north'}-wing`,'dormer-body',sign*x-1.9,-7.5,24.1,3.8,3,3,'copper');
  windowAt(`20-${sign<0?'south':'north'}-wing`,sign*x,-7.5,24.5,2.4,2.1);
  box(`20-${sign<0?'south':'north'}-wing`,'dormer-cap',sign*x-2.1,-7.8,27.2,4.2,3.6,.7,'roof');
 }
 await flush();
 for(const [g,x,w,d,z] of roofs){await rotate(`${g}/pitched-front`,[x,0,z],[1,0,0],26);await rotate(`${g}/pitched-back`,[x,0,z],[1,0,0],-26)}
 for(const prefix of [...new Set(scene.objects.map(o=>o.name?.split('/')[0]).filter(Boolean))]){
  const ids=scene.objects.filter(o=>o.name?.startsWith(prefix+'/')).map(o=>o.id);if(ids.length)await call('native_group',{ids,name:prefix});
 }
 await call('native_view',{view:'front',mode:'orthographic',fit:true,materials:true});
 let shot=await call('native_screenshot');await writeFile(resolve(output,'front.png'),Buffer.from(shot.content[0].data,'base64'));
 await call('native_view',{view:'isometric',fit:true,materials:true});
 shot=await call('native_screenshot');await writeFile(resolve(output,'isometric.png'),Buffer.from(shot.content[0].data,'base64'));
 await call('native_scene');const ids=scene.objects.map(o=>o.id);
 await call('native_save_copy',{path:resolve(output,'tokyo-station.plasticity')});
 await call('native_export_step',{ids,path:resolve(output,'tokyo-station-initial.step')});
 await call('native_export_obj',{ids,path:resolve(output,'tokyo-station-initial.obj')});
 await writeFile(resolve(output,'manifest.json'),JSON.stringify({name:'Tokyo Station Marunouchi facade',scale:'approximately 1:1000',coordinateUnits:'meters',method:'Named MCP tools only; no geometry imports or renderer scripts',calls,objects:scene.objects.length,groups:scene.groups,materials:await call('native_materials'),scene,log,sources:['https://www.tokyostationcity.com/learning/station_building/','https://www.gov-online.go.jp/hlj/ja/february_2025/february_2025-03.html'],limitations:'Exterior study; dimensions other than nominal overall length are inferred. Not a measured survey or print-ready unified solid.'},null,2));
 console.log('TOKYO STATION COMPLETE',JSON.stringify({objects:scene.objects.length,calls,output}));
}finally{await client.close()}
