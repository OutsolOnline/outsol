import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {parseXPostUrl,normalizeXImageUrl,postToWebCapture,type XPost} from '../src/lib/xPosts'
import {createXPostService,createPublicXPostHandler,createXPostsHandler} from '../src/lib/server/xPosts'

const source='https://x.com/Interior/status/463440424141459456'
const identity={id:'123',username:'Interior',name:'Interior',protected:false}
const publicUsers=[identity]
const embed={url:source,author_name:'U.S. Department of the Interior',author_url:'https://twitter.com/Interior',type:'rich',provider_name:'Twitter',provider_url:'https://twitter.com',version:'1.0',cache_age:'3153600000',width:550,height:null,html:'<blockquote class="twitter-tweet" data-dnt="true"><p lang="en">Sunsets don&#39;t get better<br>over <a href="https://twitter.com/GrandTetonNPS">@GrandTetonNPS</a> &amp; nature &#x1F305;.</p>&mdash; Interior (@Interior) <a href="https://twitter.com/Interior/status/463440424141459456?ref_src=twsrc%5Etfw">May 5, 2014</a></blockquote>'}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
const request=(value:unknown,url='https://outsol.online/api/x/post')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://outsol.online'},body:JSON.stringify(value)})
beforeEach(()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('PUBLIC_APP_URL','https://outsol.online');vi.stubEnv('APP_ORIGIN','');vi.stubEnv('APP_ALLOWED_ORIGINS','')})
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()})

describe('X post public projection',()=>{
 it('canonicalizes an exact public status URL and strips tracking',()=>{
  expect(parseXPostUrl('https://twitter.com/Interior/status/463440424141459456?s=20#reply')).toEqual({id:'463440424141459456',username:'Interior',url:source})
 })
 it.each(['https://x.com.evil.example/a/status/1','https://x.com@127.0.0.1/a/status/1','http://x.com/a/status/1','https://www.x.com/a/status/1','https://x.com:444/a/status/1','https://x.com/a/status/1/extra','https://x.com/a/status/12345678901234567890123','https://x.com/a/status/1%0a','https://x.com/a/status/1?x=%00','https://x.com/a/status/1\n','https://x.com/a/status/1?x=%zz'])('rejects SSRF or malformed URL %s',value=>{
  expect(()=>parseXPostUrl(value)).toThrow()
 })
 it('normalizes only fixed-host raster URLs to work after capture query removal',()=>{
  expect(normalizeXImageUrl('https://pbs.twimg.com/media/Abc_123?format=jpg&name=large')).toBe('https://pbs.twimg.com/media/Abc_123.jpg')
  for(const value of ['https://pbs.twimg.com.evil.example/media/photo.jpg','https://pbs.twimg.com/media/photo.svg','https://127.0.0.1/photo.jpg','https://pbs.twimg.com/media/photo?format=svg','https://pbs.twimg.com/other/photo.jpg'])expect(normalizeXImageUrl(value)).toBeUndefined()
 })
 it('creates bounded editable suggestions with a manual symbol and source attribution',()=>{
  const post:XPost={id:'1',url:'https://x.com/a/status/1',text:'😀'.repeat(12)+'\n'+'description '.repeat(200),author:{username:'a',name:'A'},createdAt:'2026-01-01',images:[{url:'https://pbs.twimg.com/media/abc?format=png&name=large'}],source:'x-api'}
  const result=postToWebCapture(post)
  expect(new TextEncoder().encode(result.name).length).toBeLessThanOrEqual(32)
  expect(result.description.length).toBeLessThanOrEqual(1000)
  expect(result.symbol).toBe('');expect(result.sourceUrl).toBe(post.url);expect(result.imageUrl).toBe('https://pbs.twimg.com/media/abc.png')
  expect(post.text.length).toBeGreaterThan(1000)
 })
})

