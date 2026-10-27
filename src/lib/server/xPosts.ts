import {parseXPostUrl,normalizeXImageUrl,type XPost} from '../xPosts'
import {isAllowedRequestOrigin} from './requestOrigin'

interface PublicIdentity {id:string;username:string;name:string;protected:boolean}
type WithAccessToken=<T>(request:Request,operation:(token:string,user:PublicIdentity)=>Promise<T>)=>Promise<T>
export interface XPostSnapshot {post:XPost;fetchedAt:string}
export interface XPostsSnapshot {posts:XPost[];fetchedAt:string}
export interface XPostService {readPublicPost(url:string):Promise<XPostSnapshot>;listUserPosts(token:string,user:PublicIdentity):Promise<XPostsSnapshot>}

export class XPostError extends Error {
 constructor(public status:number,public code:string,message:string){super(message);this.name='XPostError'}
}
const unavailable=()=>new XPostError(503,'provider_unavailable','X posts are temporarily unavailable. Try again later.')
const limited=()=>new XPostError(429,'rate_limited','X post requests are busy. Try again in a minute.')
const restricted=()=>new XPostError(403,'post_restricted','This post is unavailable or is not public.')
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined
const plain=(value:unknown,max=25000):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
const username=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(value)
const id=(value:unknown):value is string=>typeof value==='string'&&/^[0-9]{1,22}$/.test(value)
const copyPost=(post:XPost):XPost=>({...post,author:{...post.author},images:post.images.map(image=>({...image}))})
const copyPublicSnapshot=(snapshot:XPostSnapshot):XPostSnapshot=>({...snapshot,post:copyPost(snapshot.post)})
const copyUserSnapshot=(snapshot:XPostsSnapshot):XPostsSnapshot=>({...snapshot,posts:snapshot.posts.map(copyPost)})

function budget(clock:()=>number,globalLimit:number,clientLimit:number){
 let aggregate={count:0,expires:0}
 const clients=new Map<string,{count:number;expires:number}>()
 return(key:string)=>{
  const now=clock()
  if(aggregate.expires<=now)aggregate={count:0,expires:now+60000}
  if(clients.size>=1000)for(const [key,value] of clients)if(value.expires<=now)clients.delete(key)
  if(clients.size>=1000&&!clients.has(key))throw limited()
  const previous=clients.get(key),current=previous&&previous.expires>now?previous:{count:0,expires:now+60000}
  clients.set(key,current)
  if(++aggregate.count>globalLimit||++current.count>clientLimit)throw limited()
 }
}

async function boundedJson(response:Response,signal:AbortSignal,maximum:number):Promise<unknown>{
 const declared=response.headers.get('content-length')
 if(!response.body||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum)){void response.body?.cancel().catch(()=>{});throw unavailable()}
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0
 const abort=()=>{void reader.cancel().catch(()=>{})}
 signal.addEventListener('abort',abort,{once:true})
 try{
  if(signal.aborted)throw unavailable()
  while(true){
   const {value,done}=await reader.read()
   if(signal.aborted)throw unavailable()
   if(done)break
   length+=value.byteLength
   if(length>maximum){void reader.cancel().catch(()=>{});throw unavailable()}
   chunks.push(value)
  }
  const bytes=new Uint8Array(length);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 }finally{signal.removeEventListener('abort',abort);reader.releaseLock()}
}

function decodeEntities(value:string):string{
 const names:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',mdash:'—',ndash:'–',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',copy:'©',reg:'®'}
 return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,10});/gi,(whole,key:string)=>{
  if(key[0]!=='#')return names[key]??whole
  const point=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10)
  if(!point||point>0x10ffff||point>=0xd800&&point<=0xdfff)throw unavailable()
  return String.fromCodePoint(point)
 })
}

/** Parse only the documented fallback paragraph. Nothing is rendered or executed. */
function inertText(markup:string):string{
 const text=markup.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/?a(?:\s+[^<>]*)?>/gi,'')
 if(/[<>]/.test(text))throw unavailable()
 const decoded=decodeEntities(text).trim()
 if(!plain(decoded))throw unavailable()
 return decoded
}

