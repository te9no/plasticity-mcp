import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { writeFile, mkdir, mkdtemp, copyFile, stat, rm, rmdir, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, join, extname } from 'node:path';
import { PlasticityCdp } from './cdp.js';
import {solveSketch,sketchSchema,sketchProperties} from './sketch.js';
import {convertCad} from './exchange.js';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const vector = z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const ids = z.array(z.number().int().positive()).min(1).max(4096);
const jsonVector={type:'array',items:{type:'number'},minItems:3,maxItems:3};
const jsonIds={type:'array',items:{type:'integer',minimum:1},minItems:1,maxItems:4096};
const tool=(name:string,description:string,properties:Record<string,any>,required:string[]=[],readOnly=false):Tool=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:false}});
export const nativeTools:Tool[]=[
 tool('native_windows','List running Plasticity windows via its already-enabled local Electron debugger. Does not restart the app.',{},[],true),
 tool('native_connect','Select an explicit Plasticity window by targetId. Required before other native tools; never chooses a document automatically.',{targetId:{type:'string'}},['targetId']),
 tool('native_scene','Read stable object IDs, names, types, approximate mesh bounds, display units and undo state. Coordinates are Plasticity meters (independent of display units).',{},[],true),
 tool('native_recover','After an unknown operation outcome: inspect native_scene, then acknowledge its operationId and fingerprint. Only resumes editing if the operation has settled and the scene is unchanged and idle. Never retries the operation.',{operationId:{type:'string'},fingerprint:{type:'string'}},['operationId','fingerprint']),
 tool('native_save_copy','Save the current document to a new .plasticity file. Refuses overwrite. Does not change the active document filename. Uses native serialization.',{path:{type:'string'}},['path']),
 tool('native_rename','Rename one geometry object by stable ID with normal Undo.',{id:{type:'integer',minimum:1},name:{type:'string',minLength:1,maxLength:120}},['id','name']),
 tool('native_materials','List document materials and their colors.',{},[],true),
 tool('native_set_material','Assign an existing material ID, or create a named material with #RRGGBB color and assign it to stable IDs. Undo supported.',{ids:jsonIds,materialId:{type:'integer',minimum:0},name:{type:'string'},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},roughness:{type:'number',minimum:0,maximum:1},metalness:{type:'number',minimum:0,maximum:1}},['ids']),
 tool('native_group','Group specified geometry and name the new group. Normal Undo step.',{ids:jsonIds,name:{type:'string'}},['ids','name']),
 tool('native_visibility','Hide or show geometry by stable IDs. Normal Undo step.',{ids:jsonIds,hidden:{type:'boolean'}},['ids','hidden']),
 tool('native_delete','Delete only the specified stable IDs. Normal Undo step.',{ids:jsonIds},['ids']),
 tool('native_view','Set a named camera view and/or fit geometry. materials=true displays assigned colors with a bundled matcap. edges=false hides outlines. Does not add a geometry Undo step. Viewport index defaults to zero.',{view:{type:'string',enum:['front','back','left','right','top','bottom','isometric']},fit:{type:'boolean'},materials:{type:'boolean'},edges:{type:'boolean'},mode:{type:'string',enum:['orthographic','perspective']},viewport:{type:'integer',minimum:0}},[]),
 tool('native_open_document','Replace the connected document with a .plasticity file after saving a mandatory backup copy. Requires the latest native_scene fingerprint. Explicitly reconnect after opening.',{path:{type:'string'},backupPath:{type:'string'},fingerprint:{type:'string'}},['path','backupPath','fingerprint']),
 tool('native_create_primitive','Create a real CAD solid with normal Undo history. Dimensions/coordinates use meters. Sphere, Z-axis cylinder or axis-aligned box (origin is minimum corner).',{shape:{type:'string',enum:['sphere','box','cylinder']},origin:jsonVector,radius:{type:'number',exclusiveMinimum:0},size:jsonVector,height:{type:'number',exclusiveMinimum:0}},['shape','origin']),
 tool('native_create_primitives','Create up to 100 named CAD primitives in one normal Undo step. Meters. Optional materialId per part. All input parameters are validated before editing.',{parts:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{shape:{type:'string',enum:['box','sphere','cylinder']},origin:jsonVector,size:jsonVector,radius:{type:'number',exclusiveMinimum:0},height:{type:'number',exclusiveMinimum:0},name:{type:'string'},materialId:{type:'integer',minimum:0}},required:['shape','origin']}}},['parts']),
 tool('native_move','Translate objects addressed by stable IDs. Delta uses meters. Registers a normal Undo step.',{ids:jsonIds,delta:jsonVector},['ids','delta']),
 tool('native_sketch_curve','Create a polyline or interpolating spline from 3D points (meters). Closed curves may form sketch regions. Normal Undo step.',{points:{type:'array',items:jsonVector,minItems:2,maxItems:1000},kind:{type:'string',enum:['polyline','spline']},closed:{type:'boolean'}},['points','kind']),
 tool('native_sketch_circle','Create a circular sketch curve at center, oriented by a world normal. Meters; normal must be nonzero. Normal Undo step.',{center:jsonVector,normal:jsonVector,radius:{type:'number',exclusiveMinimum:0}},['center','normal','radius']),
 tool('native_export_iges','Export solids/sheets through STEP and local Open CASCADE to IGES. Requires project Python CAD environment. Refuses overwrite. Geometry only; assembly metadata may be lost.',{ids:jsonIds,path:{type:'string'}},['ids','path']),
 tool('native_import_iges','Convert local IGES to STEP with Open CASCADE, then add CAD geometry with normal Undo. Requires project Python CAD environment. May produce separate surfaces.',{path:{type:'string'}},['path']),
 tool('native_sketch_solve','Solve 2D point constraints in meters without changing the app. Indices are zero-based. Satisfied does not mean fully constrained. Returns a reusable recipe; no live Plasticity constraints.',sketchProperties,['points','constraints'],true),
 tool('native_sketch_constrained','Solve 2D constraints and create a polyline in XY/XZ/YZ plane with normal Undo. Constraints are a recipe, not live links: rerun with changed dimensions to regenerate. Optional replaceId replaces one existing Wire.',{...sketchProperties,plane:{type:'string',enum:['XY','XZ','YZ'],default:'XY'},origin:jsonVector,closed:{type:'boolean'},replaceId:{type:'integer',minimum:1}},['points','constraints']),
 tool('native_rotate','Rotate geometry about an explicit world-space pivot (meters) and axis. Angle is in degrees. Normal Undo step.',{ids:jsonIds,pivot:jsonVector,axis:jsonVector,angleDegrees:{type:'number'}},['ids','pivot','axis','angleDegrees']),
 tool('native_scale','Scale geometry along world X/Y/Z about an explicit pivot (meters). Factors must be positive; [2,2,2] doubles size. Normal Undo step.',{ids:jsonIds,pivot:jsonVector,factors:jsonVector},['ids','pivot','factors']),
 tool('native_export_step','Export specified solids/sheets as exact CAD STEP, retaining analytic geometry. Creates a new local file and refuses overwrite. Does not change the scene.',{ids:jsonIds,path:{type:'string'}},['ids','path']),
 tool('native_import_step','Import a local .step/.stp file into the selected document as CAD geometry. Does not clear existing objects. Normal Undo step.',{path:{type:'string'}},['path']),
 tool('native_topology','List current version-specific face and edge IDs for one solid. Refresh after every geometry edit; stale IDs are rejected.',{id:{type:'integer',minimum:1}},['id'],true),
 tool('native_fillet','Round specified edges of one solid with a constant radius in meters. Use current edgeIds from native_topology. Normal Undo step.',{id:{type:'integer',minimum:1},edgeIds:{type:'array',items:{type:'string'},minItems:1},radius:{type:'number',exclusiveMinimum:0}},['id','edgeIds','radius']),
 tool('native_extrude_faces','Extrude current face IDs into new CAD geometry by distance in meters, along the profile normal. Use native_boolean separately to combine it with an existing body.',{id:{type:'integer',minimum:1},faceIds:{type:'array',items:{type:'string'},minItems:1},distance:{type:'number',exclusiveMinimum:0}},['id','faceIds','distance']),
 tool('native_boolean','Boolean union, difference or intersection of CAD solids. Replaces targets; keepTools controls retaining tool bodies. Normal Undo step.',{targetIds:jsonIds,toolIds:jsonIds,operation:{type:'string',enum:['union','difference','intersection']},keepTools:{type:'boolean',default:false}},['targetIds','toolIds','operation']),
 tool('native_select','Replace current selection with objects addressed by stable IDs.',{ids:jsonIds},['ids']),
 tool('native_undo','Undo the last document edit, including user edits. Only invoke when that edit is intended to be undone.',{}),
 tool('native_redo','Redo the last undone document edit.',{}),
 tool('native_export_obj','Export selected stable IDs as a triangulated OBJ file using current viewport mesh quality. Meters. Creates a new file; refuses overwrite. Not STEP/B-Rep export.',{ids:jsonIds,path:{type:'string'}},['ids','path']),
 tool('native_screenshot','Capture the connected Plasticity viewport/window through the debugger.',{},[],true),
 tool('native_capabilities','List runtime factory/command bindings. Presence does not imply tested support; internal APIs vary with app versions.',{},[],true),
 tool('native_execute_script','Advanced: execute asynchronous JavaScript inside the selected Plasticity renderer, with editor and requested runtime bindings. Full native app access; no sandbox or automatic undo. Use named tools first. Do not retry on timeout without inspecting the scene.',{code:{type:'string'},bindings:{type:'array',items:{type:'string'},default:[]}},['code']),
];

