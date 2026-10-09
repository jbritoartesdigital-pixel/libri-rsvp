import QRCode from 'qrcode';
const j=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const q=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const stamp=()=>new Date().toISOString();
const raw=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const digest=async x=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const eventActive=e=>e&&e.status==='active'&&!e.archived_at&&e.checkin_mode!=='off';
const data=async req=>{const s=await req.text();if(s.length>10000)throw Error('Conteúdo muito grande.');return JSON.parse(s);};
export async function assignQr(env,event,guest){
 if(!eventActive(event)||guest.response_status!=='yes'||guest.deleted_at)return [];
 if(event.checkin_mode==='family'){
  let t=(await q(env,'SELECT qr_token FROM guests WHERE id=?',guest.id).first())?.qr_token;
  if(!t){t=raw();await q(env,"UPDATE guests SET qr_token=? WHERE id=? AND response_status='yes' AND deleted_at IS NULL",t,guest.id).run();}
  return [{name:guest.group_label||guest.primary_name,url:'/qr/'+t}];
 }
 const members=(await q(env,"SELECT id,name,qr_token FROM guest_members WHERE guest_id=? AND event_id=? AND deleted_at IS NULL AND attendance_status='yes' ORDER BY sort_order",guest.id,event.id).all()).results;
 for(const m of members)if(!m.qr_token){
  const code=raw();await q(env,"UPDATE guest_members SET qr_token=? WHERE id=? AND deleted_at IS NULL AND attendance_status='yes'",code,m.id).run();m.qr_token=code;
 }
 return members.filter(m=>m.qr_token).map(m=>({name:m.name,url:'/qr/'+m.qr_token}));
}
async function inspect(env,code){
 if(!code||code.length>200)return null;
 const family=await q(env,"SELECT e.id event_id,e.title,g.id guest_id,COALESCE(g.group_label,g.primary_name) name,g.group_label FROM guests g JOIN events e ON e.id=g.event_id WHERE g.qr_token=? AND g.deleted_at IS NULL AND g.response_status='yes' AND e.status='active' AND e.archived_at IS NULL AND e.checkin_mode='family'",code).first();
 if(family)return {...family,member_id:null,subject:'family:'+family.guest_id};
 const person=await q(env,"SELECT e.id event_id,e.title,g.id guest_id,m.id member_id,m.name,g.group_label FROM guest_members m JOIN guests g ON g.id=m.guest_id JOIN events e ON e.id=g.event_id WHERE m.qr_token=? AND m.deleted_at IS NULL AND m.attendance_status='yes' AND g.response_status='yes' AND g.deleted_at IS NULL AND e.status='active' AND e.archived_at IS NULL AND e.checkin_mode='individual'",code).first();
 return person?{...person,subject:'person:'+person.member_id}:null;
}
async function findManual(env,event,b){
 const g=await q(env,"SELECT * FROM guests WHERE id=? AND event_id=? AND deleted_at IS NULL AND response_status='yes'",b.guest_id||'',event.id).first();
 if(!g)return null;
 await assignQr(env,event,g);
 const row=event.checkin_mode==='family'
  ?await q(env,'SELECT qr_token code FROM guests WHERE id=?',g.id).first()
  :await q(env,"SELECT qr_token code FROM guest_members WHERE id=? AND guest_id=? AND deleted_at IS NULL AND attendance_status='yes'",b.member_id||'',g.id).first();
 return row?.code||null;
}
async function checkin(env,event,b,source){
 if(!eventActive(event))return j({error:'Check-in desativado.'},403);
 const code=b.token||await findManual(env,event,b);
 const qr=await inspect(env,code);
 if(!qr||qr.event_id!==event.id)return j({error:'QR inválido, revogado ou de outro evento.'},403);
 const added=await q(env,"INSERT OR IGNORE INTO event_checkins(id,event_id,guest_id,member_id,subject_key,created_at,source) SELECT ?,e.id,g.id,?,?,?,? FROM events e JOIN guests g ON g.event_id=e.id WHERE e.id=? AND e.status='active' AND e.archived_at IS NULL AND g.id=? AND g.response_status='yes' AND g.deleted_at IS NULL AND ((e.checkin_mode='family' AND g.qr_token=?) OR (e.checkin_mode='individual' AND EXISTS(SELECT 1 FROM guest_members m WHERE m.id=? AND m.guest_id=g.id AND m.qr_token=? AND m.attendance_status='yes' AND m.deleted_at IS NULL)))",crypto.randomUUID(),qr.member_id,qr.subject,stamp(),source,event.id,qr.guest_id,code,qr.member_id,code).run();
 const saved=await q(env,"SELECT * FROM event_checkins WHERE subject_key=?",qr.subject).first();
 if(!saved)return j({error:'A presença foi revogada antes do check-in.'},409);
 return j({ok:true,already_checked_in:!added.meta.changes,name:qr.name,checkin:saved});
}
async function report(env,event){
 const [guests,checkins,queue]=await Promise.all([
  q(env,"SELECT id,primary_name,group_label,response_status FROM guests WHERE event_id=? AND deleted_at IS NULL ORDER BY primary_name",event.id).all(),
  q(env,"SELECT c.*,COALESCE(m.name,g.primary_name) name FROM event_checkins c JOIN guests g ON g.id=c.guest_id LEFT JOIN guest_members m ON m.id=c.member_id WHERE c.event_id=? ORDER BY c.created_at DESC LIMIT 1000",event.id).all(),
  q(env,"SELECT id,display_name,people_count,status FROM waitlist_entries WHERE event_id=? AND status='waiting' ORDER BY created_at",event.id).all()
 ]);
 const members=(await q(env,"SELECT m.id,m.name,m.guest_id,m.person_type FROM guest_members m JOIN guests g ON g.id=m.guest_id WHERE m.event_id=? AND m.deleted_at IS NULL AND m.attendance_status='yes' AND g.response_status='yes' AND g.deleted_at IS NULL ORDER BY m.name",event.id).all()).results;
 return {event:{id:event.id,title:event.title,checkin_mode:event.checkin_mode},guests:guests.results,members,checkins:checkins.results,waitlist:queue.results};
}
async function reception(env,token){
 const access=await q(env,"SELECT * FROM reception_access WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?",await digest(token),stamp()).first();
 if(!access)return null;
 const event=await q(env,"SELECT * FROM events WHERE id=?",access.event_id).first();
 return eventActive(event)?event:null;
}
export async function qrRoutes(request,env,url,api){
 const path=url.pathname,method=request.method;
 if(!/^\/api\/(admin\/events\/[^/]+\/(qr-list|checkin|reception)|recepcao\/|q\/|qr-svg\/)/.test(path))return null;
 try{
  if(method!=='GET'&&request.headers.get('origin')!==url.origin)return j({error:'Origem não autorizada.'},403);
  const a=path.match(/^\/api\/admin\/events\/([^/]+)\/(qr-list|checkin|reception)(?:\/([^/]+)\/revoke)?$/);
  if(a){
   if(!await api.isAdmin(request,env))return j({error:'Não autorizado.'},401);
   const event=await api.getEvent(env,a[1]);if(!event)return j({error:'Evento não encontrado.'},404);
   if(a[2]==='qr-list'&&method==='GET'){
    if(!eventActive(event))return j({error:'Ative o check-in nas regras do evento.'},409);
    const guests=(await q(env,"SELECT * FROM guests WHERE event_id=? AND response_status='yes' AND deleted_at IS NULL",event.id).all()).results;
    const groups=[];for(const g of guests)groups.push({name:g.group_label||g.primary_name,guest_id:g.id,qr:await assignQr(env,event,g)});
    return j({groups});
   }
   if(a[2]==='checkin'){
    if(method==='GET')return j(await report(env,event));
    if(method==='POST')return checkin(env,event,await data(request),'admin');
   }
   if(a[2]==='reception'){
    if(method==='GET'){
     const r=await q(env,"SELECT id,label,created_at,expires_at,revoked_at FROM reception_access WHERE event_id=? ORDER BY created_at DESC",event.id).all();
     return j({access:r.results});
    }
    if(method==='POST'&&a[3]){
     await q(env,"UPDATE reception_access SET revoked_at=? WHERE id=? AND event_id=?",stamp(),a[3],event.id).run();
     return j({ok:true});
    }
    if(method==='POST'){
     if(!eventActive(event))return j({error:'Ative o check-in antes de criar um acesso.'},409);
     const b=await data(request),days=Math.max(1,Math.min(30,Math.floor(Number(b.days)||2))),token=raw();
     const accessId=crypto.randomUUID(),expires=new Date(Date.now()+days*86400000).toISOString();
     await q(env,"INSERT INTO reception_access(id,event_id,token_hash,label,created_at,expires_at) VALUES(?,?,?,?,?,?)",accessId,event.id,await digest(token),String(b.label||'Recepção').trim().slice(0,80),stamp(),expires).run();
     return j({url:url.origin+'/recepcao/'+token,expires_at:expires,id:accessId});
    }
   }
  }
  const rec=path.match(/^\/api\/recepcao\/([^/]+)(?:\/checkin)?$/);
  if(rec){
   const event=await reception(env,rec[1]);if(!event)return j({error:'Acesso inválido, revogado ou vencido.'},403);
   if(method==='GET'&&!path.endsWith('/checkin'))return j(await report(env,event));
   if(method==='POST'&&path.endsWith('/checkin'))return checkin(env,event,await data(request),'reception');
  }
  const qr=path.match(/^\/api\/(q|qr-svg)\/([^/]+)$/);
  if(qr&&method==='GET'){
   const info=await inspect(env,qr[2]);if(!info)return j({error:'QR inválido ou revogado.'},404);
   if(qr[1]==='q'){
    const seen=await q(env,'SELECT created_at FROM event_checkins WHERE subject_key=?',info.subject).first();
    return j({name:info.name,event_title:info.title,group_label:info.group_label,checked_in:!!seen,checked_in_at:seen?.created_at||null});
   }
   const svg=await QRCode.toString(url.origin+'/qr/'+qr[2],{type:'svg',width:320,margin:2,errorCorrectionLevel:'M'});
   return new Response(svg,{headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  }
  return j({error:'Rota inexistente.'},404);
 }catch(e){
  console.error('qr_route_failed',e?.name);
  return j({error:'Não foi possível validar o QR ou realizar o check-in.'},400);
 }
}