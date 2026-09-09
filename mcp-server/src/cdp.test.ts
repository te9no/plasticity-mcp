import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {PlasticityCdp} from './cdp.js';
import {createContext,runInContext} from 'node:vm';

test('CDP selects explicit Plasticity target, discovers bindings, surfaces errors and reconnects',async()=>{
 const http=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify([
  {id:'first',title:'Model A',url:'file:///Plasticity/app/.webpack/renderer/app_window/index.html',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/first`},
  {id:'second',title:'Model B',url:'file:///Plasticity/app/.webpack/renderer/app_window/index.html',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/second`},
  {id:'other',title:'Other app',url:'https://example.com',webSocketDebuggerUrl:`ws://127.0.0.1:${port}/other`}
 ]))});
 const wss=new WebSocketServer({server:http});let port=0;const connections:string[]=[];
 const contexts=new Map<string,ReturnType<typeof createContext>>();
 wss.on('connection',(ws,req)=>{connections.push(req.url!);ws.on('message',data=>{
  const {id,method,params}=JSON.parse(data.toString());let result:any={};
  if(method==='Runtime.evaluate')result={result:{objectId:'callback'}};
  if(method==='Runtime.getProperties'){
   if(params.objectId==='callback')result={internalProperties:[{name:'[[Scopes]]',value:{objectId:'scopes'}}]};
   if(params.objectId==='scopes')result={result:[{name:'0',value:{objectId:'closure',description:'Closure (CommandLog)'}}]};
   if(params.objectId==='closure')result={result:[{name:'editor',value:{type:'object',objectId:'editor'}},{name:'SphereFactory',value:{type:'function',objectId:'factory'}}]};
  }
  if(method==='Runtime.callFunctionOn'){
   {
    const context=contexts.get(req.url!)??createContext({setTimeout,editor:{target:req.url,document:{clear(){}},originator:{clear(){}}}});contexts.set(req.url!,context);
    const declaration=params.functionDeclaration.replaceAll('function(){}','function(...args){return {target:this.target,args}}').replace('function exception(){}','function exception(){throw new Error("Operation failed")}');
    const args=params.arguments.map((a:any)=>a.objectId?{objectId:a.objectId}:a.value);
    Promise.resolve(runInContext(`(${declaration})`,context).apply(context.editor,args)).then(value=>{if(ws.readyState===1)ws.send(JSON.stringify({id,result:{result:{value}}}))},e=>{if(ws.readyState===1)ws.send(JSON.stringify({id,result:{exceptionDetails:{text:String(e)}}}))});
    if(params.functionDeclaration.includes('disconnectTest'))ws.close();
    return;
   }
  }
  if(method==='NeverReplies')return;
  ws.send(JSON.stringify({id,result}));
 })});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));port=(http.address() as any).port;
 const c=new PlasticityCdp(`http://127.0.0.1:${port}`);
 try{
  assert.equal((await c.targets()).length,2);
  await assert.rejects(()=>c.connect('missing'),/not found/);assert.equal(connections.length,0);
  await c.connect('second');assert.deepEqual(connections,['/second']);
  assert.ok(c.names().includes('SphereFactory'));
  assert.deepEqual(await c.run('function(){}',['SphereFactory'],[{radius:3}]),{target:'/second',args:[{objectId:'factory'},{radius:3}]});
  await assert.rejects(()=>c.run('function(){}',['MissingFactory']),/unavailable/);
  await assert.rejects(()=>c.run('function exception(){}'),/Operation failed/);
  await assert.rejects(()=>c.call('NeverReplies',{},15),/outcome unknown/);
  const pending=c.call('NeverReplies');const rejected=assert.rejects(pending,/disconnected/);
  await c.disconnect();await rejected;assert.equal(c.target,undefined);
  await assert.rejects(()=>c.run('function(){}'),/native_connect/);
  await c.connect('first');assert.equal((await c.run('function(){}')).target,'/first');
  await assert.rejects(()=>c.run('async function delayedTest(){await new Promise(r=>setTimeout(r,150));return 1}',[],[],{timeoutMs:10}),/outcome unknown/);
  const operationId=c.recoveryState()!.operationId;
  const other=new PlasticityCdp(`http://127.0.0.1:${port}`);
  await other.connect('first');assert.equal(other.recoveryState()!.operationId,operationId);
  await assert.rejects(()=>other.run('function(){}'),/Inspect native_scene/);await other.disconnect();
  await assert.rejects(()=>c.run('function(){}'),/Inspect native_scene/);
  assert.equal((await c.run('function(){}',[],[],{readOnly:true})).target,'/first');
  await assert.rejects(()=>c.acknowledgeRecovery(operationId),/not been confirmed settled/);
  await c.connect('second');assert.equal(c.recoveryState(),null);
  await c.connect('first');assert.equal(c.recoveryState()!.operationId,operationId);
  await assert.rejects(()=>c.acknowledgeRecovery('wrong'),/does not match/);
  await new Promise(r=>setTimeout(r,160));
  await c.acknowledgeRecovery(operationId);assert.equal(c.recoveryState(),null);
  assert.equal((await c.run('function(){}')).target,'/first');
  await assert.rejects(()=>c.run('async function disconnectTest(){await new Promise(r=>setTimeout(r,40))}'),/outcome unknown/);
  assert.equal(c.hasUncertainOperations(),true);
  await c.connect('first');assert.ok(c.recoveryState());
  await new Promise(r=>setTimeout(r,50));
  await c.acknowledgeRecovery(c.recoveryState()!.operationId);
  const original=(await c.inspectGuard()).documentToken;
  await c.run('function(){this.document.clear()}');
  assert.notEqual((await c.inspectGuard()).documentToken,original);
  await assert.rejects(()=>c.run('function(){}'),/Document changed/);
  await c.run('function(){}',[],[],{readOnly:true});
  await c.connect('first');await c.run('function(){}');
  await assert.rejects(()=>c.connect('missing'),/not found/);
  await assert.rejects(()=>c.run('function(){}'),/native_connect/);
 }finally{await c.disconnect();wss.close();await new Promise<void>(r=>http.close(()=>r()))}
});
test('CDP refuses non-local endpoints',()=>{
 assert.throws(()=>new PlasticityCdp('http://example.com:9223'),/local/);
 assert.throws(()=>new PlasticityCdp('https://127.0.0.1:9223'),/local/);
});
test('CDP discovery refuses redirects',async()=>{
 const http=createServer((_req,res)=>{res.writeHead(302,{Location:'http://example.com/json/list'});res.end()});
 await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
 try{const c=new PlasticityCdp(`http://127.0.0.1:${(http.address() as any).port}`);await assert.rejects(()=>c.targets(),/fetch failed/);}
 finally{await new Promise<void>(r=>http.close(()=>r()))}
});