const sceneBody=`return {
 filename:this.document.filename??null,displayUnits:this.settings.Unit,coordinateUnits:'meters',
 documentUuid:this.document.uuid??null,documentVersion:this.originator.version,
 groups:Array.from(this.db.groups.all).map(id=>({id,name:this.db.nodes.getName(this.db.nodes.item2key(this.db.groups.lookupById(id)))??null})),
 busy:this.executor.isBusy,undoDepth:this.history.undoStack.length,redoDepth:this.history.redoStack.length,
 objects:this.db.items.filter(({view})=>this.db.lookupStableId(view.versionId)!=null).map(({view})=>({id:this.db.lookupStableId(view.versionId),versionId:view.versionId,
 name:this.db.getName(view)??null,type:view.constructor.name,
 hidden:this.db.nodes.isHidden(view),materialId:this.db.getMaterialId(view)??0,parentId:this.db.groups.getParentId(this.db.nodes.item2key(view))??null,
 bbox:view.boundingBox?{min:view.boundingBox.min.toArray(),max:view.boundingBox.max.toArray()}:null}))
}`;

// Run through the native command lifecycle so cancellation, transactions and Undo are handled by Plasticity.
const commandBody=(command:string,body:string,boundCommand=false,extra='')=>`async function(F,${boundCommand?'C,':''}${extra?extra+',':''}args){
 if(this.executor.isBusy)throw new Error('Plasticity is busy. Finish or cancel its current operation first.');
 let result, failure, ran=false;
 const cmd=new ${boundCommand?'C':`this.commands[${JSON.stringify(command)}]`}(this);cmd.remember=false;
 cmd.execute=async function(){ran=true;try{const editor=this.editor;const f=new F(editor).resource(this);${body};result=await f.commit();}catch(e){failure=e;throw e;}};
 await this.exec(cmd);
 if(failure)throw failure;
 if(!ran)throw new Error('Native command did not execute');
 ${sceneBody}
}`;
const lookup=`const find=id=>{const row=editor.db.items.find(({view})=>editor.db.lookupStableId(view.versionId)===id);if(!row)throw new Error('Object ID not found: '+id);return row.view;};`;
const fitBody=`const rows=this.db.items.filter(({view})=>view.boundingBox&&!this.db.nodes.isHidden(view));if(rows.length){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const {view} of rows){const b=view.boundingBox;for(let i=0;i<3;i++){min[i]=Math.min(min[i],b.min.getComponent(i));max[i]=Math.max(max[i],b.max.getComponent(i))}}const center=v.camera.target.clone().fromArray(min.map((x,i)=>(x+max[i])/2));const radius=Math.max(1e-6,Math.hypot(...max.map((x,i)=>x-min[i]))/2),o=v.orbitControls,c=v.camera;const distance=radius/Math.sin(Math.min(c.perspective.fov*Math.PI/360,Math.atan(Math.tan(c.perspective.fov*Math.PI/360)*c.aspect)))*1.4;o.target.copy(center);o.targetEnd.copy(center);o.focalOffset.set(0,0,0);o.focalOffsetEnd.set(0,0,0);o.radius=o.radiusEnd=distance;const zoom=Math.min(c.orthographic.right-c.orthographic.left,c.orthographic.top-c.orthographic.bottom)/(radius*2*1.4);o.zoom=o.zoomEnd=zoom;c.zoom=zoom;o.setNeedsUpdate();o.update(1/60);c.updateProjectionMatrix()}`;
const editBody=(body:string)=>`async function(args){if(this.executor.isBusy)throw new Error('Plasticity busy');const editor=this;${lookup}const views=args.ids.map(find);let failure,ran=false;const cmd=new this.commands.GroupSelectedCommand(this);cmd.remember=false;cmd.execute=async function(){ran=true;try{${body}}catch(e){failure=e;throw e}};await this.exec(cmd);if(failure)throw failure;if(!ran)throw new Error('Command did not execute');${sceneBody}}`;

