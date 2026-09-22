import {clientEnv} from './client-env.js';
// Read-only MCP + live connection verification.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {resolve} from 'node:path';
const client=new Client({name:'plasticity-doctor',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dirname,'../dist/index.js')],stderr:'pipe',env:clientEnv});
try{
 await client.connect(transport);
 const tools=await client.listTools();
 console.log(JSON.stringify({tools:tools.tools.map(t=>t.name)},null,2));
 const windows=await client.callTool({name:'native_windows',arguments:{}});
 if(windows.isError)throw new Error(JSON.stringify(windows.content));
 console.log(JSON.stringify(windows.content,null,2));
 if(process.env.PLASTICITY_TARGET){
  const connected=await client.callTool({name:'native_connect',arguments:{targetId:process.env.PLASTICITY_TARGET}});
  if(connected.isError)throw new Error(JSON.stringify(connected.content));
  const scene=JSON.parse((connected.content as any[])[0].text);
  console.log(JSON.stringify({targetId:scene.targetId,objectCount:scene.objects.length,coordinateUnits:scene.coordinateUnits,displayUnits:scene.displayUnits}));
 }
 console.log('MCP doctor passed');
}finally{await client.close()}