describe('bounded official X providers',()=>{
 it('reads public oEmbed without authentication and returns only inert public data',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>json(embed)),service=createXPostService(fetcher)
  const result=(await service.readPublicPost(source)).post
  expect(result).toEqual({id:'463440424141459456',url:source,text:"Sunsets don't get better\nover @GrandTetonNPS & nature 🌅.",author:{username:'Interior',name:'U.S. Department of the Interior'},createdAt:'2014-05-05',images:[],source:'oembed'})
  const [url,options]=fetcher.mock.calls[0],upstream=new URL(String(url))
  expect(upstream.origin+upstream.pathname).toBe('https://publish.x.com/oembed');expect(upstream.searchParams.get('omit_script')).toBe('true');expect(upstream.searchParams.get('hide_thread')).toBe('true');expect(upstream.searchParams.get('dnt')).toBe('true')
  expect(options).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store'});expect(options?.headers).not.toHaveProperty('Authorization')
  expect(JSON.stringify(result)).not.toContain('html')
 })
 it('rejects mismatched authors, source IDs, scripts and malformed provider data',async()=>{
  for(const value of [{...embed,author_url:'https://evil.example/Interior'},{...embed,url:'https://x.com/Interior/status/2'},{...embed,author_url:'https://x.com/Other'},{...embed,author_url:'https://x.com/Interior\n'},{...embed,html:'<script>alert(1)</script>'+embed.html},{...embed,html:'<blockquote><p>unfinished'},{...embed,html:embed.html.replace('Sunsets','Bad\u0000text')}])await expect(createXPostService(async()=>json(value)).readPublicPost(source)).rejects.toMatchObject({status:503})
 })
 it('does not fabricate a post for private, deleted, rate-limited or unavailable responses',async()=>{
  for(const [status,want] of [[401,403],[403,403],[404,403],[429,429],[500,503]])await expect(createXPostService(async()=>new Response('private upstream secret',{status})).readPublicPost(source)).rejects.toMatchObject({status:want})
 })
 it('bounds declared and streamed provider bytes and cancels stalled bodies',async()=>{
  const huge=new Response('{}',{headers:{'content-type':'application/json','content-length':'1000000'}})
  await expect(createXPostService(async()=>huge).readPublicPost(source)).rejects.toMatchObject({status:503})
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(70000));controller.close()}})
  await expect(createXPostService(async()=>new Response(stream,{headers:{'content-type':'application/json'}})).readPublicPost(source)).rejects.toMatchObject({status:503})
  vi.useFakeTimers();let cancelled=false
  const hanging=new ReadableStream<Uint8Array>({cancel(){cancelled=true}}),pending=createXPostService(async()=>new Response(hanging,{headers:{'content-type':'application/json'}})).readPublicPost(source)
  const rejected=expect(pending).rejects.toMatchObject({status:503})
  await vi.advanceTimersByTimeAsync(9000);await rejected;expect(cancelled).toBe(true)
 })
 it('returns five-or-fewer owned original posts using current field names and safe photos',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>json({data:[{id:'1',author_id:'123',text:'short',note_post:{text:'Complete long post'},created_at:'2026-10-27T10:00:00.000Z',attachments:{media_keys:['3_1']}},{id:'2',author_id:'999',text:'Someone else'},{id:'3',author_id:'123',text:'Reply',in_reply_to_user_id:'555'},{id:'4',author_id:'123',text:'Repost',referenced_posts:[{type:'retweeted',id:'9'}]}],includes:{users:publicUsers,media:[{media_key:'3_1',type:'photo',url:'https://pbs.twimg.com/media/photo?format=png&name=large',alt_text:'Photo'}]},meta:{result_count:4}}))
  const posts=(await createXPostService(fetcher).listUserPosts('private-token',identity)).posts
  expect(posts).toEqual([{id:'1',url:'https://x.com/Interior/status/1',text:'Complete long post',author:{id:'123',username:'Interior',name:'Interior'},createdAt:'2026-10-27T10:00:00.000Z',images:[{url:'https://pbs.twimg.com/media/photo.png',alt:'Photo'}],source:'x-api'}])
  const [url,options]=fetcher.mock.calls[0],endpoint=new URL(String(url))
  expect(endpoint.origin+endpoint.pathname).toBe('https://api.x.com/2/users/123/tweets');expect(endpoint.searchParams.get('max_results')).toBe('5');expect(endpoint.searchParams.get('exclude')).toBe('replies,retweets');expect(endpoint.searchParams.get('post.fields')).toContain('note_post');expect(endpoint.searchParams.has('tweet.fields')).toBe(false)
  expect(endpoint.searchParams.get('user.fields')).toBe('protected,username,name')
  expect(options?.headers).toMatchObject({Authorization:'Bearer private-token'})
 })
 it('normalizes legacy long text and caches only inside the authenticated user scope',async()=>{
  let now=Date.parse('2026-10-27T10:00:00Z')
  const fetcher=vi.fn<typeof fetch>(async()=>json({data:[{id:'5',author_id:'123',text:'short',note_tweet:{text:'Legacy complete'}}],includes:{users:publicUsers},meta:{result_count:1}})),service=createXPostService(fetcher,()=>now)
  const first=(await service.listUserPosts('token',identity)).posts;first[0].text='Client mutation'
  expect((await service.listUserPosts('token',identity)).posts[0].text).toBe('Legacy complete');expect(fetcher).toHaveBeenCalledTimes(1)
  await expect(service.listUserPosts('token',{...identity,protected:true})).rejects.toMatchObject({status:403})
  now+=61000;await service.listUserPosts('token',identity);expect(fetcher).toHaveBeenCalledTimes(2)
 })
 it('fails closed on partial errors and missing connection and bounds public upstream refreshes',async()=>{
  await expect(createXPostService(async()=>json({data:[{id:'5',author_id:'123',text:'Available'}],errors:[{detail:'Unavailable'}]})).listUserPosts('token',identity)).rejects.toMatchObject({status:503})
  const fetcher=vi.fn<typeof fetch>(async()=>json(embed)),service=createXPostService(fetcher)
  await expect(service.listUserPosts('',identity)).rejects.toMatchObject({status:401});expect(fetcher).not.toHaveBeenCalled()
  for(let index=0;index<30;index++)await expect(service.readPublicPost(`https://x.com/Interior/status/${index+1}`)).rejects.toMatchObject({status:503})
  await expect(service.readPublicPost('https://x.com/Interior/status/32')).rejects.toMatchObject({status:429});expect(fetcher).toHaveBeenCalledTimes(30)
 })
 it('rejects missing post data, invalid timestamps and missing ownership rather than presenting success',async()=>{
  for(const body of [{meta:{result_count:2}},{data:[{id:'1',text:'Missing owner'}],includes:{users:publicUsers},meta:{result_count:1}},{data:[{id:'1',author_id:'123',text:'Bad date',created_at:'2026-02-30T10:00:00Z'}],includes:{users:publicUsers},meta:{result_count:1}}])await expect(createXPostService(async()=>json(body)).listUserPosts('token',identity)).rejects.toMatchObject({status:503})
  expect((await createXPostService(async()=>json({meta:{result_count:0}})).listUserPosts('token',identity)).posts).toEqual([])
 })
 it('requires fresh public author proof even when the stored connection profile was public',async()=>{
  const data=[{id:'1',author_id:'123',text:'Should stay private'}],meta={result_count:1}
  for(const includes of [undefined,{users:[{...identity,protected:true}]},{users:[{...identity,id:'999'}]},{users:[{id:'123',username:'Interior',name:'Interior'}]}])await expect(createXPostService(async()=>json({data,meta,includes})).listUserPosts('token',identity)).rejects.toMatchObject({status:403})
  const renamed=(await createXPostService(async()=>json({data,meta,includes:{users:[{...identity,username:'NewInterior',name:'Fresh name'}]}})).listUserPosts('token',identity)).posts
  expect(renamed[0]).toMatchObject({url:'https://x.com/NewInterior/status/1',author:{username:'NewInterior',name:'Fresh name'}})
 })
})

