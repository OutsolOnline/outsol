import {withAppAccess} from '@/lib/server/appAccess'
import {isAllowedRequestOrigin} from '@/lib/server/requestOrigin'
import {readSubmissionProviders} from '@/lib/server/providerRacing'
export const runtime='nodejs'
export const GET=withAppAccess(async(request:Request)=>{
 const headers={'Cache-Control':'no-store'}
 if(!isAllowedRequestOrigin(request))return Response.json({error:'Origin not allowed'},{status:403,headers})
 try{const count=readSubmissionProviders().length;return Response.json({submission:count>1?'redundant':count===1?'single':'unavailable',providers:count,platformFeeBps:0,networkVerification:'before-redundant-submission'},{headers})}catch{return Response.json({submission:'unavailable',providers:0,platformFeeBps:0},{headers})}
})
