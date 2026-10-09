import {
 generateRegistrationOptions, verifyRegistrationResponse,
 generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';

const result=(data,status=200,headers={})=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}
});
const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const b64=value=>btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const challengeId=()=>crypto.randomUUID();
async function getBody(request){const content=await request.text();if(content.length>25000)throw Error('Dados muito grandes.');return JSON.parse(content);}
function ensureOrigin(request){
 const origin=request.headers.get('origin');
 if(origin!==new URL(request.url).origin)throw Error('Origem não autorizada.');
}
export async function passkeyRoutes(request,env,url,{isAdmin,createAdminSession}){
 const path=url.pathname,method=request.method;
 if(!path.startsWith('/api/admin/passkey'))return null;
 try{
  if(method!=='GET')ensureOrigin(request);
  const rpID=url.hostname,expectedOrigin=url.origin;
  if(path==='/api/admin/passkeys'&&method==='GET'){
   if(!await isAdmin(request,env))return result({error:'Não autorizado.'},401);
   const rows=await env.DB.prepare('SELECT id,label,created_at FROM admin_passkeys ORDER BY created_at DESC').all();
   return result({passkeys:rows.results});
  }
  if(path==='/api/admin/passkeys/register/options'&&method==='POST'){
   if(!await isAdmin(request,env))return result({error:'Entre com sua senha antes de cadastrar a digital.'},401);
   const keys=(await env.DB.prepare('SELECT id,transports FROM admin_passkeys').all()).results;
   const options=await generateRegistrationOptions({
    rpName:'Libri RSVP',rpID,userID:new TextEncoder().encode('libri-admin'),
    userName:'Libri Admin',attestationType:'none',authenticatorSelection:{
     residentKey:'required',userVerification:'required'
    },excludeCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports||'[]')}))
   });
   const id=challengeId();
   await env.DB.prepare("DELETE FROM passkey_challenges WHERE expires_at<?").bind(new Date().toISOString()).run();
   await env.DB.prepare("INSERT INTO passkey_challenges(id,challenge,kind,expires_at) VALUES(?,?,'register',?)")
    .bind(id,options.challenge,new Date(Date.now()+300000).toISOString()).run();
   return result({options,challenge_id:id});
  }
  if(path==='/api/admin/passkeys/login/options'&&method==='POST'){
   const total=await env.DB.prepare("SELECT COUNT(*) n FROM passkey_challenges WHERE kind='login' AND expires_at>?").bind(new Date().toISOString()).first();
   if(total.n>=100)return result({error:'Muitas tentativas. Tente mais tarde.'},429);
   const keys=(await env.DB.prepare('SELECT id FROM admin_passkeys').all()).results;
   if(!keys.length)return result({error:'Nenhuma digital cadastrada. Entre com a senha primeiro.'},404);
   const options=await generateAuthenticationOptions({rpID,userVerification:'required'});
   const id=challengeId();
   await env.DB.prepare("INSERT INTO passkey_challenges(id,challenge,kind,expires_at) VALUES(?,?,'login',?)")
    .bind(id,options.challenge,new Date(Date.now()+300000).toISOString()).run();
   return result({options,challenge_id:id});
  }
  if(path==='/api/admin/passkeys/register/verify'&&method==='POST'){
   if(!await isAdmin(request,env))return result({error:'Sessão expirada.'},401);
   const body=await getBody(request);
   const row=await env.DB.prepare("DELETE FROM passkey_challenges WHERE id=? AND kind='register' AND expires_at>? RETURNING *")
    .bind(body.challenge_id,new Date().toISOString()).first();
   if(!row)return result({error:'Desafio expirado. Tente novamente.'},400);
   const verification=await verifyRegistrationResponse({
    response:body.response,expectedChallenge:row.challenge,expectedOrigin,expectedRPID:rpID,requireUserVerification:true
   });
   if(!verification.verified)return result({error:'Digital não validada.'},401);
   const credential=verification.registrationInfo.credential;
   await env.DB.prepare('INSERT INTO admin_passkeys(id,public_key,counter,transports,label,created_at) VALUES(?,?,?,?,?,?)')
    .bind(credential.id,b64(credential.publicKey),credential.counter,JSON.stringify(credential.transports||[]),
     String(body.label||'Meu celular').trim().slice(0,80),new Date().toISOString()).run();
   return result({ok:true});
  }
  if(path==='/api/admin/passkeys/login/verify'&&method==='POST'){
   const body=await getBody(request);
   const c=await env.DB.prepare("DELETE FROM passkey_challenges WHERE id=? AND kind='login' AND expires_at>? RETURNING *")
    .bind(body.challenge_id,new Date().toISOString()).first();
   if(!c)return result({error:'Desafio expirado.'},400);
   const key=await env.DB.prepare('SELECT * FROM admin_passkeys WHERE id=?').bind(body.response?.id||'').first();
   if(!key)return result({error:'Dispositivo não cadastrado.'},401);
   const verification=await verifyAuthenticationResponse({
    response:body.response,expectedChallenge:c.challenge,expectedOrigin,expectedRPID:rpID,requireUserVerification:true,
    credential:{id:key.id,publicKey:bytes(key.public_key),counter:key.counter,transports:JSON.parse(key.transports)}
   });
   if(!verification.verified)return result({error:'Autenticação não validada.'},401);
   const update=await env.DB.prepare('UPDATE admin_passkeys SET counter=? WHERE id=? AND counter=?')
    .bind(verification.authenticationInfo.newCounter,key.id,key.counter).run();
   if(!update.meta.changes)return result({error:'Reinicie a autenticação.'},409);
   return result({ok:true},200,{'set-cookie':await createAdminSession(env)});
  }
  if(path==='/api/admin/passkeys/delete'&&method==='POST'){
   if(!await isAdmin(request,env))return result({error:'Não autorizado.'},401);
   const b=await getBody(request);
   await env.DB.prepare('DELETE FROM admin_passkeys WHERE id=?').bind(String(b.id||'')).run();
   return result({ok:true});
  }
  return result({error:'Rota não encontrada.'},404);
 }catch(err){
  console.error('passkey_request_failed',err?.name);
  return result({error:'Não foi possível validar o dispositivo. Confira sua digital ou tente novamente.'},400);
 }
}