import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {parseDelimited,groupRows} from '../public/import-wizard.js';
import {capacityCheck,queueWaitlist,guestExtraRoutes} from '../src/guest-extras.js';

function fixture(){
 const db=new DatabaseSync(':memory:');
 return {db,async init(){
  for(const file of ['0001_init.sql','0002_v1.sql','0003_v2.sql','0004_guest_type_limits.sql','0005_import_passkeys_checkin.sql'])
   db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 },env:{DB:{
  prepare(sql){return {bind(...args){const statement=db.prepare(sql);return {
   first:async()=>statement.get(...args)||null,
   all:async()=>({results:statement.all(...args)}),
   run:async()=>({meta:{changes:statement.run(...args).changes}})
  };}}},
  async batch(queries){db.exec('BEGIN');try{const results=[];for(const q of queries)results.push(await q.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}
 }}};
}
const now='2026-10-09T12:00:00.000Z';
function seedEvent(db,{id='e1',capacity=2,mode='list',waitlist=1}={}){
 db.prepare("INSERT INTO events(id,title,slug,rsvp_mode,status,created_at,updated_at,max_capacity,waitlist_enabled,checkin_mode) VALUES(?,?,?,?,'active',?,?,?,?,?)")
 .run(id,'Teste '+id,id,mode,now,now,capacity,waitlist,'family');
}
function addGuest(db,{id='g1',eventId='e1',name='Maria',status='pending',memberStatus='pending'}={}){
 const norm=name.toLowerCase();
 db.prepare("INSERT INTO guests(id,event_id,primary_name,normalized_name,response_status,created_at,updated_at,source) VALUES(?,?,?,?,?,?,?,'admin')")
 .run(id,eventId,name,norm,status,now,now);
 db.prepare("INSERT INTO guest_members(id,guest_id,event_id,name,normalized_name,person_type,is_primary,sort_order,created_at,updated_at,attendance_status,is_preapproved) VALUES(?,?,?,?,?,'adult',1,0,?,?,?,1)")
 .run('m'+id,id,eventId,name,norm,now,now,memberStatus);
}
test('CSV reconhece aspas, ponto e vírgula e agrupamento explícito',()=>{
 const rows=parseDelimited('Família;Nome;Tipo\nSilva;"Ana, Maria";adulto\nSilva;João;criança\n');
 assert.deepEqual(rows[1],['Silva','Ana, Maria','adulto']);
 const groups=groupRows(rows);
 assert.equal(groups.length,1);
 assert.equal(groups[0].members[0].name,'Ana, Maria');
 assert.equal(groups[0].members[1].person_type,'child');
});
test('nomes sem classificação não são tratados como crianças ou adultos arbitrariamente',()=>{
 const groups=groupRows([['Nome'],['Ana'],['Pedro']]);
 assert.equal(groups.length,2);
 assert(groups.every(g=>g.members.every(m=>m.person_type==='unknown')));
});
test('migrações completas não alteram o padrão sem QR e sem capacidade',async()=>{
 const {db,init}=fixture();await init();
 seedEvent(db,{capacity:null});
 const event=db.prepare("SELECT * FROM events WHERE id='e1'").get();
 assert.equal(event.checkin_mode,'family');
 assert.equal(event.max_capacity,null);
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
 for(const name of ['admin_passkeys','passkey_challenges','import_batches','import_batch_items','waitlist_entries','reception_access','event_checkins'])
  assert(tables.includes(name));
});
test('capacidade é validada no banco inclusive em corrida de gravações',async()=>{
 const {db,env,init}=fixture();await init();
 seedEvent(db);addGuest(db,{status:'yes',memberStatus:'yes'});
 addGuest(db,{id:'g2',name:'João',status:'yes',memberStatus:'yes'});
 const event=db.prepare("SELECT * FROM events WHERE id='e1'").get();
 assert.equal(await capacityCheck(env,event,{guest_id:'g2',member_responses:[{id:'mg2',attendance_status:'yes'}]}),false);
 addGuest(db,{id:'g3',name:'Pedro',status:'pending',memberStatus:'pending'});
 assert.equal(await capacityCheck(env,event,{guest_id:'g3',member_responses:[{id:'mg3',attendance_status:'yes'}]}),true);
 assert.throws(()=>db.prepare("UPDATE guest_members SET attendance_status='yes' WHERE id='mg3'").run(),/CAPACITY_FULL/);
 assert.throws(()=>db.prepare("UPDATE events SET max_capacity=1 WHERE id='e1'").run(),/CAPACITY_BELOW_CONFIRMED/);
});
test('lista de espera é idempotente e não conta como presença confirmada',async()=>{
 const {db,env,init}=fixture();await init();seedEvent(db);addGuest(db);
 const event=db.prepare("SELECT * FROM events WHERE id='e1'").get();
 const body={guest_id:'g1',member_responses:[{id:'mg1',attendance_status:'yes'}]};
 const first=await queueWaitlist(env,event,body);
 assert.equal(first.status,202);
 await queueWaitlist(env,event,body);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM waitlist_entries").get().n,1);
 assert.equal(db.prepare("SELECT response_status FROM guests WHERE id='g1'").get().response_status,'pending');
});
test('undo remove só grupos da importação que nunca foram confirmados ou editados',async()=>{
 const {db,env,init}=fixture();await init();seedEvent(db);
 const origin='https://rsvp.example.com',base=origin+'/api/admin/events/e1';
 const helpers={isAdmin:async()=>true,getEvent:async(_env,id)=>db.prepare('SELECT * FROM events WHERE id=?').get(id),bulkCreateGuests:async(_env,event,rows)=>{
  const created=[];
  for(const [i,r] of rows.entries()){const id='new'+i;addGuest(db,{id,eventId:event.id,name:r.primary_name});created.push({id,primary_name:r.primary_name});}
  return {created,failed:[]};
 }};
 const req=new Request(base+'/import',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({
  rows:[{primary_name:'Clara',members:[{name:'Clara',person_type:'adult'}]},{primary_name:'Hugo',members:[{name:'Hugo',person_type:'adult'}]}],file_name:'lista.csv',source_type:'csv'
 })});
 const result=await guestExtraRoutes(req,env,new URL(req.url),helpers);
 assert.equal(result.status,200);
 const body=await result.json();assert.equal(body.created.length,2);
 db.prepare("UPDATE guests SET updated_at=? WHERE id='new1'").run('2026-10-10T00:00:00.000Z');
 const undoReq=new Request(base+'/imports/'+body.batch_id+'/undo',{method:'POST',headers:{origin},body:'{}'});
 const undone=await guestExtraRoutes(undoReq,env,new URL(undoReq.url),helpers);
 assert.equal(undone.status,200);
 const out=await undone.json();assert.equal(out.undone,1);assert.equal(out.remaining,1);
 assert(db.prepare("SELECT deleted_at FROM guests WHERE id='new0'").get().deleted_at);
 assert.equal(db.prepare("SELECT deleted_at FROM guests WHERE id='new1'").get().deleted_at,null);
});
test('PDF textual mantém famílias declaradas e não interpreta título como coluna',()=>{
 const groups=groupRows([['Lista de convidados'],['Família Silva'],['Ana Silva'],['Beto Silva (criança)'],[],['Família Rocha'],['Carlos Rocha']]);
 assert.equal(groups.length,2);
 assert.equal(groups[0].group_label,'Família Silva');
 assert.equal(groups[0].members.length,2);
 assert.equal(groups[0].members[1].person_type,'child');
 assert.equal(groups[0].members[1].name,'Beto Silva');
 assert.equal(groups[1].group_label,'Família Rocha');
});
