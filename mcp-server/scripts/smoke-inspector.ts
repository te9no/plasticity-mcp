// Exercise ownership recovery on an explicitly selected disposable 26.1.3 window.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {NativeOperations} from '../src/native.js';

const targetId=process.env.PLASTICITY_TARGET;
if(!targetId||!process.env.PLASTICITY_MAIN_CDP_URL)throw new Error('Disposable main-inspector target required');
const first=new NativeOperations(),second=new NativeOperations(),replacement=new NativeOperations();
let socket:WebSocket|undefined;
let sequence=0;
async function evaluate(expression:string):Promise<any>{
 const id=++sequence,ws=socket!;
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{ws.off('message',onMessage);reject(new Error('Inspector check timed out'))},5000);
  function onMessage(data:WebSocket.RawData){
   const message=JSON.parse(data.toString());if(message.id!==id)return;
   clearTimeout(timeout);ws.off('message',onMessage);
   if(message.error||message.result?.exceptionDetails)reject(new Error(JSON.stringify(message)));
   else resolve(message.result.result.value);
  }
  ws.on('message',onMessage);
  ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
 });
}
try{
 const before=await first.handle('native_connect',{targetId});
 const target=first.cdp.target!;
 assert.ok(target.webContentsId,'Main-inspector transport required');
 assert.equal(before.recovery,null,'Recover pending operations before this check');
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise<void>((resolve,reject)=>{socket!.once('open',resolve);socket!.once('error',reject)});
 await second.handle('native_connect',{targetId});
 const id=JSON.stringify(target.webContentsId);
 const state=`globalThis[Symbol.for('plasticity-mcp.main-inspector.v1')]`;
 assert.ok(await evaluate(`${state}.entries.get(${id}).sessions.size >= 2`));
 // Simulate a renderer debugger detach independent of either MCP connection.
 await evaluate(`process.mainModule.require('electron').webContents.fromId(${id}).debugger.detach()`);
 assert.equal(await evaluate(`${state}.entries.has(${id})`),false);
 await assert.rejects(()=>first.handle('native_scene'),/session is not attached/);
 const recovered=await replacement.handle('native_connect',{targetId});
 assert.deepEqual(recovered.objects,before.objects);
 await first.cdp.disconnect();
 await second.cdp.disconnect();
 assert.equal(await evaluate(`${state}.entries.get(${id}).sessions.size`),1);
 assert.deepEqual((await replacement.handle('native_scene')).objects,before.objects);
 await replacement.cdp.disconnect();
 assert.equal(await evaluate(`${state}.entries.has(${id})`),false);
 assert.equal(await evaluate(`process.mainModule.require('electron').webContents.fromId(${id}).debugger.isAttached()`),false);
 console.log('External debugger detach, reconnect, stale-session isolation and final cleanup verified');
}finally{
 await first.cdp.disconnect();await second.cdp.disconnect();await replacement.cdp.disconnect();
 socket?.close();
}