function embedDate(markup:string,postId:string):string|undefined{
 const months=['January','February','March','April','May','June','July','August','September','October','November','December']
 for(const match of markup.matchAll(/<a\b[^<>]*?\bhref=(['"])(.*?)\1[^<>]*>([^<>]*)<\/a>/gi)){
  let target
  try{target=parseXPostUrl(decodeEntities(match[2]))}catch{continue}
  if(target.id!==postId)continue
  const date=/^([A-Za-z]+) ([0-9]{1,2}), ([0-9]{4})$/.exec(decodeEntities(match[3]).trim())
  if(!date)continue
  const month=months.indexOf(date[1]),day=Number(date[2]),year=Number(date[3])
  if(month<0||year<2006||year>9999)continue
  const parsed=new Date(Date.UTC(year,month,day))
  if(parsed.getUTCMonth()!==month||parsed.getUTCDate()!==day)continue
  return parsed.toISOString().slice(0,10)
 }
}

function publicEmbed(value:unknown,requested:ReturnType<typeof parseXPostUrl>):XPost{
 const item=object(value)
 if(!item||item.type!=='rich'||!plain(item.author_name,100)||typeof item.author_url!=='string'||!/^https:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}$/.test(item.author_url)||typeof item.html!=='string'||item.html.length>50000)throw unavailable()
 let source:ReturnType<typeof parseXPostUrl>,author:URL
 try{source=parseXPostUrl(item.url);author=new URL(item.author_url)}catch{throw unavailable()}
 const authorMatch=/^\/([A-Za-z0-9_]{1,15})$/.exec(author.pathname)
 if(author.protocol!=='https:'||!['x.com','twitter.com'].includes(author.hostname)||author.port||author.username||author.password||author.search||author.hash||!authorMatch||source.id!==requested.id||source.username.toLowerCase()!==authorMatch[1].toLowerCase()||requested.username.toLowerCase()!==authorMatch[1].toLowerCase())throw unavailable()
 const html=item.html.trim(),paragraph=/^<blockquote\b[^<>]*>\s*<p\b[^<>]*>([\s\S]*?)<\/p>([\s\S]*?)<\/blockquote>\s*$/i.exec(html)
 if(!paragraph||/<\s*(?:script|style|iframe|object|embed|svg|math)\b/i.test(html))throw unavailable()
 // The attribution section may contain only links; reject unexpected markup.
 if(/[<>]/.test(paragraph[2].replace(/<\/?a(?:\s+[^<>]*)?>/gi,'')))throw unavailable()
 const createdAt=embedDate(paragraph[2],requested.id)
 return{id:requested.id,url:`https://x.com/${authorMatch[1]}/status/${requested.id}`,text:inertText(paragraph[1]),author:{username:authorMatch[1],name:item.author_name},...(createdAt?{createdAt}:{}),images:[],source:'oembed'}
}

function apiPosts(value:unknown,user:PublicIdentity):XPost[]{
 const body=object(value)
 if(!body||body.errors!==undefined&&(!Array.isArray(body.errors)||body.errors.length>0)||body.data!==undefined&&!Array.isArray(body.data))throw unavailable()
 const data=(body.data||[]) as unknown[]
 const meta=object(body.meta)
 if(data.length>5||!meta||typeof meta.result_count!=='number'||!Number.isInteger(meta.result_count)||meta.result_count!==data.length)throw unavailable()
 const includes=object(body.includes),rawMedia=includes?.media
 // A stored OAuth profile can be stale after the user protects or renames an
 // account. The same timeline response must prove the author's public status.
 if(data.length){
  const authors=includes?.users
  if(!Array.isArray(authors)||authors.length>5)throw restricted()
  const matches=authors.map(object).filter(author=>author?.id===user.id)
  const fresh=matches.length===1?matches[0]:undefined
  if(!fresh||fresh.protected!==false||!username(fresh.username)||!plain(fresh.name,100))throw restricted()
  user={id:user.id,username:fresh.username,name:fresh.name,protected:false}
 }
 if(rawMedia!==undefined&&(!Array.isArray(rawMedia)||rawMedia.length>20))throw unavailable()
 const media=new Map<string,Record<string,unknown>>()
 for(const entry of (rawMedia||[]) as unknown[]){const item=object(entry);if(item&&typeof item.media_key==='string')media.set(item.media_key,item)}
 const posts:XPost[]=[]
 for(const entry of data){
  const item=object(entry)
  if(!item||!id(item.id)||!id(item.author_id))throw unavailable()
  if(item.author_id!==user.id)continue
  const references=item.referenced_posts??item.referenced_tweets
  if(item.in_reply_to_user_id||Array.isArray(references)&&references.some(value=>['retweeted','replied_to'].includes(String(object(value)?.type))))continue
  const note=object(item.note_post)??object(item.note_tweet),text=note?.text??item.text
  if(!plain(text))throw unavailable()
  let createdAt:string|undefined
  if(item.created_at!==undefined){if(typeof item.created_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(item.created_at)||!Number.isFinite(Date.parse(item.created_at)))throw unavailable();createdAt=new Date(item.created_at).toISOString();if(createdAt.slice(0,19)!==item.created_at.slice(0,19))throw unavailable()}
  const images:XPost['images']=[],keys=object(item.attachments)?.media_keys
  if(Array.isArray(keys)&&keys.length<=4)for(const key of keys){
   const photo=typeof key==='string'?media.get(key):undefined,url=photo?.type==='photo'?normalizeXImageUrl(photo.url):undefined
   if(url)images.push({url,...(plain(photo?.alt_text,1000)?{alt:photo.alt_text}:{})})
  }
  posts.push({id:item.id,url:`https://x.com/${user.username}/status/${item.id}`,text,author:{id:user.id,username:user.username,name:user.name},...(createdAt?{createdAt}:{}),images,source:'x-api'})
 }
 return posts
}

/** Fixed official endpoints; bounded caches and budgets apply before any fetch. */
export function createXPostService(upstreamFetch:typeof fetch=fetch,clock:()=>number=Date.now):XPostService{
 const upstreamBudget=budget(clock,30,6),publicCache=new Map<string,{snapshot:XPostSnapshot;expires:number}>(),userCache=new Map<string,{snapshot:XPostsSnapshot;expires:number}>()
 const publicInflight=new Map<string,Promise<XPostSnapshot>>(),userInflight=new Map<string,Promise<XPostsSnapshot>>()
 const fetchJson=async(url:URL,token?:string):Promise<unknown>=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
  const abortFailure=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(unavailable()),{once:true}))
  try{
   const response=await Promise.race([upstreamFetch(url.toString(),{method:'GET',headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal}),abortFailure])
   if(!response.ok){void response.body?.cancel().catch(()=>{});if(response.status===429)throw limited();if(response.status===401&&token)throw new XPostError(401,'not_connected','Reconnect your X account to read posts.');if([401,403,404].includes(response.status))throw restricted();throw unavailable()}
   return await boundedJson(response,controller.signal,token?262144:65536)
  }catch(error){if(error instanceof XPostError)throw error;throw unavailable()}
  finally{clearTimeout(timer)}
 }
 return{
  async readPublicPost(value){
   let source:ReturnType<typeof parseXPostUrl>
   try{source=parseXPostUrl(value)}catch{throw new XPostError(400,'invalid_request','Paste a valid public X post link.')}
   const key=source.url,cached=publicCache.get(key)
   if(cached&&cached.expires>clock())return copyPublicSnapshot(cached.snapshot)
   let pending=publicInflight.get(key)
   if(!pending){
    upstreamBudget(`public:${source.id}`)
    const url=new URL('https://publish.x.com/oembed')
    url.search=new URLSearchParams({url:source.url,omit_script:'true',hide_thread:'true',dnt:'true',lang:'en'}).toString()
    pending=fetchJson(url).then(value=>{
     const snapshot={post:publicEmbed(value,source),fetchedAt:new Date(clock()).toISOString()}
     if(publicCache.size>=256)publicCache.delete(publicCache.keys().next().value!)
     publicCache.set(key,{snapshot,expires:clock()+60000});return snapshot
    }).finally(()=>{publicInflight.delete(key)})
    publicInflight.set(key,pending)
   }
   return copyPublicSnapshot(await pending)
  },
  async listUserPosts(token,user){
   if(!token)throw new XPostError(401,'not_connected','Reconnect your X account to read posts.')
   if(!id(user.id)||!username(user.username)||!plain(user.name,100)||user.protected!==false)throw restricted()
   const cached=userCache.get(user.id)
   if(cached&&cached.expires>clock())return copyUserSnapshot(cached.snapshot)
   let pending=userInflight.get(user.id)
   if(!pending){
    upstreamBudget(`user:${user.id}`)
    const url=new URL(`https://api.x.com/2/users/${user.id}/tweets`)
    url.search=new URLSearchParams({max_results:'5',exclude:'replies,retweets','post.fields':'created_at,attachments,entities,note_post',expansions:'author_id,attachments.media_keys','user.fields':'protected,username,name','media.fields':'type,url,alt_text'}).toString()
    pending=fetchJson(url,token).then(value=>{
     const snapshot={posts:apiPosts(value,user),fetchedAt:new Date(clock()).toISOString()}
     if(userCache.size>=128)userCache.delete(userCache.keys().next().value!)
     userCache.set(user.id,{snapshot,expires:clock()+60000});return snapshot
    }).finally(()=>{userInflight.delete(user.id)})
    userInflight.set(user.id,pending)
   }
   return copyUserSnapshot(await pending)
  },
 }
}

