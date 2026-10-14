import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
import {normalizeChildAge,childrenAgeBands} from '../src/child-age.js';

const origin='https://rsvp.example.test';
async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_init.sql','0002_v1.sql','0003_v2.sql','0004_guest_type_limits.sql','0005_import_passkeys_checkin.sql','0006_live_scanner_retention.sql','0007_child_ages.sql'])
  db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const binding={
  prepare(sql){const statement=db.prepare(sql),bound=args=>({
   first:async()=>statement.get(...args)||null,
   all:async()=>({results:statement.all(...args)}),
   run:async()=>/^\\s*SELECT\\b/i.test(sql)?{results:statement.all(...args)}:{meta:{changes:statement.run(...args).changes}},
  });return {...bound([]),bind(...args){return bound(args)}};},
  async batch(statements){db.exec('BEGIN');try{const r=[];for(const statement of statements)r.push(await statement.run());db.exec('COMMIT');return r}catch(error){db.exec('ROLLBACK');throw error}}
 };
 const env={DB:binding,ADMIN_PASSWORD:'fixture-password',SESSION_SECRET:'fixture-secret-not-used-in-production'};
 const send=async(path,{method='GET',body,cookie}={})=>worker.fetch(new Request(origin+path,{method,
  headers:{...(method==='GET'?{}:{origin,'content-type':'application/json'}),...(cookie?{cookie}:{})},
  ...(method==='GET'?{}:{body:JSON.stringify(body||{})})}),env);
 const stamp='2026-10-14T10:00:00.000Z';
 const event=(id,mode,ageEnabled=true,listBehavior='flexible')=>db.prepare(
  "INSERT INTO events(id,title,slug,rsvp_mode,list_behavior,extra_fields,status,created_at,updated_at) VALUES(?,?,?,?,? ,?,'active',?,?)"
 ).run(id,'Teste '+id,'teste-'+id,mode,listBehavior,JSON.stringify({child_age:ageEnabled}),stamp,stamp);
 const login=await send('/api/admin/login',{method:'POST',body:{password:'fixture-password'}});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 return {db,send,event,cookie};
}
test('idade é por criança, 0 representa bebê, idade desconhecida não é inventada',()=>{
 assert.equal(normalizeChildAge('0'),0);
 assert.equal(normalizeChildAge('17'),17);
 assert.equal(normalizeChildAge('','child'),null);
 assert.equal(normalizeChildAge('5','adult'),null);
 assert.ok(Number.isNaN(normalizeChildAge('18')));
 assert.ok(Number.isNaN(normalizeChildAge('1.5')));
 assert.deepEqual(childrenAgeBands([0,2,3,5,6,9,10,12,13,17,null]),{'0-2':2,'3-5':2,'6-9':2,'10-12':2,'13-17':2,unknown:1});
});
test('lista fechada flexível: idade obrigatória na confirmação, faixa e CSV mostram dado exato',async()=>{
 const x=await fixture();x.event('e1','list',true);
 const added=await x.send('/api/admin/events/e1/guests',{method:'POST',cookie:x.cookie,body:{
  primary_name:'Lorena',group_label:'Família Lorena',max_adults_allowed:2,max_children_allowed:1,
  members:[{name:'Lorena',person_type:'adult',attendance_status:'pending'},{name:'Lia',person_type:'child',attendance_status:'pending'}]
 }});
 assert.equal(added.status,200);const created=(await added.json()).guest;
 assert.equal(created.max_children_allowed,1);
 const request={guest_id:created.id,member_responses:created.members.map(m=>({id:m.id,attendance_status:'yes'}))};
 const missing=await x.send('/api/public/events/teste-e1/rsvp',{method:'POST',body:request});
 assert.equal(missing.status,400);
 const persisted=await x.send('/api/public/events/teste-e1/rsvp',{method:'POST',body:{
  ...request,member_responses:created.members.map(m=>({id:m.id,attendance_status:'yes',...(m.person_type==='child'?{child_age:'0'}:{})}))
 }});
 assert.equal(persisted.status,200);
 assert.equal(x.db.prepare("SELECT child_age FROM guest_members WHERE name='Lia'").get().child_age,0);
 const summary=await x.send('/api/admin/events/e1',{cookie:x.cookie});
 assert.equal(summary.status,200);const data=await summary.json();
 assert.equal(data.summary.children_confirmed,1);
 assert.equal(data.summary.child_age_bands['0-2'],1);
 assert.equal(data.summary.child_age_bands.unknown,0);
 const csv=await x.send('/api/admin/events/e1/export.csv',{cookie:x.cookie});
 assert.equal(csv.status,200);
 assert.match(await csv.text(),/Lia - 0 anos/);
});
test('modo livre pergunta idade apenas quando opção está ativada',async()=>{
 const x=await fixture();x.event('free1','free',true);
 const body={primary_name:'Ana',response_status:'yes',members:[
  {name:'Ana',person_type:'adult',attendance_status:'yes'},
  {name:'Bia',person_type:'child',attendance_status:'yes'}
 ]};
 const missing=await x.send('/api/public/events/teste-free1/rsvp',{method:'POST',body});
 assert.equal(missing.status,400);
 body.members[1].child_age='5';
 const ok=await x.send('/api/public/events/teste-free1/rsvp',{method:'POST',body});
 assert.equal(ok.status,200);
 assert.equal(x.db.prepare("SELECT child_age FROM guest_members WHERE name='Bia'").get().child_age,5);
 x.event('free2','free',false);
 const noAge=await x.send('/api/public/events/teste-free2/rsvp',{method:'POST',body:{
  ...body,primary_name:'Clara',members:[{name:'Clara',person_type:'adult'},{name:'Duda',person_type:'child'}]
 }});
 assert.equal(noAge.status,200);
});
