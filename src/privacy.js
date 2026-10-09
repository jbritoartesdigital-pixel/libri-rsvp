const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const stmt=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const eventCounts=async(env,eventId)=>{
 const tables=['guests','guest_members','event_checkins','waitlist_entries','import_batches','reception_access','audit_logs'];
 const result={};
 for(const table of tables){
  const row=await stmt(env,'SELECT COUNT(*) n FROM '+table+' WHERE event_id=?',eventId).first();
  result[table]=Number(row?.n||0);
 }
 return result;
};
export function retentionEligibility(event,clock=new Date()){
 if(!event.event_date||!/^\d{4}-\d\d-\d\d$/.test(event.event_date))return {eligible:false,reason:'A festa precisa de uma data válida.'};
 const days=event.retention_days==null?1:Number(event.retention_days);
 const due=new Date(event.event_date+'T00:00:00.000Z');
 if(!Number.isFinite(due.getTime()))return {eligible:false,reason:'Data inválida.'};
 due.setUTCDate(due.getUTCDate()+days);
 const dueDate=due.toISOString().slice(0,10);
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(clock);
 const get=key=>parts.find(x=>x.type===key)?.value;
 const today=get('year')+'-'+get('month')+'-'+get('day');
 if(today<dueDate)return {eligible:false,due_date:dueDate,reason:'Aguarde o prazo escolhido após o evento.'};
 if(event.status==='active'&&!event.archived_at)return {eligible:false,due_date:dueDate,reason:'Pause ou arquive o evento antes de eliminar os dados.'};
 if(event.guest_data_purged_at)return {eligible:false,due_date:dueDate,reason:'Os dados deste evento já foram eliminados.'};
 return {eligible:true,due_date:dueDate};
}
export async function privacyRoutes(request,env,url,api){
 const match=url.pathname.match(/^\/api\/admin\/events\/([^/]+)\/privacy(?:\/(cleanup|settings))?$/);
 if(!match)return null;
 try{
  if(!await api.isAdmin(request,env))return response({error:'Entre na área administrativa.'},401);
  const event=await api.getEvent(env,decodeURIComponent(match[1]));
  if(!event)return response({error:'Evento não encontrado.'},404);
  const method=request.method;
  if(method!=='GET'&&request.headers.get('origin')!==url.origin)return response({error:'Origem não autorizada.'},403);
  if(method==='GET'&&!match[2])return response({event:{title:event.title,slug:event.slug,event_date:event.event_date,status:event.status,retention_days:event.retention_days,purged_at:event.guest_data_purged_at},...retentionEligibility(event),counts:await eventCounts(env,event.id)});
  if(method==='PATCH'&&match[2]==='settings'){
   const b=await request.json(),days=b.retention_days==null||b.retention_days===''?null:Number(b.retention_days);
   if(days!==null&&(!Number.isInteger(days)||days<1||days>3650))return response({error:'Informe um prazo de 1 a 3650 dias.'},400);
   await stmt(env,'UPDATE events SET retention_days=?,updated_at=? WHERE id=?',days,new Date().toISOString(),event.id).run();
   await api.audit?.(env,{eventId:event.id,actorRole:'admin',action:'retention_policy_updated',details:{retention_days:days}});
   return response({ok:true});
  }
  if(method==='POST'&&match[2]==='cleanup'){
   const b=await request.json();
   if(b.confirm_slug!==event.slug||b.confirm_text!=='EXCLUIR DADOS')return response({error:'Confirmação incorreta. Nada foi apagado.'},400);
   const eligible=retentionEligibility(event);
   if(!eligible.eligible)return response({error:eligible.reason},409);
   const counts=await eventCounts(env,event.id),now=new Date().toISOString();
   await env.DB.batch([
    stmt(env,'DELETE FROM checkin_reversals WHERE event_id=?',event.id),
    stmt(env,'DELETE FROM event_checkins WHERE event_id=?',event.id),
    stmt(env,'DELETE FROM waitlist_entries WHERE event_id=?',event.id),
    stmt(env,'DELETE FROM reception_access WHERE event_id=?',event.id),
    stmt(env,'DELETE FROM import_batch_items WHERE batch_id IN (SELECT id FROM import_batches WHERE event_id=?)',event.id),
    stmt(env,'DELETE FROM import_batches WHERE event_id=?',event.id),
    stmt(env,'DELETE FROM guest_members WHERE event_id=?',event.id),
    stmt(env,'DELETE FROM guests WHERE event_id=?',event.id),
    stmt(env,'DELETE FROM audit_logs WHERE event_id=?',event.id),
    stmt(env,"UPDATE events SET status='inactive',archived_at=COALESCE(archived_at,?),guest_data_purged_at=?,updated_at=? WHERE id=? AND guest_data_purged_at IS NULL",now,now,now,event.id)
   ]);
   // Deliberately retain event metadata and R2 event designs; remove PII only.
   await api.audit?.(env,{eventId:event.id,actorRole:'admin',action:'guest_data_purged',details:{counts,at:now}});
   return response({ok:true,counts,deleted_at:now});
  }
  return response({error:'Rota não encontrada.'},404);
 }catch(error){
  console.error('privacy_action_failed',error?.name);
  return response({error:'Não foi possível aplicar a política de privacidade.'},400);
 }
}