describe('X read-only request boundaries',()=>{
 it('allows public preview without OAuth and rejects cross-origin, oversized or extra fields',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>json(embed)),handler=createPublicXPostHandler(createXPostService(fetcher))
  const ok=await handler(request({url:source}));expect(ok.status).toBe(200);expect(await ok.json()).toMatchObject({post:{url:source,source:'oembed'}})
  const foreign=request({url:source});foreign.headers.set('origin','https://evil.example');expect((await handler(foreign)).status).toBe(403)
  expect((await handler(request({url:source,token:'secret'}))).status).toBe(400)
  const huge=request({url:source});huge.headers.set('content-length','9000');expect((await handler(huge)).status).toBe(413)
 })
 it('requires an account before returning cached account posts and sanitizes auth errors',async()=>{
  const access=async<T>(_request:Request,_operation:(token:string,user:typeof identity)=>Promise<T>):Promise<T>=>{throw Object.assign(new Error('Sensitive credential value'),{status:401,code:'connection_expired'})}
  const handler=createXPostsHandler(access,createXPostService(async()=>{throw new Error('Must not call provider')}))
  const response=await handler(new Request('https://outsol.online/api/x/posts',{headers:{Origin:'https://outsol.online'}}))
  expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'Reconnect your X account to read posts.',code:'not_connected'})
 })
 it('enforces client quotas even when the public result is cached',async()=>{
  const handler=createPublicXPostHandler(createXPostService(async()=>json(embed)))
  for(let index=0;index<10;index++)expect((await handler(request({url:source}))).status).toBe(200)
  const response=await handler(request({url:source}));expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('60')
 })
 it('preserves the actual public snapshot time while a cached preview is reused',async()=>{
  let now=Date.parse('2026-10-27T10:00:00.000Z')
  const handler=createPublicXPostHandler(createXPostService(async()=>json(embed),()=>now),()=>now)
  expect(await(await handler(request({url:source}))).json()).toMatchObject({fetchedAt:'2026-10-27T10:00:00.000Z'})
  now+=30000
  expect(await(await handler(request({url:source}))).json()).toMatchObject({fetchedAt:'2026-10-27T10:00:00.000Z'})
 })
})
