'use strict';
const {randomBytes}=require('node:crypto');const {Readable}=require('node:stream');
module.exports=function createGateway(verify){
 const sessions=new Map();
 const cleanup=setInterval(()=>{for(const [key,value]of sessions)if(value.exp<Date.now())sessions.delete(key);},60000);cleanup.unref();
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const urlOf=value=>{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Only HTTP(S) URLs without embedded credentials are supported');return u.href;};
 const headersOf=value=>{const headers={};for(const [key,v]of Object.entries(value||{})){if(!['host','connection','content-length','transfer-encoding','cookie','x-user-token','x-user-name','x-frontend-auth'].includes(key.toLowerCase()))headers[key]=String(v);}return headers;};
 const bodyOf=async req=>{const chunks=[];let total=0;for await(const c of req){total+=c.length;if(total>2*1024*1024)throw new Error('Request exceeds 2 MB');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
 return async function(req,res){
  try{const path=new URL(req.url,'http://local').pathname;
   if(path.startsWith('/api/user/media/')){
    const session=sessions.get(path.slice('/api/user/media/'.length));if(!session||session.exp<Date.now())return json(res,401,{error:'Media session expired'});
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
    const ctrl=new AbortController();res.on('close',()=>ctrl.abort());const headers={...session.headers};if(req.headers.range)headers.Range=req.headers.range;
    const wait=setTimeout(()=>ctrl.abort(),20000);let up;try{up=await fetch(session.url,{method:req.method,headers,signal:ctrl.signal});}finally{clearTimeout(wait);}const out={'Cache-Control':'private, no-store'};
    for(const name of ['content-type','content-length','content-range','accept-ranges','last-modified'])if(up.headers.has(name))out[name]=up.headers.get(name);
    res.writeHead(up.status,out);if(req.method==='HEAD'||!up.body)return res.end();Readable.fromWeb(up.body).on('error',()=>res.destroy()).pipe(res);return;
   }
   const username=verify(req);if(!username)return json(res,401,{error:'Unauthorized'});if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
   const body=await bodyOf(req),url=urlOf(body.url),headers=headersOf(body.headers);
   if(path==='/api/user/media'){
    // Media elements cannot attach custom headers. Opaque short-lived URLs carry
    // no upstream credentials, and can only be created by an authenticated user.
    if(sessions.size>=2000)return json(res,429,{error:'Too many active media sessions'});
    const id=randomBytes(24).toString('hex');sessions.set(id,{url,headers,username,exp:Date.now()+6*3600000});return json(res,200,{url:'/api/user/media/'+id});
   }
   if(path!=='/api/user/request')return json(res,404,{error:'Not found'});
   const method=String(body.method||'GET').toUpperCase();if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','PROPFIND','REPORT','MKCOL','MOVE','COPY'].includes(method))return json(res,400,{error:'Unsupported method'});
   const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),20000);
   try{const up=await fetch(url,{method,headers,body:['GET','HEAD'].includes(method)?undefined:body.body||undefined,signal:ctrl.signal});
    const chunks=[];let total=0;if(up.body){for await(const chunk of Readable.fromWeb(up.body)){total+=chunk.length;if(total>12*1024*1024){ctrl.abort();throw new Error('Response exceeds 12 MB');}chunks.push(chunk);}}
    const binary=Buffer.concat(chunks);return json(res,200,{status:up.status,headers:Object.fromEntries(up.headers),body:binary.toString('base64'),encoding:'base64'});
   }finally{clearTimeout(timeout);}
  }catch(error){if(!res.headersSent)json(res,error.name==='AbortError'?504:400,{error:error.message});else res.destroy();}
 };
};