export class NativeOperations {
 readonly cdp:PlasticityCdp;
 private queue:Promise<unknown>=Promise.resolve();
 private runtimeVersion?:string;
 constructor(endpoint=process.env.PLASTICITY_CDP_URL??'http://127.0.0.1:9223'){this.cdp=new PlasticityCdp(endpoint)}
 handle(name:string,raw:unknown={}){
   // Serialize selection, edits and inspections so callers cannot race the native command executor.
   const job=this.queue.then(()=>this.dispatch(name,raw));this.queue=job.catch(()=>{});return job;
 }
 async scene(){
  const guard=await this.cdp.refreshRecovery();
  const scene=await this.cdp.run(`function(){${sceneBody}}`,[],[],{readOnly:true});
  const targetId=this.cdp.target?.id;
  const fingerprint=createHash('sha256').update(JSON.stringify({targetId,...guard,...scene})).digest('hex');
  return {targetId,...guard,...scene,fingerprint,recovery:this.cdp.recoveryState()};
 }
 private async dispatch(name:string,raw:unknown):Promise<any>{
  switch(name){
   case 'native_windows':return (await this.cdp.targets()).map(t=>({targetId:t.id,title:t.title}));
   case 'native_connect':{
    const a=z.object({targetId:z.string().min(1)}).strict().parse(raw);await this.cdp.connect(a.targetId);
    try{
     const path=fileURLToPath(new URL('../../../package.json',this.cdp.target!.url));
     const pkg=JSON.parse(await readFile(path,'utf8'));this.runtimeVersion=pkg.version;
     if(pkg.name!=='Plasticity'||pkg.version!=='25.3.0')throw new Error('Supported runtime is Plasticity 25.3.0; found '+pkg.version);
    }catch(e){await this.cdp.disconnect();throw e}
    return {targetId:a.targetId,runtimeVersion:this.runtimeVersion,...await this.scene()};
   }
   case 'native_scene':return this.scene();
   case 'native_recover':{
    const a=z.object({operationId:z.string().min(1),fingerprint:z.string().length(64)}).strict().parse(raw);
    const scene=await this.scene();
    if(scene.busy)throw new Error('Plasticity is busy; wait for the operation to finish');
    if(scene.fingerprint!==a.fingerprint)throw new Error('Scene changed since inspection. Read native_scene again before recovery.');
    await this.cdp.acknowledgeRecovery(a.operationId);
    return this.scene();
   }
   case 'native_save_copy':{
    const a=z.object({path:z.string().min(1)}).strict().parse(raw);
    const output=resolve(a.path);
    if(extname(output).toLowerCase()!=='.plasticity')throw new Error('Output path must end in .plasticity');
    await mkdir(dirname(output),{recursive:true});
    const staging=await mkdtemp(join(dirname(output),'.plasticity-save-'));
    const staged=join(staging,'document.plasticity');
    try{
     await this.cdp.run(`async function(path){if(this.executor.isBusy)throw new Error('Plasticity busy');await this.saver.save(path);}`,[],[staged]);
     const info=await stat(staged);if(info.size<24||(await readFile(staged)).subarray(0,10).toString()!=='plasticity')throw new Error('Native save produced an invalid file');
     await copyFile(staged,output,constants.COPYFILE_EXCL);
     return {path:output,bytes:info.size,format:'plasticity',activeFilenameChanged:false};
    }finally{
     // A timed-out renderer may still be writing. Preserve its private staging directory.
     if(!this.cdp.hasUncertainOperations()){await rm(staged,{force:true}).catch(()=>{});await rmdir(staging).catch(()=>{});}
    }
   }
   case 'native_rename':{
    const a=z.object({id:z.number().int().positive(),name:z.string().trim().min(1).max(120)}).strict().parse(raw);
    return this.cdp.run(`async function(args){if(this.executor.isBusy)throw new Error('Plasticity busy');const editor=this;${lookup}const view=find(args.id);let failure,ran=false;const cmd=new this.commands.GroupSelectedCommand(this);cmd.remember=false;cmd.execute=async function(){ran=true;try{editor.db.nodes.setName(editor.db.nodes.item2key(view),args.name)}catch(e){failure=e;throw e}};await this.exec(cmd);if(failure)throw failure;if(!ran)throw new Error('Rename did not execute');if(editor.db.getName(view)!==args.name)throw new Error('Rename verification failed');${sceneBody}}`,[],[a]);
   }
   case 'native_materials':return this.cdp.run(`function(){return Array.from(this.db.materials.materials).map(([id,{name,material:m}])=>({id,name,color:'#'+m.color.getHexString(),roughness:m.roughness,metalness:m.metalness}))}`,[],[],{readOnly:true});
   case 'native_set_material':{
    const a=z.object({ids,materialId:z.number().int().nonnegative().optional(),name:z.string().trim().min(1).max(120).optional(),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),roughness:z.number().min(0).max(1).default(.6),metalness:z.number().min(0).max(1).default(0)}).strict().parse(raw);
    if(a.materialId===undefined&&(!a.name||!a.color))throw new Error('Provide materialId, or both name and color');
    if(a.materialId!==undefined&&(a.name||a.color))throw new Error('Use materialId or a new material, not both');
    return this.cdp.run(editBody(`let id=args.materialId;if(id===undefined){const m=editor.db.materials.default.clone();m.color.set(args.color);m.roughness=args.roughness;m.metalness=args.metalness;id=editor.db.materials.add(args.name,m)}else if(id!==0&&!editor.db.materials.has(id))throw new Error('Material ID not found');for(const v of views)editor.db.nodes.setMaterial(editor.db.nodes.item2key(v),id);`),[],[a]);
   }
   case 'native_visibility':{
    const a=z.object({ids,hidden:z.boolean()}).strict().parse(raw);
    return this.cdp.run(editBody(`for(const v of views)editor.db.nodes.setHidden(v,args.hidden);`),[],[a]);
   }
   case 'native_group':case 'native_delete':{
    const a=(name==='native_group'?z.object({ids,name:z.string().trim().min(1).max(120)}):z.object({ids})).strict().parse(raw);
    return this.cdp.run(`async function(args){if(this.executor.isBusy)throw new Error('Plasticity busy');const editor=this;${lookup}const views=args.ids.map(find);editor.selection.selected.removeAll();for(const v of views)editor.selection.selected.add(v);const before=new Set(editor.db.groups.all);const cmd=new editor.commands.${name==='native_group'?'GroupSelectedCommand':'DeleteCommand'}(editor);cmd.remember=false;const original=cmd.execute.bind(cmd);let failure,ran=false;cmd.execute=async function(){ran=true;try{await original();${name==='native_group'?`const id=Array.from(editor.db.groups.all).find(id=>!before.has(id));if(id===undefined)throw new Error('Group was not created');const g=editor.db.groups.lookupById(id);editor.db.nodes.setName(editor.db.nodes.item2key(g),args.name);`:''}}catch(e){failure=e;throw e}};await editor.exec(cmd);if(failure)throw failure;if(!ran)throw new Error('Command did not execute');${sceneBody}}`,[],[a]);
   }
   case 'native_view':{
    const a=z.object({view:z.enum(['front','back','left','right','top','bottom','isometric']).optional(),fit:z.boolean().default(false),materials:z.boolean().optional(),edges:z.boolean().optional(),mode:z.enum(['orthographic','perspective']).optional(),viewport:z.number().int().nonnegative().default(0)}).strict().parse(raw);
    await this.cdp.call('Page.bringToFront',{},5000);
    return this.cdp.run(`async function(args){if(this.executor.isBusy)throw new Error('Plasticity busy');const v=Array.from(this.viewports)[args.viewport];if(!v)throw new Error('Viewport not found');if(args.edges!==undefined)this.layers.isShowingEdges=args.edges;if(args.materials!==undefined){const texture=args.materials?await this.textures.get(".././img/ceramic_lightbulb.exr"):this.shading.defaultMatcap;this.shading.setMatcap(texture,args.materials)}this.signals.sceneGraphChanged.dispatch();this.signals.fileNameChanged.dispatch(this.document.filename);if(args.mode)v.camera.setMode(args.mode);if(args.view==='isometric'){const c=v.camera.clone();c.position.copy(v.camera.target).add(c.position.clone().set(1,-1,1));c.lookAt(v.camera.target);v.orbitControls.setQuaternion(c.quaternion)}else if(args.view)await v.navigateToOrientation(({front:4,back:1,left:3,right:0,top:2,bottom:5})[args.view]);if(args.fit){${fitBody}}v.setNeedsRender();let previous='',stable=0;for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,50));const current=[...v.camera.position.toArray(),...v.camera.quaternion.toArray(),v.camera.zoom].map(x=>x.toFixed(6)).join(',');stable=current===previous?stable+1:0;previous=current;if(stable>=3)break}return {position:v.camera.position.toArray(),target:v.camera.target.toArray(),mode:v.camera.mode}}`,[],[a]);
   }
   case 'native_open_document':{
    const a=z.object({path:z.string().min(1),backupPath:z.string().min(1),fingerprint:z.string().length(64)}).strict().parse(raw);
    const input=await realpath(resolve(a.path));if(extname(input).toLowerCase()!=='.plasticity')throw new Error('Input must end in .plasticity');
    const file=await readFile(input);if(file.length<24||file.subarray(0,10).toString()!=='plasticity')throw new Error('Invalid Plasticity file header');
    if((await this.scene()).fingerprint!==a.fingerprint)throw new Error('Scene changed; inspect native_scene before replacing the document');
    await this.dispatch('native_save_copy',{path:a.backupPath});
    const scene=await this.cdp.run(commandBody('OpenFileCommand','f.filename=args.path;',true).replace(sceneBody,`this.document.filename=args.path;${sceneBody}`),['OpenFileFactory','OpenFileCommand'],[{path:input}]);
    return {backupPath:resolve(a.backupPath),...scene,reconnectRequired:true};
   }
   case 'native_sketch_solve':return solveSketch(raw);
   case 'native_sketch_constrained':{
    const a=sketchSchema.extend({plane:z.enum(['XY','XZ','YZ']).default('XY'),origin:vector.default([0,0,0]),closed:z.boolean().default(false),replaceId:z.number().int().positive().optional()}).parse(raw);
    const solution=solveSketch({points:a.points,constraints:a.constraints});
    const points=solution.points.map(([u,v])=>{const p=a.plane==='XY'?[u,v,0]:a.plane==='XZ'?[u,0,v]:[0,u,v];return p.map((x,i)=>x+a.origin[i]!)});
    if(a.closed&&points.length<3)throw new Error('Closed sketch requires at least three points');
    const pairs=points.slice(1).map((p,i)=>[p,points[i]!]);if(a.closed)pairs.push([points[0]!,points.at(-1)!]);
    if(pairs.some(([p,q])=>Math.hypot(...p!.map((x,i)=>x-q![i]!))<1e-9))throw new Error('Solved sketch has a zero-length segment');
    const scene=await this.cdp.run(commandBody('CurveCommand',`${lookup}if(args.replaceId){const old=find(args.replaceId);if(old.constructor.name!=='Wire')throw new Error('replaceId must identify a Wire');Object.defineProperty(f,'originalItems',{get:()=>[old]});}f.points=args.points.map(p=>new V(...p));f.type=T.Polyline;f.closed=args.closed;`,false,'V,T'),['CurveFactory','three_core_Vector3','CurveType'],[{points,closed:a.closed,replaceId:a.replaceId}]);
    return {scene,solution,recipe:{points:solution.points,constraints:a.constraints,plane:a.plane,origin:a.origin,closed:a.closed}};
   }
   case 'native_capabilities':return {target:this.cdp.target?.id??null,supportedVersion:'25.3.0',runtimeVersion:this.runtimeVersion??null,tools:nativeTools.map(t=>t.name),bindings:this.cdp.names(),note:'Unofficial internal API adapter pinned to Plasticity 25.3.0. Binding presence does not imply a supported tool.'};
   case 'native_create_primitive':{
    const a=z.object({shape:z.enum(['sphere','box','cylinder']),origin:vector,radius:z.number().finite().positive().optional(),size:vector.refine(v=>v.every(n=>n>0),'Every size must be positive').optional(),height:z.number().finite().positive().optional()}).strict().parse(raw);
    if(a.shape!=='box'&&!a.radius)throw new Error('radius required');
    if(a.shape==='box'&&!a.size)throw new Error('size required');
    if(a.shape==='cylinder'&&!a.height)throw new Error('height required');
    const config={sphere:['SphereCommand','PossiblyBooleanSphereFactory','f.center.fromArray(args.origin);f.radius=args.radius;'],cylinder:['CylinderCommand','PossiblyBooleanCylinderFactory','f.center.fromArray(args.origin);f.radius=args.radius;f.height=args.height;'],box:['ThreePointBoxCommand','ThreePointBoxFactory','const [x,y,z]=args.origin;const [w,d,h]=args.size;f.p1.set(x,y,z);f.p2.set(x+w,y,z);f.p3.set(x+w,y+d,z);f.p4.set(x+w,y+d,z+h);']}[a.shape]!;
    return this.cdp.run(commandBody(config[0]!,config[2]!),[config[1]!],[a]);
   }
   case 'native_create_primitives':{
    const part=z.object({shape:z.enum(['box','sphere','cylinder']),origin:vector,size:vector.refine(v=>v.every(x=>x>0)).optional(),radius:z.number().finite().positive().optional(),height:z.number().finite().positive().optional(),name:z.string().trim().min(1).max(120).optional(),materialId:z.number().int().nonnegative().optional()}).strict().superRefine((a,c)=>{if(a.shape==='box'&&!a.size)c.addIssue({code:'custom',message:'Box size required'});if(a.shape!=='box'&&!a.radius)c.addIssue({code:'custom',message:'Radius required'});if(a.shape==='cylinder'&&!a.height)c.addIssue({code:'custom',message:'Cylinder height required'})});
    const a=z.object({parts:z.array(part).min(1).max(100)}).strict().parse(raw);
    return this.cdp.run(`async function(B,S,C,args){if(this.executor.isBusy)throw new Error('Plasticity busy');const editor=this;for(const p of args.parts)if(p.materialId&& !editor.db.materials.has(p.materialId))throw new Error('Material ID not found: '+p.materialId);const before=new Set(editor.db.items.map(({view})=>editor.db.lookupStableId(view.versionId)));let failure,ran=false;const cmd=new editor.commands.GroupSelectedCommand(editor);cmd.remember=false;cmd.execute=async function(){ran=true;try{for(const p of args.parts){const f=new ({box:B,sphere:S,cylinder:C})[p.shape](editor).resource(this);if(p.shape==='box'){const [x,y,z]=p.origin,[w,d,h]=p.size;f.p1.set(x,y,z);f.p2.set(x+w,y,z);f.p3.set(x+w,y+d,z);f.p4.set(x+w,y+d,z+h)}else{f.center.fromArray(p.origin);f.radius=p.radius;if(p.shape==='cylinder')f.height=p.height}const previous=new Set(editor.db.items.map(({view})=>editor.db.lookupStableId(view.versionId)));await f.commit();for(const {view} of editor.db.items){const id=editor.db.lookupStableId(view.versionId);if(id==null||previous.has(id))continue;const key=editor.db.nodes.item2key(view);if(p.name)editor.db.nodes.setName(key,p.name);if(p.materialId!==undefined)editor.db.nodes.setMaterial(key,p.materialId)}}}catch(e){failure=e;throw e}};await editor.exec(cmd);if(failure)throw failure;if(!ran)throw new Error('Command did not execute');const createdIds=editor.db.items.map(({view})=>editor.db.lookupStableId(view.versionId)).filter(id=>id!=null&&!before.has(id));return {createdIds,scene:(function(){${sceneBody}}).call(editor)}}`,['ThreePointBoxFactory','PossiblyBooleanSphereFactory','PossiblyBooleanCylinderFactory'],[a]);
   }
   case 'native_move':{
    const a=z.object({ids,delta:vector}).strict().parse(raw);
    return this.cdp.run(commandBody('MoveItemCommand',`${lookup}f.items=args.ids.map(find);f.move.fromArray(args.delta);`),['MoveItemAndEmptyFactory'],[a]);
   }
   case 'native_sketch_curve':{
    const a=z.object({points:z.array(vector).min(2).max(1000),kind:z.enum(['polyline','spline']),closed:z.boolean().default(false)}).strict().parse(raw);
    if(a.closed&&a.points.length<3)throw new Error('Closed curve requires at least three points');
    if(a.points.some((p,i)=>i>0&&Math.hypot(...p.map((v,k)=>v-a.points[i-1]![k]!))<1e-9))throw new Error('Consecutive points must differ');
    return this.cdp.run(commandBody('CurveCommand','f.points=args.points.map(p=>new V(...p));f.type=args.kind===\'polyline\'?T.Polyline:T.NURBS;f.closed=args.closed;',false,'V,T'),['CurveFactory','three_core_Vector3','CurveType'],[a]);
   }
   case 'native_sketch_circle':{
    const a=z.object({center:vector,normal:vector.refine(v=>Math.hypot(...v)>1e-12,'Normal cannot be zero'),radius:z.number().finite().positive()}).strict().parse(raw);
    return this.cdp.run(commandBody('CenterCircleCommand','f.center.fromArray(args.center);f.orientation.setFromUnitVectors(f.center.clone().set(0,0,1),f.center.clone().fromArray(args.normal).normalize());f.point.copy(f.center).add(f.center.clone().set(args.radius,0,0).applyQuaternion(f.orientation));f.radius=args.radius;'),['CenterCircleFactory'],[a]);
   }
   case 'native_rotate':{
    const a=z.object({ids,pivot:vector,axis:vector.refine(v=>Math.hypot(...v)>1e-12,'Rotation axis cannot be zero'),angleDegrees:z.number().finite()}).strict().parse(raw);
    return this.cdp.run(commandBody('RotateItemCommand',`${lookup}f.items=args.ids.map(find);f.pivot.fromArray(args.pivot);const axis=f.pivot.clone().fromArray(args.axis).normalize();f.rotation.setFromAxisAngle(axis,args.angleDegrees*Math.PI/180);`),['RotateItemAndEmptyFactory'],[a]);
   }
   case 'native_scale':{
    const a=z.object({ids,pivot:vector,factors:vector.refine(v=>v.every(n=>n>0),'Scale factors must be positive')}).strict().parse(raw);
    return this.cdp.run(commandBody('ScaleItemCommand',`${lookup}f.items=args.ids.map(find);f.pivot.fromArray(args.pivot);f.scale.fromArray(args.factors);`),['ProjectingScaleItemAndEmptyFactory'],[a]);
   }
   case 'native_export_iges':case 'native_export_step':{
    const a=z.object({ids,path:z.string().min(1)}).strict().parse(raw);
    const output=resolve(a.path);
    const iges=name==='native_export_iges';const extensions=iges?['.iges','.igs']:['.step','.stp'];
    if(!extensions.includes(extname(output).toLowerCase()))throw new Error('Output must be '+extensions.join(' or '));
    await mkdir(dirname(output),{recursive:true});
    // The native exporter may overwrite. Export to a private staging file, then publish exclusively.
    const staging=await mkdtemp(join(dirname(output),'.plasticity-step-'));
    const temporary=join(staging,iges?'geometry.iges':'geometry.step');
    try{
     const nativePath=iges?join(staging,'source.step'):temporary;
     await this.cdp.run(`async function(F,args){if(this.executor.isBusy)throw new Error('Plasticity busy');const editor=this;${lookup}const items=args.ids.map(find);if(items.some(v=>!['Solid','Sheet'].includes(v.constructor.name)))throw new Error('CAD export requires solids or sheets');const f=new F(editor);f.items=items;f.filePath=args.path;await f.commit();}`,['ExportCadFactory'],[{ids:a.ids,path:nativePath}]);
     if(iges)await convertCad(nativePath,temporary);
     const header=await readFile(temporary,'utf8');
     const valid=iges?header.split(/\r?\n/).some(line=>line[72]==='T'):header.startsWith('ISO-10303-21;')&&header.includes('END-ISO-10303-21;');
     if(!valid)throw new Error('Native exporter did not produce a complete CAD file');
     await copyFile(temporary,output,constants.COPYFILE_EXCL);
     return {path:output,bytes:(await stat(output)).size,objects:a.ids.length,format:iges?'IGES':'STEP',geometry:'B-Rep',backend:iges?'Plasticity STEP + Open CASCADE':'Plasticity'};
    }finally{
     // Only this operation's two known staging paths are removed, never the requested output.
     if(!this.cdp.hasUncertainOperations()){await rm(temporary,{force:true}).catch(()=>{});if(iges)await rm(join(staging,'source.step'),{force:true}).catch(()=>{});await rmdir(staging).catch(()=>{});}
    }
   }
   case 'native_import_iges':case 'native_import_step':{
    const a=z.object({path:z.string().min(1)}).strict().parse(raw);
    const input=await realpath(resolve(a.path));
    const extensions=name==='native_import_iges'?['.iges','.igs']:['.step','.stp'];
    if(!extensions.includes(extname(input).toLowerCase()))throw new Error('Input must be '+extensions.join(' or '));
    if(!(await stat(input)).isFile())throw new Error('Input must be a regular file');
    if(name==='native_import_iges'){
     const staging=await mkdtemp(join(tmpdir(),'plasticity-iges-')),step=join(staging,'converted.step');
     try{await convertCad(input,step);const scene=await this.dispatch('native_import_step',{path:step});return {...scene,exchange:{source:input,backend:'Open CASCADE + Plasticity STEP'}};}
     finally{if(!this.cdp.hasUncertainOperations()){await rm(step,{force:true}).catch(()=>{});await rmdir(staging).catch(()=>{});}}
    }
    return this.cdp.run(commandBody('ImportCommand','f.filePath=args.path;',true),['ExchangeImportFactory','ImportCommand'],[{path:input}]);
   }
   case 'native_topology':{
    const a=z.object({id:z.number().int().positive()}).strict().parse(raw);
    return this.cdp.run(`function(args){const editor=this;${lookup}const v=find(args.id);if(!v.high)throw new Error('Object has no surface topology');return {id:args.id,versionId:v.versionId,edgeIds:v.high.edges.versionIds,faceIds:v.high.faces.versionIds}}`,[],[a],{readOnly:true});
   }
   case 'native_fillet':{
    const a=z.object({id:z.number().int().positive(),edgeIds:z.array(z.string()).min(1),radius:z.number().finite().positive()}).strict().parse(raw);
    return this.cdp.run(commandBody('FilletShellCommand',`${lookup}const v=find(args.id),es=v.high.edges;f.shell=v;f.edges=args.edgeIds.map(id=>{const i=es.versionIds.indexOf(id);if(i<0)throw new Error('Stale or unknown edge: '+id);return es.get(i)});f.distance=args.radius;`),['FilletShellFactory'],[a]);
   }
   case 'native_extrude_faces':{
    const a=z.object({id:z.number().int().positive(),faceIds:z.array(z.string()).min(1),distance:z.number().finite().positive()}).strict().parse(raw);
    return this.cdp.run(commandBody('ExtrudeCommand',`${lookup}const v=find(args.id),fs=v.high.faces;f.faces=args.faceIds.map(id=>{const i=fs.versionIds.indexOf(id);if(i<0)throw new Error('Stale or unknown face: '+id);return fs.get(i)});f.distance1=args.distance;`),['FaceExtrudeFactory'],[a]);
   }
   case 'native_boolean':{
    const a=z.object({targetIds:ids,toolIds:ids,operation:z.enum(['union','difference','intersection']),keepTools:z.boolean().default(false)}).strict().parse(raw);
    if(a.targetIds.some(id=>a.toolIds.includes(id)))throw new Error('Target and tool IDs must not overlap');
    return this.cdp.run(commandBody('BooleanCommand',`${lookup}f.targets=args.targetIds.map(find);f.tools=args.toolIds.map(find);f.operationType=({union:15903,difference:15902,intersection:15901})[args.operation];f.keepTools=args.keepTools;`),['BooleanFactory'],[a]);
   }
   case 'native_select':{
    const a=z.object({ids}).strict().parse(raw);
    return this.cdp.run(`function(args){if(this.executor.isBusy)throw new Error('Plasticity busy');const editor=this;${lookup}const views=args.ids.map(find);this.selection.selected.removeAll();for(const v of views)this.selection.selected.add(v);return {selectedIds:args.ids}}`,[],[a]);
   }
   case 'native_undo':case 'native_redo':return this.cdp.run(`async function(){if(this.executor.isBusy)throw new Error('Plasticity busy');await this.${name==='native_undo'?'undo':'redo'}();${sceneBody}}`);
   case 'native_export_obj':{
    const a=z.object({ids,path:z.string().min(1)}).strict().parse(raw);
    const output=resolve(a.path);if(!output.toLowerCase().endsWith('.obj'))throw new Error('Output path must end in .obj');
    const data=await this.cdp.run(`function(args){const editor=this;${lookup}return args.ids.map(id=>{const v=find(id),mesh=v.high?.faces?.mesh,g=mesh?.geometry;if(!g)throw new Error('No surface mesh for '+id);return {id,name:editor.db.getName(v)??('Object_'+id),positions:Array.from(g.attributes.position.array),indices:g.index?Array.from(g.index.array):null,matrix:mesh.matrixWorld.elements};})}`,[],[a]);
    const lines=['# Plasticity MCP: triangulated viewport mesh, meters'];let offset=1;
    for(const m of data){
     lines.push(`o ${String(m.name).replace(/[\r\n\s#]/g,'_')}`);const p=m.positions,e=m.matrix;
     for(let i=0;i<p.length;i+=3){const x=p[i],y=p[i+1],z=p[i+2];lines.push(`v ${e[0]*x+e[4]*y+e[8]*z+e[12]} ${e[1]*x+e[5]*y+e[9]*z+e[13]} ${e[2]*x+e[6]*y+e[10]*z+e[14]}`)}
     const indices=m.indices??Array.from({length:p.length/3},(_,i)=>i);
     for(let i=0;i<indices.length;i+=3)lines.push(`f ${indices[i]+offset} ${indices[i+1]+offset} ${indices[i+2]+offset}`);
     offset+=p.length/3;
    }
    await mkdir(dirname(output),{recursive:true});await writeFile(output,lines.join('\n')+'\n',{flag:'wx'});
    return {path:output,objects:data.length,vertices:offset-1,coordinateUnits:'meters'};
   }
   case 'native_screenshot':{
    if(!this.cdp.target)throw new Error('Connect to a window first');
    await this.cdp.call('Page.bringToFront',{},5000);
    const shot=await this.cdp.call('Page.captureScreenshot',{format:'png'},30000);
    return {content:[{type:'image' as const,data:shot.data,mimeType:'image/png'}]};
   }
   case 'native_execute_script':{
    const a=z.object({code:z.string().min(1).max(100000),bindings:z.array(z.string()).max(100).default([])}).strict().parse(raw);
    return this.cdp.run(`async function(...refs){const editor=this;const bindings=Object.fromEntries(${JSON.stringify(a.bindings)}.map((name,i)=>[name,refs[i]]));return await (async function(){${a.code}\n}).call(editor)}`,a.bindings);
   }
   default:throw new Error('Unknown native tool: '+name);
  }
 }
}
