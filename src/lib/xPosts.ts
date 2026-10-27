import type {WebCapture} from './webCapture'

export interface XPost {
 id:string
 url:string
 text:string
 author:{id?:string;username:string;name:string}
 createdAt?:string
 images:Array<{url:string;alt?:string}>
 source:'x-api'|'oembed'
}

const CONTROL=/[\u0000-\u001f\u007f]/

/** Parse a post identifier, never a general-purpose URL for server fetching. */
export function parseXPostUrl(value:unknown):{id:string;username:string;url:string}{
 if(typeof value!=='string'||value.length>2048||/\s/.test(value)||CONTROL.test(value))throw new Error('Paste a public X post link.')
 let decoded:string
 try{decoded=decodeURIComponent(value)}catch{throw new Error('Paste a valid X post link.')}
 if(CONTROL.test(decoded))throw new Error('Paste a valid X post link.')
 const match=/^https:\/\/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,22})(?:[?#][^\s]*)?$/.exec(value)
 if(!match)throw new Error('Use an HTTPS x.com or twitter.com post link.')
 return{id:match[2],username:match[1],url:`https://x.com/${match[1]}/status/${match[2]}`}
}

/** Only X's raster photo host; put the format in the path for capture imports. */
export function normalizeXImageUrl(value:unknown):string|undefined{
 if(typeof value!=='string'||value.length>2048||CONTROL.test(value)||/\s/.test(value))return
 try{
  const url=new URL(value)
  if(url.protocol!=='https:'||url.hostname!=='pbs.twimg.com'||url.port||url.username||url.password)return
  const path=/^\/media\/([A-Za-z0-9_-]{1,200})(?:\.(jpg|jpeg|png|webp|gif))?$/.exec(url.pathname)
  if(!path)return
  const format=path[2]||url.searchParams.get('format')
  if(!format||!['jpg','jpeg','png','webp','gif'].includes(format))return
  return`https://pbs.twimg.com/media/${path[1]}.${format}`
 }catch{return}
}

function utf8Prefix(value:string,maxBytes:number):string{
 let result='',size=0
 for(const point of value){const bytes=new TextEncoder().encode(point).length;if(size+bytes>maxBytes)break;result+=point;size+=bytes}
 return result
}

/** Suggestions are separate from the original source; the symbol needs review. */
export function postToWebCapture(post:XPost):WebCapture{
 const source=parseXPostUrl(post.url),singleLine=post.text.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()
 const name=utf8Prefix(singleLine||`Post by @${post.author.username}`,32).trim()
 let description=post.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,1000)
 if(/[\uD800-\uDBFF]$/.test(description))description=description.slice(0,-1)
 const imageUrl=post.images.map(image=>normalizeXImageUrl(image.url)).find(Boolean)
 return{version:1,kind:'selection',name,symbol:'',description,sourceUrl:source.url,...(imageUrl?{imageUrl}:{})}
}
