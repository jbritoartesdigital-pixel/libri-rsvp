import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {qrRoutes,assignQr} from '../src/checkin.js';
import {passkeyRoutes} from '../src/passkeys.js';

async function makeDB(){
 const db=new DatabaseSync(':memory:');
 for(const filename of ['0001_init.sql','0002_v1.sql','0003_v2.sql','0004_guest_type_limits.sql','0005_import_passkeys_checkin.sql'])
  db.exec(await readFile(new URL('../migrations/'+filename,import.meta.url),'utf8'));
 const env={DB:{
  prepare(sql){return {bind(...args){const statement=db.prepare(sql);return {
   first:async()=>statement.get(...args)||null,
   all:async()=>({results:statement.all(...args)}),
   run:async()=>({meta:{changes:statement.run(...args).changes}})
  };}}}
 }};
 const timestamp='2026-10-09T18:00:00.000Z';
 const addEvent=(id='e1',mode='family')=>db.prepare("INSERT INTO events(id,title,slug,rsvp_mode,status,created_at,updated_at,checkin_mode) VALUES(?,?,?,'list','active',?,?,?)").run(id,'Evento '+id,id,timestamp,timestamp,mode);
 const addFamily=(id='g1',eventId='e1',people=['Maria'])=>{
  db.prepare("INSERT INTO guests(id,event_id,primary_name,normalized_name,response_status,created_at,updated_at,source) VALUES(?,?,?,?,'yes',?,?,'admin')").run(id,eventId,people[0],people[0].toLowerCase(),timestamp,timestamp);
  for(let i=0;i<people.length;i++)db.prepare("INSERT INTO guest_members(id,guest_id,event_id,name,normalized_name,person_type,is_primary,sort_order,created_at,updated_at,attendance_status,is_preapproved) VALUES(?,?,?,?,?,'adult',?,?,?,?,'yes',1)")
   .run('m'+id+i,id,eventId,people[i],people[i].toLowerCase(),i===0?1:0,i,timestamp,timestamp);
 };
 const api={isAdmin:async()=>true,getEvent:async(_env,id)=>db.prepare('SELECT * FROM events WHERE id=?').get(id)};
 const origin='https://libri.example.com';
 const send=async(path,method='GET',body=null)=>{
  const url=new URL(path,origin);
  const request=new Request(url,{method,...(method!=='GET'?{headers:{origin,'content-type':'application/json'},body:JSON.stringify(body||{})}:{})});
  return qrRoutes(request,env,url,api);
 };
 return {db,env,api,addEvent,addFamily,send,origin};
}
test('QR familiar exige presença confirmada, rejeita duplicidade e é revogado depois da recusa',async()=>{
 const x=await makeDB();x.addEvent();x.addFamily();
 const r=await x.send('/api/admin/events/e1/qr-list'),body=await r.json();
 assert.equal(body.groups.length,1);
 const code=body.groups[0].qr[0].url.split('/').pop();
 const qr=await x.send('/api/q/'+code);assert.equal(qr.status,200);
 assert.equal((await qr.json()).checked_in,false);
 const svg=await x.send('/api/qr-svg/'+code);
 assert.equal(svg.status,200);
 assert.match(await svg.text(),/<svg/);
 const first=await x.send('/api/admin/events/e1/checkin','POST',{token:code});
 assert.equal((await first.json()).already_checked_in,false);
 const second=await x.send('/api/admin/events/e1/checkin','POST',{token:code});
 assert.equal((await second.json()).already_checked_in,true);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM event_checkins').get().n,1);
 x.db.prepare("UPDATE guests SET response_status='no' WHERE id='g1'").run();
 assert.equal((await x.send('/api/q/'+code)).status,404);
 assert.equal((await x.send('/api/admin/events/e1/checkin','POST',{token:code})).status,403);
});
test('QR individual registra cada pessoa uma vez e nunca outro evento',async()=>{
 const x=await makeDB();x.addEvent('e1','individual');x.addEvent('e2','individual');
 x.addFamily('g1','e1',['Rita','Caio']);
 const event=x.db.prepare("SELECT * FROM events WHERE id='e1'").get(),guest=x.db.prepare("SELECT * FROM guests WHERE id='g1'").get();
 const result=await assignQr(x.env,event,guest);assert.equal(result.length,2);
 const code=result[0].url.split('/').pop();
 assert.equal((await x.send('/api/admin/events/e2/checkin','POST',{token:code})).status,403);
 assert.equal((await x.send('/api/admin/events/e1/checkin','POST',{token:code})).status,200);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM event_checkins').get().n,1);
});
test('equipe de recepção tem link restrito revogável',async()=>{
 const x=await makeDB();x.addEvent();x.addFamily();
 const created=await x.send('/api/admin/events/e1/reception','POST',{days:2,label:'Recepcionista'});
 assert.equal(created.status,200);
 const access=await created.json(),token=access.url.split('/').pop();
 assert.equal((await x.send('/api/recepcao/'+token)).status,200);
 await x.send('/api/admin/events/e1/reception/'+access.id+'/revoke','POST',{});
 assert.equal((await x.send('/api/recepcao/'+token)).status,403);
});
test('passkey só pode ser registrada após login por senha',async()=>{
 const x=await makeDB();
 const api={isAdmin:async()=>false,createAdminSession:async()=>''};
 const path='/api/admin/passkeys/register/options',url=new URL(path,x.origin);
 const request=new Request(url,{method:'POST',headers:{origin:x.origin},body:'{}'});
 const result=await passkeyRoutes(request,x.env,url,api);
 assert.equal(result.status,401);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM admin_passkeys').get().n,0);
});
test('passkey rejeita requisição de outra origem',async()=>{
 const x=await makeDB();
 const api={isAdmin:async()=>true,createAdminSession:async()=>''};
 const path='/api/admin/passkeys/register/options',url=new URL(path,x.origin);
 const request=new Request(url,{method:'POST',headers:{origin:'https://evil.example'},body:'{}'});
 const result=await passkeyRoutes(request,x.env,url,api);
 assert.equal(result.status,400);
});
