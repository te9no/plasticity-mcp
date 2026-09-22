import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {createContext,runInContext} from 'node:vm';
import {EventEmitter,once} from 'node:events';
import {PlasticityCdp} from './cdp.js';

type DebuggerCall={method:string;params:any};

test('main inspector relays renderer CDP, unwraps results, and reference-counts debugger attachment',async()=>{
 let port=0;
 const calls:DebuggerCall[]=[];
 const attachCalls:number[]=[];
 const detachCalls:number[]=[];
 const editor={document:{uuid:'test-document',clear(){}},originator:{clear(){}},window:'primary'};
 const bindings={editor:{type:'object',objectId:'editor'},SphereFactory:{type:'function',objectId:'factory'}};
 const rendererContext=createContext({editor});
 // vm contexts supply their own globalThis; keeping the renderer state here makes
 // installGuard, guardedCall and clearOperation behave as they do in a renderer.
 const objectFor=(id:string)=>id==='editor'?editor:id==='factory'?{kind:'factory'}:undefined;
 const debuggerApi=Object.assign(new EventEmitter(),{
  isAttached:()=>attachCalls.length>detachCalls.length,
  attach:(_version:string)=>attachCalls.push(1),
  detach:()=>{detachCalls.push(1);debuggerApi.emit('detach',{},'target closed')},
  async sendCommand(method:string,params:any){
   calls.push({method,params});
   if(method==='Runtime.evaluate')return {result:{objectId:'callback'}};
   if(method==='Runtime.getProperties'){
    if(params.objectId==='callback')return {internalProperties:[{name:'[[Scopes]]',value:{objectId:'scopes'}}]};
    if(params.objectId==='scopes')return {result:[{name:'0',value:{objectId:'closure',description:'Closure (CommandLog)'}}]};
    if(params.objectId==='closure')return {result:Object.entries(bindings).map(([name,value])=>({name,value}))};
   }
   if(method==='Runtime.callFunctionOn'){
    const args=params.arguments.map((arg:any)=>arg.objectId?objectFor(arg.objectId):arg.value);
    try{
     const value=await Promise.resolve(runInContext(`(${params.functionDeclaration})`,rendererContext).apply(editor,args));
     return {result:{value}};
    }catch(error){return {exceptionDetails:{text:String(error)}};}
   }
   if(method==='Runtime.releaseObjectGroup')return {};
   throw new Error(`unexpected renderer command: ${method}`);
  },
 });
 const windows=[
  {id:101,getTitle:()=> 'Plasticity A',getURL:()=> 'file:///Plasticity/app/.webpack/renderer/app_window/index.html',isDestroyed:()=>false,debugger:debuggerApi},
  {id:202,getTitle:()=> 'Plasticity B',getURL:()=> 'file:///Plasticity/app/.webpack/renderer/app_window/index.html',isDestroyed:()=>false,debugger:debuggerApi},
  {id:303,getTitle:()=> 'Settings',getURL:()=> 'file:///Plasticity/app/.webpack/renderer/settings/index.html',isDestroyed:()=>false,debugger:debuggerApi},
 ].map(window=>Object.assign(new EventEmitter(),window));
 const electron={BrowserWindow:{getAllWindows:()=>windows.map(webContents=>({webContents}))},webContents:{fromId:(id:number)=>windows.find(window=>window.id===id)}};
 const mainContext=createContext({process:{mainModule:{require:(name:string)=>{assert.equal(name,'electron');return electron;}}}});
 const http=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify([
  {id:'main',title:'Plasticity Main',url:'node://electron/main',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/main`},
 ]))});
 const wss=new WebSocketServer({server:http});
 wss.on('connection',(ws,request)=>ws.on('message',async data=>{
  const {id,method,params}=JSON.parse(data.toString());
  try{
   assert.equal(request.url,'/main');
   assert.equal(method,'Runtime.evaluate');
   const value=await Promise.resolve(runInContext(params.expression,mainContext));
   ws.send(JSON.stringify({id,result:{result:{value}}}));
  }catch(error){ws.send(JSON.stringify({id,result:{exceptionDetails:{text:String(error)}}}));}
 }));
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
 port=(http.address() as any).port;
 const state=await mkdtemp(join(tmpdir(),'plasticity-cdp-main-'));
 const endpoint=`http://127.0.0.1:${port}`;
 const first=new PlasticityCdp(endpoint,state,true);
 const second=new PlasticityCdp(endpoint,state,true);
 try{
  const targets=await first.targets();
  assert.deepEqual(targets.map(target=>({id:target.id,title:target.title})),[
   {id:'main:101',title:'Plasticity A'},
   {id:'main:202',title:'Plasticity B'},
  ]);
  await assert.rejects(()=>first.connect('main:404'),/not found/);
  assert.equal(attachCalls.length,0);
  await first.connect('main:202');
  assert.equal(first.target?.webContentsId,202);
  assert.equal(attachCalls.length,1);
  assert.deepEqual(await first.run('function(factory,input){return {window:this.window,factory,input}}',['SphereFactory'],[{radius:3}],{readOnly:true}),{window:'primary',factory:{kind:'factory'},input:{radius:3}});
  await assert.rejects(()=>first.run('function throwTest(){throw new Error("renderer failure")}'),/renderer failure/);
  await second.connect('main:202');
  assert.equal(attachCalls.length,1);
  await first.disconnect();
  assert.equal(detachCalls.length,0);
  await second.disconnect();
  assert.equal(detachCalls.length,1);
  await first.connect('main:101');
  assert.equal(first.target?.id,'main:101');
  assert.equal(attachCalls.length,2);
  await first.run('function(){return 42}');
  assert.ok(calls.some(call=>call.method==='Runtime.callFunctionOn'));
  // A transport drop leaves ownership in the main process. Reusing this client
  // must reclaim its session, then release the last attachment on disconnect.
  const socket=(first as any).ws;
  const closed=once(socket,'close');
  for(const peer of wss.clients)peer.terminate();
  await closed;
  assert.equal(first.target,undefined);
  assert.equal(debuggerApi.isAttached(),true);
  await first.connect('main:101');
  assert.equal(attachCalls.length,2);
  await first.disconnect();
  assert.equal(debuggerApi.isAttached(),false);
 }finally{
  await first.disconnect();
  await second.disconnect();
  wss.close();
  await new Promise<void>(resolve=>http.close(()=>resolve()));
  await rm(state,{recursive:true,force:true});
 }
});

test('main inspector mode retains the local endpoint restriction',()=>{
 assert.throws(()=>new PlasticityCdp('http://example.com:9223',undefined,true),/local/);
});

test('an explicit renderer endpoint is not changed by the main inspector environment',()=>{
 const previous=process.env.PLASTICITY_MAIN_CDP_URL;
 process.env.PLASTICITY_MAIN_CDP_URL='http://127.0.0.1:9230';
 try{
  const automatic=new PlasticityCdp();
  assert.equal(automatic.endpoint,'http://127.0.0.1:9230');
  assert.equal(automatic.mainInspector,true);
  assert.equal(new PlasticityCdp('http://127.0.0.1:9223').mainInspector,false);
  assert.equal(new PlasticityCdp('http://127.0.0.1:9230',undefined,true).mainInspector,true);
 }finally{
  if(previous===undefined)delete process.env.PLASTICITY_MAIN_CDP_URL;
  else process.env.PLASTICITY_MAIN_CDP_URL=previous;
 }
});
