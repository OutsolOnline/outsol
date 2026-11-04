import {afterEach,describe,expect,it} from 'vitest'
import {createServer,type Server} from 'node:http'
import {createAutomationRpcFetch} from '../src/lib/server/automationWallets/rpc'
const servers:Server[]=[]
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}})
async function fixture(mode:'rejected'|'oversized'|'timeout'){
 let closed=false,requests=0
 const server=createServer((_request,response)=>{requests++;response.on('close',()=>{closed=true});response.writeHead(mode==='rejected'?503:200,{'Content-Type':'application/json'});response.write(mode==='oversized'?Buffer.alloc(2_097_153,32):'{');if(mode==='oversized')response.end()})
 servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error();return {url:`http://127.0.0.1:${address.port}/`,closed:()=>closed,requests:()=>requests}
}
describe('bounded automation RPC transport',()=>{
 it('cancels an endless rejected HTTP response body before returning an error',async()=>{const f=await fixture('rejected'),rpc=createAutomationRpcFetch(f.url,fetch,1000);await expect(rpc(f.url,{method:'POST',body:'{}'})).rejects.toThrow();await new Promise(r=>setTimeout(r,50));expect(f.closed()).toBe(true)})
 it('closes oversized response streams and allows only the configured endpoint',async()=>{const f=await fixture('oversized'),rpc=createAutomationRpcFetch(f.url,fetch,1000);await expect(rpc(f.url,{method:'POST',body:'{}'})).rejects.toThrow(/too large/);await expect(rpc('http://127.0.0.1:1/',{method:'POST'})).rejects.toThrow(/destination/);expect(f.requests()).toBe(1)})
 it('aborts a stalled body read within the bounded deadline',async()=>{const f=await fixture('timeout'),rpc=createAutomationRpcFetch(f.url,fetch,30);await expect(rpc(f.url,{method:'POST',body:'{}'})).rejects.toThrow();await new Promise(r=>setTimeout(r,50));expect(f.closed()).toBe(true)})
})
