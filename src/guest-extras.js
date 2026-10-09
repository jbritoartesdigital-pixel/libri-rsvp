const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const query=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const stamp=()=>new Date().toISOString();
const short=s=>String(s??'').trim().slice(0,150);
const normalized=s=>short(s).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const parse=async req=>{const raw=await req.text();if(raw.length>130000)throw Error('Dados muito grandes.');return JSON.parse(raw);};
const occupied=async(env,eventId,excludeId=null)=>{
 const r=await query(env,"SELECT COUNT(*) n FROM guest_members m JOIN guests g ON g.id=m.guest_id WHERE m.event_id=? AND m.deleted_at IS NULL AND g.deleted_at IS NULL AND m.attendance_status='yes' AND (? IS NULL OR m.guest_id<>?)",eventId,excludeId,excludeId).first();return Number(r.n||0);
};
export async function capacityCheck(env,event,body){
 if(!event.max_capacity)return false;
 let exclude=null,requested=0;
 if(event.rsvp_mode==='list'){
  exclude=String(body.guest_id||'');
  const current=(await query(env,"SELECT id,attendance_status FROM guest_members WHERE event_id=? AND guest_id=? AND deleted_at IS NULL",event.id,exclude).all()).results;
  const map=new Map((body.member_responses||[]).filter(Boolean).map(m=>[String(m.id),m.attendance_status]));
  const removed=new Set((body.remove_member_ids||[]).map(String));
  requested=current.filter(m=>!removed.has(m.id)&&(map.get(m.id)||body.response_status||m.attendance_status)==='yes').length+
   (body.new_members||[]).filter(m=>m.attendance_status==='yes').length;
 }else{
  if(body.response_status!=='yes')return false;
  const g=await query(env,"SELECT id FROM guests WHERE event_id=? AND normalized_name=? AND deleted_at IS NULL ORDER BY created_at LIMIT 1",event.id,normalized(body.primary_name)).first();
  exclude=g?.id||null;
  requested=(body.members||[]).filter(m=>m.attendance_status==='yes').length;
 }
 return requested>0&&(await occupied(env,event.id,exclude))+requested>Number(event.max_capacity);
}
export async function queueWaitlist(env,event,body){
 if(!event.waitlist_enabled)return json({error:'A festa atingiu a capacidade máxima.'},409);
 const members=event.rsvp_mode==='list'?
 (body.member_responses||[]).filter(m=>m.attendance_status==='yes').length+(body.new_members||[]).filter(m=>m.attendance_status==='yes').length:
 (body.members||[]).filter(m=>m.attendance_status==='yes').length;
 if(!members)return json({error:'Não há convidados selecionados para a lista de espera.'},400);
 const primary=event.rsvp_mode==='list'?
 (await query(env,"SELECT COALESCE(group_label,primary_name) name FROM guests WHERE event_id=? AND id=?",event.id,body.guest_id||'').first())?.name:
 short(body.primary_name);
 if(!primary)return json({error:'Convidado inválido.'},400);
 const packed=JSON.stringify(body);if(packed.length>10000)return json({error:'Dados muito extensos.'},413);
 const existing=await query(env,"SELECT id FROM waitlist_entries WHERE event_id=? AND display_name=? AND status='waiting' LIMIT 1",event.id,primary).first();
 if(existing)return json({ok:true,waitlisted:true,message:'Esta família já está na lista de espera.'},202);
 await query(env,"INSERT INTO waitlist_entries(id,event_id,guest_id,request_json,display_name,people_count,created_at) VALUES(?,?,?,?,?,?,?)",
 crypto.randomUUID(),event.id,body.guest_id||null,packed,primary,members,stamp()).run();
 return json({ok:true,waitlisted:true,message:'Você entrou na lista de espera. Sua presença ainda NÃO está confirmada.'},202);
}
export async function guestExtraRoutes(request,env,url,api){
 const path=url.pathname,method=request.method;
 if(!/^\/api\/(admin\/events\/[^/]+\/(features|import|imports|waitlist)|client\/[^/]+\/(import|imports))/.test(path))return null;
 try {
  if(method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'Origem inválida.'},403);
  const m=path.match(/^\/api\/(admin\/events\/([^/]+)|client\/([^/]+))\/(import|imports)(?:\/([^/]+)\/undo)?$/);
  if(m){
   let event;
   if(m[2]){
    if(!await api.isAdmin(request,env))return json({error:'Não autorizado.'},401);
    event=await api.getEvent(env,decodeURIComponent(m[2]));
   }else{
    event=await api.getEventByClientToken(env,decodeURIComponent(m[3]));
    if(event&&JSON.parse(event.client_permissions||'{}').manage_guests===false)return json({error:'Sem permissão para importar.'},403);
   }
   if(!event)return json({error:'Evento indisponível.'},404);
   if(method==='GET'&&m[4]==='imports'){
    const r=await query(env,"SELECT * FROM import_batches WHERE event_id=? ORDER BY created_at DESC LIMIT 20",event.id).all();
    return json({imports:r.results});
   }
   if(method==='POST'&&m[4]==='import'){
    const b=await parse(request);
    if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>300)return json({error:'Selecione entre 1 e 300 famílias.'},400);
    const incoming=b.rows.map(row=>({
     ...row,creation_request_id:row.creation_request_id||'imp_'+crypto.randomUUID(),
     response_status:'pending',
     members:(row.members||[]).map(m=>({...m,attendance_status:'pending',is_preapproved:true}))
    }));
    if(incoming.some(r=>!short(r.primary_name)||!r.members?.length||r.members.some(m=>!short(m.name)||!['adult','child'].includes(m.person_type))))
     return json({error:'Revise os nomes e a classificação de cada família.'},400);
    const old=(await query(env,"SELECT m.normalized_name FROM guest_members m JOIN guests g ON g.id=m.guest_id WHERE m.event_id=? AND m.deleted_at IS NULL AND g.deleted_at IS NULL",event.id).all()).results;
    const seen=new Set(old.map(x=>x.normalized_name));const accepted=[],failed=[];
    incoming.forEach((r,index)=>{
     const all=r.members.map(m=>normalized(m.name));
     if(all.some(n=>seen.has(n))||new Set(all).size!==all.length){failed.push({index,name:r.primary_name,error:'Nome duplicado ou já cadastrado.'});return;}
     all.forEach(n=>seen.add(n));accepted.push(r);
    });
    if(!accepted.length)return json({created:[],failed,batch_id:null});
    const saved=await api.bulkCreateGuests(env,event,accepted,'import'),created=saved.created||[];
    const batchId=crypto.randomUUID();
    if(created.length)await env.DB.batch([
     query(env,"INSERT INTO import_batches(id,event_id,file_name,source_type,created_at) VALUES(?,?,?,?,?)",batchId,event.id,short(b.file_name)||'Lista importada',short(b.source_type)||'arquivo',stamp()),
     ...created.map(g=>query(env,"INSERT INTO import_batch_items(batch_id,guest_id) VALUES(?,?)",batchId,g.id))
    ]);
    return json({created:created.map(g=>({id:g.id,primary_name:g.primary_name})),failed:[...failed,...(saved.failed||[])],batch_id:created.length?batchId:null});
   }
   if(method==='POST'&&m[4]==='imports'&&m[5]){
    const batch=await query(env,"SELECT * FROM import_batches WHERE id=? AND event_id=?",m[5],event.id).first();
    if(!batch)return json({error:'Importação não encontrada.'},404);
    const r=await query(env,"SELECT g.id FROM guests g JOIN import_batch_items i ON i.guest_id=g.id WHERE i.batch_id=? AND g.event_id=? AND g.deleted_at IS NULL AND g.response_status='pending' AND g.updated_at=g.created_at AND NOT EXISTS(SELECT 1 FROM guest_members m WHERE m.guest_id=g.id AND m.attendance_status<>'pending')",batch.id,event.id).all();
    const timestamp=stamp();
    for(const g of r.results)await query(env,"UPDATE guests SET deleted_at=?,updated_at=? WHERE id=? AND event_id=? AND response_status='pending' AND updated_at=created_at",timestamp,timestamp,g.id,event.id).run();
    const count=await query(env,"SELECT COUNT(*) n FROM guests g JOIN import_batch_items i ON i.guest_id=g.id WHERE i.batch_id=? AND g.deleted_at IS NULL",batch.id).first();
    if(!count.n)await query(env,'UPDATE import_batches SET undone_at=COALESCE(undone_at,?) WHERE id=?',stamp(),batch.id).run();
    return json({ok:true,undone:r.results.length,remaining:Number(count.n)});
   }
  }
  const a=path.match(/^\/api\/admin\/events\/([^/]+)\/(features|waitlist)(?:\/([^/]+)\/(promote|cancel))?$/);
  if(a){
   if(!await api.isAdmin(request,env))return json({error:'Não autorizado.'},401);
   const event=await api.getEvent(env,a[1]);if(!event)return json({error:'Evento não encontrado.'},404);
   if(a[2]==='features'){
    if(method==='GET')return json({settings:{max_capacity:event.max_capacity,waitlist_enabled:!!event.waitlist_enabled,checkin_mode:event.checkin_mode},occupied:await occupied(env,event.id)});
    if(method==='PATCH'){
     const b=await parse(request),cap=b.max_capacity===null||b.max_capacity===''?null:Number(b.max_capacity);
     if(cap!==null&&(!Number.isInteger(cap)||cap<1||cap>100000))return json({error:'Capacidade inválida.'},400);
     if(!['off','family','individual'].includes(b.checkin_mode))return json({error:'Modo QR inválido.'},400);
     await query(env,"UPDATE events SET max_capacity=?,waitlist_enabled=?,checkin_mode=?,updated_at=? WHERE id=?",cap,b.waitlist_enabled?1:0,b.checkin_mode,stamp(),event.id).run();
     return json({ok:true});
    }
   }
   if(a[2]==='waitlist'){
    if(method==='GET'){
     const r=await query(env,"SELECT id,guest_id,display_name,people_count,created_at,status FROM waitlist_entries WHERE event_id=? ORDER BY created_at DESC",event.id).all();
     return json({waitlist:r.results});
    }
    if(method==='POST'&&a[3]){
     const w=await query(env,"SELECT * FROM waitlist_entries WHERE id=? AND event_id=? AND status='waiting'",a[3],event.id).first();
     if(!w)return json({error:'Solicitação indisponível.'},404);
     if(a[4]==='cancel'){
      await query(env,"UPDATE waitlist_entries SET status='cancelled' WHERE id=?",w.id).run();
      return json({ok:true});
     }
     if(a[4]==='promote'){
      const b=JSON.parse(w.request_json);
      if(await capacityCheck(env,event,b))return json({error:'Ainda não há vagas suficientes.'},409);
      try{
       const guest=event.rsvp_mode==='list'?await api.submitListRsvp(env,event,b):await api.submitFreeRsvp(env,event,b);
       if(api.assignQr)await api.assignQr(env,event,guest);
       await query(env,"UPDATE waitlist_entries SET status='promoted',promoted_at=? WHERE id=?",stamp(),w.id).run();
       return json({ok:true,guest_id:guest.id});
      }catch(e){if(String(e.message).includes('CAPACITY_FULL'))return json({error:'Capacidade esgotada.'},409);throw e;}
     }
    }
   }
  }
  return json({error:'Rota não encontrada.'},404);
 }catch(e){
  console.error('guest_extra_failed',e?.name);
  if(String(e.message).includes('CAPACITY_'))return json({error:'Capacidade inferior às presenças confirmadas.'},409);
  return json({error:'Não foi possível concluir. Revise os dados.'},400);
 }
}