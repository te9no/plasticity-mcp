import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const run=promisify(execFile);
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function convertCad(input:string,output:string){
 const python=process.env.PLASTICITY_CAD_PYTHON??resolve(root,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
 try{await run(python,[resolve(root,'mcp-server/scripts/convert-cad.py'),input,output],{timeout:45000,maxBuffer:1024*1024,windowsHide:true});}
 catch(e:any){throw new Error(`Local CAD conversion failed. Install scripts/requirements-cad.txt in the project .venv or set PLASTICITY_CAD_PYTHON. ${e.stderr||e.message}`);}
}
