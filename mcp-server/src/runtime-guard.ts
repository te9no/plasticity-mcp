// Installed once per renderer. No application files are patched.
export const installGuard=`function(seed){
 const key=Symbol.for('plasticity-mcp.guard.v1');
 let s=globalThis[key];
 if(!s){
  s=globalThis[key]={rendererId:seed,epoch:0,active:null,document:this.document,originator:this.originator};
  s.documentClear=this.document.clear;s.originatorClear=this.originator.clear;
  s.clearDocument=function(...args){s.epoch++;return s.documentClear.apply(this,args)};
  s.clearOriginator=function(...args){s.epoch++;return s.originatorClear.apply(this,args)};
  this.document.clear=s.clearDocument;this.originator.clear=s.clearOriginator;
 }
 if(s.document!==this.document||s.originator!==this.originator||this.document.clear!==s.clearDocument||this.originator.clear!==s.clearOriginator)throw new Error('Unsupported runtime: document guard was replaced');
 return {documentToken:s.rendererId+':'+s.epoch+':'+(this.document.uuid??''),active:s.active};
}`;

export function guardedCall(declaration:string,operationId:string,documentToken:string){return `async function(...args){
 const s=globalThis[Symbol.for('plasticity-mcp.guard.v1')];
 if(!s||s.document!==this.document||this.document.clear!==s.clearDocument||this.originator.clear!==s.clearOriginator)return {guardError:'DOCUMENT_CHANGED'};
 const token=s.rendererId+':'+s.epoch+':'+(this.document.uuid??'');
 if(token!==${JSON.stringify(documentToken)})return {guardError:'DOCUMENT_CHANGED'};
 if(s.active)return {guardError:'RECOVERY_REQUIRED'};
 const operationId=${JSON.stringify(operationId)};s.active={operationId,state:'pending',documentToken:token};
 try{return {value:await (${declaration}).apply(this,args)}}catch(e){return {executionError:String(e?.stack??e)}}finally{if(s.active?.operationId===operationId)s.active.state='settled'}
}`}

export const clearOperation=`function(id){const s=globalThis[Symbol.for('plasticity-mcp.guard.v1')];if(s?.active?.operationId===id&&s.active.state==='settled'){s.active=null;return true}return false}`;