const service=createXPostService()
const responseHeaders={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'}
function errorResponse(error:unknown):Response{
 const item=object(error),status=error instanceof XPostError?error.status:typeof item?.status==='number'&&[400,401,403,429,503].includes(item.status)?item.status:503
 const code=status===401?'not_connected':status===403?'post_restricted':status===429?'rate_limited':status===400?'invalid_request':error instanceof XPostError?error.code:'provider_unavailable'
 const message=status===401?'Reconnect your X account to read posts.':status===403?'This post or request is restricted.':status===429?'X post requests are busy. Try again in a minute.':status===400?'Paste a valid public X post link.':status===413?'The X post request is too large.':status===415?'Send the X post link as JSON.':'X posts are temporarily unavailable. Try again later.'
 return Response.json({error:message,code},{status,headers:{...responseHeaders,...(status===429?{'Retry-After':'60'}:{})}})
}
function checkRequest(request:Request,method:string){
 if(!isAllowedRequestOrigin(request))throw new XPostError(403,'origin_not_allowed','Origin not allowed')
 if(request.method!==method||new URL(request.url).searchParams.size!==0)throw new XPostError(400,'invalid_request','Unsupported request')
}
const clientKey=(request:Request)=>request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0,64)||'unknown'

export function createPublicXPostHandler(provider:XPostService=service,clock:()=>number=Date.now){
 const quota=budget(clock,60,10)
 return async(request:Request):Promise<Response>=>{
  try{
   checkRequest(request,'POST');quota(clientKey(request))
   if(!request.headers.get('content-type')?.toLowerCase().match(/^application\/json(?:\s*;|$)/))throw new XPostError(415,'invalid_request','JSON required')
   const declared=request.headers.get('content-length')
   if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>4096))throw new XPostError(413,'invalid_request','Request too large')
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000)
   let body:unknown
   try{body=await boundedJson(new Response(request.body,{headers:{'Content-Type':'application/json'}}),controller.signal,4096)}catch{throw new XPostError(400,'invalid_request','Invalid request body')}
   finally{clearTimeout(timer)}
   const item=object(body)
   if(!item||Object.keys(item).length!==1||typeof item.url!=='string')throw new XPostError(400,'invalid_request','Invalid request body')
   const snapshot=await provider.readPublicPost(item.url)
   return Response.json(snapshot,{headers:responseHeaders})
  }catch(error){return errorResponse(error)}
 }
}

export function createXPostsHandler(withAccessToken:WithAccessToken,provider:XPostService=service,clock:()=>number=Date.now){
 const quota=budget(clock,60,15),users=budget(clock,60,15)
 return async(request:Request):Promise<Response>=>{
  try{
   checkRequest(request,'GET');quota(clientKey(request))
   const snapshot=await withAccessToken(request,async(token,user)=>{users(user.id);return provider.listUserPosts(token,user)})
   return Response.json(snapshot,{headers:responseHeaders})
  }catch(error){return errorResponse(error)}
 }
}
