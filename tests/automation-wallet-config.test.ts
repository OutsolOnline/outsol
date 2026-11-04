import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {automationReadiness,automationSettings} from '../src/lib/server/automationWallets/config'
const dirs:string[]=[];afterEach(()=>{vi.unstubAllEnvs();dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}))})
function configure(){const dir=mkdtempSync(join(tmpdir(),'auto-config-'));dirs.push(dir);vi.stubEnv('NODE_ENV','test');vi.stubEnv('RAILWAY_VOLUME_MOUNT_PATH',dir);vi.stubEnv('AUTOMATION_STORAGE_DIR',join(dir,'automation'));vi.stubEnv('AUTOMATION_WALLET_ENCRYPTION_KEY',randomBytes(32).toString('base64'));vi.stubEnv('RPC_URL','https://rpc.invalid/');vi.stubEnv('AUTOMATION_TRADING_ENABLED','true');vi.stubEnv('AUTOMATION_ALLOW_LOCAL_TEST_RPC','false');for(const k of ['ASSET_STORAGE_DIR','X_STORAGE_DIR','FUNDING_STORAGE_DIR','BACKGROUND_JOBS_STORAGE_DIR'])vi.stubEnv(k,'');return dir}
describe('private automation deployment settings',()=>{
 it('rejects every public/private storage overlap and malformed encryption key',()=>{const dir=configure();for(const k of ['ASSET_STORAGE_DIR','X_STORAGE_DIR','FUNDING_STORAGE_DIR','BACKGROUND_JOBS_STORAGE_DIR']){vi.stubEnv(k,join(dir,'automation','nested'));expect(()=>automationSettings()).toThrow();vi.stubEnv(k,'')}vi.stubEnv('AUTOMATION_WALLET_ENCRYPTION_KEY','not-a-key');expect(automationReadiness()).toMatchObject({configured:false,enabled:false})})
 it('allows loopback only with explicit non-production test isolation and still rejects non-HTTP protocols',()=>{configure();vi.stubEnv('RPC_URL','http://127.0.0.1:8899/');expect(()=>automationSettings()).toThrow();vi.stubEnv('AUTOMATION_ALLOW_LOCAL_TEST_RPC','true');expect(automationSettings().rpc).toBe('http://127.0.0.1:8899/');vi.stubEnv('NODE_ENV','production');expect(()=>automationSettings()).toThrow();vi.stubEnv('NODE_ENV','test');vi.stubEnv('RPC_URL','ftp://127.0.0.1/');expect(()=>automationSettings()).toThrow()})
 it('returns no secrets, storage paths or provider URLs in readiness',()=>{configure();const encoded=JSON.stringify(automationReadiness());expect(encoded).not.toContain(process.env.AUTOMATION_WALLET_ENCRYPTION_KEY);expect(encoded).not.toContain(process.env.AUTOMATION_STORAGE_DIR);expect(encoded).not.toContain('rpc.invalid');expect(automationReadiness()).toMatchObject({configured:true,enabled:true})})
})
