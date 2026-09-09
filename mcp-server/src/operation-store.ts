import {mkdir,readFile,readdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';

export interface OperationRecord {operationId:string;documentToken:string;reason:string;createdAt:string}
/** Write-ahead records: a renderer mutation is never sent before its record is durable. */
export class OperationStore {
 constructor(readonly endpoint:string,readonly root=process.env.PLASTICITY_STATE_DIR??join(process.env.LOCALAPPDATA??homedir(),'plasticity-mcp','state')){}
 private directory(target:string){return join(this.root,createHash('sha256').update(this.endpoint+'\n'+target).digest('hex'))}
 async list(target:string):Promise<OperationRecord[]>{
  const directory=this.directory(target);
  let files:string[];try{files=await readdir(directory)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
  const records:OperationRecord[]=[];
  for(const file of files.filter(f=>f.endsWith('.json')).sort()){
   let value:OperationRecord;
   try{value=JSON.parse(await readFile(join(directory,file),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw new Error('Unusable recovery journal; edits disabled: '+join(directory,file))}
   if(value.operationId+'.json'!==file || !/^[a-f0-9-]{36}$/.test(value.operationId)||typeof value.documentToken!=='string')throw new Error('Invalid recovery journal: '+file);
   records.push(value);
  }
  return records;
 }
 async begin(target:string,record:OperationRecord){
  const directory=this.directory(target);await mkdir(directory,{recursive:true});
  // flush ensures a successful await has reached the OS before dispatching the mutation.
  await writeFile(join(directory,record.operationId+'.json'),JSON.stringify(record),{flag:'wx',flush:true});
 }
 async finish(target:string,id:string){
  if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid operation ID');
  await unlink(join(this.directory(target),id+'.json')).catch(e=>{if(e.code!=='ENOENT')throw e});
 }
}
