import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {OperationStore,type OperationRecord} from './operation-store.js';
import {installGuard,guardedCall,clearOperation} from './runtime-guard.js';
import {buildMainDiscoveryExpression,buildAttachExpression,buildDetachExpression,buildRendererCommandExpression,buildScreenshotExpression} from './main-inspector.js';

export class CdpError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='CdpError'}
}

export interface PlasticityTarget { id: string; title: string; url: string; webSocketDebuggerUrl: string; webContentsId?:number }
interface Remote { type: string; objectId?: string; value?: any }
export class PlasticityCdp {
  private ws?: WebSocket;
  private sequence = 0;
  private pending = new Map<number, {resolve: (v:any)=>void; reject:(e:Error)=>void; timer:NodeJS.Timeout; ws:WebSocket}>();
  private uncertain = new Map<string,OperationRecord>();
  private store:OperationStore;
  private documentToken?:string;
  private group='plasticity-mcp-'+randomUUID();
  private bindings = new Map<string, Remote>();
  private editor?: string;
  readonly endpoint:string;
  readonly mainInspector:boolean;
  target?: PlasticityTarget;
  constructor(endpoint?:string,stateDirectory?:string,mainInspector?:boolean) {
    this.endpoint=endpoint??process.env.PLASTICITY_MAIN_CDP_URL??process.env.PLASTICITY_CDP_URL??'http://127.0.0.1:9223';
    this.mainInspector=mainInspector??(endpoint===undefined&&Boolean(process.env.PLASTICITY_MAIN_CDP_URL));
    const u = new URL(this.endpoint);
    if (u.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname)) throw new Error('CDP endpoint must be local HTTP');
    this.store=new OperationStore(this.endpoint,stateDirectory);
  }
  async targets(): Promise<PlasticityTarget[]> {
    const response = await fetch(`${this.endpoint}/json/list`, {signal: AbortSignal.timeout(5000),redirect:'error'});
    if (!response.ok) throw new Error(`CDP discovery failed: HTTP ${response.status}`);
    const rows = await response.json() as PlasticityTarget[];
    if(this.mainInspector){
      if(rows.length!==1)throw new Error('Expected one Electron main inspector target');
      const inspector=rows[0]!;
      const probe=new PlasticityCdp(this.endpoint,undefined,false);
      try{
        await probe.openSocket(inspector.webSocketDebuggerUrl);
        const result=await probe.rawCall('Runtime.evaluate',{expression:buildMainDiscoveryExpression(),returnByValue:true,awaitPromise:true});
        const windows=this.unwrapMainResult(result) as {id:number;title:string;url:string}[];
        return windows.filter(w=>w.url.includes('/app_window/')&&/plasticity/i.test(w.url)).map(w=>({
          id:`${inspector.id}:${w.id}`,title:w.title,url:w.url,webSocketDebuggerUrl:inspector.webSocketDebuggerUrl,webContentsId:w.id,
        }));
      }finally{await probe.disconnect()}
    }
    return rows.filter(t => t.url?.includes('/app_window/') && /plasticity/i.test(t.url));
  }
  async connect(targetId: string,validateTarget?:(target:PlasticityTarget)=>Promise<void>): Promise<void> {
    await this.disconnect();
    const target = (await this.targets()).find(t => t.id === targetId);
    if (!target) throw new Error('Plasticity window not found. Call native_windows and use its targetId.');
    await validateTarget?.(target);
    await this.openSocket(target.webSocketDebuggerUrl);
    this.target=target;
    try {
      if(target.webContentsId!==undefined)this.unwrapMainResult(await this.rawCall('Runtime.evaluate',{
        expression:buildAttachExpression(target.webContentsId,this.group),returnByValue:true,awaitPromise:true,
      }));
      await this.discoverRuntime();
    }catch(err){await this.disconnect();throw err;}
  }
  private async openSocket(url:string){
    const u=new URL(url);
    if (!['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.protocol!=='ws:') throw new Error('Non-local debugger URL rejected');
    const ws=this.ws=new WebSocket(u,{handshakeTimeout:5000,maxPayload:64*1024*1024});
    ws.on('message', data => {
      if(this.ws!==ws)return;
      let msg:any;
      try {msg=JSON.parse(data.toString());if(!msg || typeof msg!=='object')throw new Error();}catch{this.rejectPending(new CdpError('PROTOCOL_ERROR','Invalid debugger response'),ws);ws.close();return;}
      const p=this.pending.get(msg.id); if(!p)return;
      clearTimeout(p.timer);this.pending.delete(msg.id);
      msg.error ? p.reject(new CdpError('REMOTE_ERROR',msg.error.message)) : p.resolve(msg.result);
    });
    ws.on('close',()=>{if(this.ws===ws){this.ws=undefined;this.target=undefined;this.editor=undefined;this.bindings.clear();}this.rejectPending(new CdpError('DISCONNECTED','Plasticity debugger disconnected'),ws);});
    ws.on('error',err=>this.rejectPending(new CdpError('DISCONNECTED',err.message),ws));
    await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  }
  private async discoverRuntime(){
      const fn=await this.call('Runtime.evaluate',{expression:'document.querySelector("command-log")?.handleCommandStarted',objectGroup:this.group});
      if(!fn.result?.objectId)throw new Error('Unsupported Plasticity runtime: command-log callback unavailable');
      const props=await this.call('Runtime.getProperties',{objectId:fn.result.objectId,ownProperties:true});
      const scopes=props.internalProperties?.find((p:any)=>p.name==='[[Scopes]]')?.value.objectId;
      if(!scopes)throw new Error('Plasticity runtime scope unavailable');
      const scopeRows=await this.call('Runtime.getProperties',{objectId:scopes,ownProperties:true});
      for(const scope of scopeRows.result){
        if(!scope.value?.objectId || !scope.value.description?.startsWith('Closure'))continue;
        const rows=await this.call('Runtime.getProperties',{objectId:scope.value.objectId,ownProperties:true});
        for(const row of rows.result){if(row.value && !this.bindings.has(row.name))this.bindings.set(row.name,row.value);}
      }
      this.editor=this.bindings.get('editor')?.objectId;
      if(!this.editor)throw new Error('Plasticity Editor is unavailable in this build');
      const guard=await this.inspectGuard();this.documentToken=guard.documentToken;
      await this.refreshRecovery();
  }
  names():string[]{return [...this.bindings.keys()].filter(k=>/Factory$|Command$|Vector3$|Quaternion$/.test(k)).sort()}
  bindingNames():string[]{return [...this.bindings.keys()].sort()}
  recoveryState(){return this.target?this.uncertain.get(this.target.id)??null:null}
  hasUncertainOperations(){return this.uncertain.size>0}
  async inspectGuard(){return this.evaluate(installGuard,[],[randomUUID()])}
  async refreshRecovery(){
    if(!this.target)return;
    const records=await this.store.list(this.target.id),guard=await this.inspectGuard();
    const active=guard.active;
    const first=records.find(r=>r.operationId===active?.operationId)??records[0];
    if(first)this.uncertain.set(this.target.id,first);
    else if(active)this.uncertain.set(this.target.id,{...active,reason:'Another MCP operation is awaiting acknowledgement',createdAt:''});
    else this.uncertain.delete(this.target.id);
    return {documentToken:guard.documentToken,connectedDocumentToken:this.documentToken,documentChanged:guard.documentToken!==this.documentToken};
  }
  async acknowledgeRecovery(operationId:string){
    await this.refreshRecovery();
    const current=this.recoveryState();
    if(!current || current.operationId!==operationId)throw new CdpError('RECOVERY_MISMATCH','Recovery operation does not match this window');
    const guard=await this.inspectGuard();
    if(guard.active?.state==='pending')throw new CdpError('OPERATION_PENDING','The previous operation has not been confirmed settled. Do not retry it.');
    // No active record means dispatch never started, was acknowledged, or the old renderer ended.
    if(guard.active?.operationId===operationId)await this.evaluate(clearOperation,[],[operationId]);
    await this.store.finish(this.target!.id,operationId);
    await this.refreshRecovery();
  }
  async run(declaration:string, names:string[]=[], values:unknown[]=[],options:{readOnly?:boolean;timeoutMs?:number}={}):Promise<any>{
    if(!this.editor)throw new Error('Call native_connect with an explicit window targetId first');
    if(options.readOnly)return this.evaluate(declaration,names,values,options.timeoutMs);
    await this.refreshRecovery();
    if(!options.readOnly && this.recoveryState())throw new CdpError('RECOVERY_REQUIRED','Previous operation outcome is unknown. Inspect native_scene, then use native_recover before editing.');
    // Validate bindings before recording a request which cannot be sent.
    for(const name of names)if(!this.bindings.has(name))throw new Error(`Runtime binding unavailable: ${name}`);
    const operationId=randomUUID(),targetId=this.target!.id;
    const record={operationId,documentToken:this.documentToken!,reason:'Response was not acknowledged; inspect the document before recovery',createdAt:new Date().toISOString()};
    await this.store.begin(targetId,record);
    let response:any;
    try{
      response=await this.evaluate(guardedCall(declaration,operationId,this.documentToken!),names,values,options.timeoutMs);
    }catch(err){
      this.uncertain.set(targetId,record);throw new CdpError('OUTCOME_UNKNOWN',`Operation outcome unknown: ${(err as Error).message}. Inspect native_scene and recover; do not repeat the operation.`);
    }
    if(response.guardError){
      await this.store.finish(targetId,operationId);
      throw new CdpError(response.guardError,response.guardError==='DOCUMENT_CHANGED'?'Document changed since native_connect. Inspect native_scene and explicitly connect to the intended document again.':'Another operation is active. Inspect native_scene and recover before editing.');
    }
    try{await this.evaluate(clearOperation,[],[operationId],1000);await this.store.finish(targetId,operationId)}catch(e){this.uncertain.set(targetId,record);throw new CdpError('ACKNOWLEDGEMENT_LOST','Operation finished but acknowledgement failed. Inspect native_scene and recover; do not retry. '+(e as Error).message)}
    if(response.executionError)throw new CdpError('NATIVE_ERROR',response.executionError);
    return response.value;
  }
  private async evaluate(declaration:string,names:string[]=[],values:unknown[]=[],timeout=60000){
    if(!this.editor)throw new Error('Call native_connect with an explicit window targetId first');
    const args=names.map(name=>{const value=this.bindings.get(name);if(!value)throw new Error(`Runtime binding unavailable: ${name}`);return value.objectId?{objectId:value.objectId}:{value:value.value}});
    const response=await this.call('Runtime.callFunctionOn',{objectId:this.editor,functionDeclaration:declaration,arguments:[...args,...values.map(value=>({value}))],awaitPromise:true,returnByValue:true,objectGroup:this.group},timeout);
    if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  }
  async call(method:string,params:Record<string,unknown>={},timeout=15000):Promise<any>{
    if(this.target?.webContentsId!==undefined){
      return this.unwrapMainResult(await this.rawCall('Runtime.evaluate',{
        expression:buildRendererCommandExpression(this.target.webContentsId,this.group,method,params),
        returnByValue:true,awaitPromise:true,
      },timeout));
    }
    return this.rawCall(method,params,timeout);
  }
  private unwrapMainResult(result:any){
    if(result.exceptionDetails)throw new CdpError('MAIN_INSPECTOR_ERROR',result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    return result.result?.value;
  }
  async captureScreenshot():Promise<{data:string}>{
    if(!this.target)throw new Error('Connect to a window first');
    if(this.target.webContentsId!==undefined){
      return this.unwrapMainResult(await this.rawCall('Runtime.evaluate',{
        expression:buildScreenshotExpression(this.target.webContentsId,this.group),returnByValue:true,awaitPromise:true,
      },30000));
    }
    await this.call('Page.bringToFront',{},5000);
    return this.call('Page.captureScreenshot',{format:'png'},30000);
  }
  private async rawCall(method:string,params:Record<string,unknown>={},timeout=15000):Promise<any>{
    const ws=this.ws;if(!ws || ws.readyState!==WebSocket.OPEN)throw new Error('Debugger not connected');
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new CdpError('TIMEOUT',`${method} timed out; operation outcome unknown. Inspect scene before retrying.`))},timeout);
      this.pending.set(id,{resolve,reject,timer,ws});
      ws.send(JSON.stringify({id,method,params}),(err)=>{if(err){clearTimeout(timer);this.pending.delete(id);reject(err)}});
    });
  }
  private rejectPending(error:Error,ws:WebSocket){for(const [id,p] of this.pending){if(p.ws!==ws)continue;clearTimeout(p.timer);this.pending.delete(id);p.reject(error)}}
  async disconnect(){
    const ws=this.ws;
    if(!ws)return;
    if(ws.readyState===WebSocket.OPEN){await this.call('Runtime.releaseObjectGroup',{objectGroup:this.group},1000).catch(()=>{});}
    if(ws.readyState===WebSocket.OPEN && this.target?.webContentsId!==undefined){
      await this.rawCall('Runtime.evaluate',{expression:buildDetachExpression(this.target.webContentsId,this.group),returnByValue:true,awaitPromise:true},1000).catch(()=>{});
    }
    await new Promise<void>(resolve=>{const timer=setTimeout(()=>{ws.terminate();resolve()},1000);ws.once('close',()=>{clearTimeout(timer);resolve()});ws.close()});
  }
}
