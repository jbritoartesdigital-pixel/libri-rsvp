import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';

async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_init.sql','0002_v1.sql','0003_v2.sql','0004_guest_type_limits.sql','0005_import_passkeys_checkin.sql','0006_live_scanner_retention.sql','0007_child_ages.sql'])
  db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const binding={
  prepare(sql){const statement=db.prepare(sql),bound=args=>({
   first:async()=>statement.get(...args)||null,
   all:async()=>({results:statement.all(...args)}),
   run:async()=>({meta:{changes:statement.run(...args).changes}})
  });return {...bound([]),bind(...args){return bound(args)}},
  async batch(statements){db.exec('BEGIN');try{const output=[];for(const stmt of statements)output.push(await stmt.run());db.exec('COMMIT');return output}catch(err){db.exec('ROLLBACK');throw err}}
 };
 const env={DB:binding,ADMIN_PASSWORD:'fixture-password',SESSION_SECRET:'fixture-secret'};
 const origin='https://rsvp.example.test';
 const send=async(path,{method='GET',body,cookie}={})=>worker.fetch(new Request(origin+path,{
  method,headers:{...(method==='GET'?{}:{origin,'content-type':'application/json'}),...(cookie?{cookie}:{})},
  ...(method==='GET'?{}:{body:JSON.stringify(body||{})})
 }),env);
 const stamp='2026-11-19T15:00:00.000Z';
 const event=(id,multi)=>db.prepare(
  "INSERT INTO events(id,title,slug,rsvp_mode,list_behavior,extra_fields,status,created_at,updated_at) VALUES(?,?,?,'list','strict',?,'active',?,?)"
 ).run(id,'Festa '+id,id,JSON.stringify({multi_guest_confirmation:multi}),stamp,stamp);
 event('individual',false);
 event('multi',false);
 const login=await send('/api/admin/login',{method:'POST',body:{password:'fixture-password'}});
 assert.equal(login.status,200);
 return {db,send,cookie:login.headers.get('set-cookie').split(';')[0]};
}

test('multi-name confirmation is off by default and can be opted into by event only',async()=>{
 const x=await fixture();
 const initial=await x.send('/api/public/events/multi');
 assert.equal(initial.status,200);
 assert.equal((await initial.json()).event.extra_fields.multi_guest_confirmation,false);
 const change=await x.send('/api/admin/events/multi',{method:'PATCH',cookie:x.cookie,
  body:{extra_fields:{multi_guest_confirmation:true,child_age:false,phone:false,love_message:true}}});
 assert.equal(change.status,200);
 const enabled=await x.send('/api/public/events/multi');
 assert.equal((await enabled.json()).event.extra_fields.multi_guest_confirmation,true);
 const other=await x.send('/api/public/events/individual');
 assert.equal((await other.json()).event.extra_fields.multi_guest_confirmation,false);
});

test('three independently registered names remain separate, and each RSVP is counted once',async()=>{
 const x=await fixture();
 for(const guest of [
  {name:'Ana Silva',type:'adult'},
  {name:'Daniel Silva',type:'adult'},
  {name:'Pedro Silva',type:'child'}
 ]){
  const added=await x.send('/api/admin/events/multi/guests',{method:'POST',cookie:x.cookie,body:{
   primary_name:guest.name,group_label:guest.name,members:[{name:guest.name,person_type:guest.type}]
  }});
  assert.equal(added.status,200,await added.text());
 }
 const rows=x.db.prepare("SELECT id,primary_name FROM guests WHERE event_id='multi'").all();
 assert.equal(rows.length,3);
 for(const row of rows){
  const lookup=await x.send('/api/public/events/multi/lookup',{method:'POST',body:{guest_id:row.id}});
  assert.equal(lookup.status,200);
  const publicGuest=(await lookup.json()).guest;
  assert.equal(publicGuest.members.length,1);
  const item=publicGuest.members[0];
  const saved=await x.send('/api/public/events/multi/rsvp',{method:'POST',body:{
   guest_id:row.id,member_responses:[{id:item.id,attendance_status:'yes'}],new_members:[]
  }});
  assert.equal(saved.status,200,await saved.text());
  const result=await saved.json();
  assert.equal(result.guest.id,row.id);
 }
 assert.equal(x.db.prepare("SELECT COUNT(*) n FROM guests WHERE event_id='multi' AND deleted_at IS NULL").get().n,3);
 assert.equal(x.db.prepare("SELECT COUNT(*) n FROM guest_members WHERE event_id='multi' AND attendance_status='yes'").get().n,3);
 const summary=await x.send('/api/admin/events/multi',{cookie:x.cookie});
 assert.equal(summary.status,200);
 const totals=(await summary.json()).summary;
 assert.equal(totals.people_confirmed,3);
 assert.equal(totals.adults_confirmed,2);
 assert.equal(totals.children_confirmed,1);
 const otherEvent=await x.send('/api/admin/events/individual',{cookie:x.cookie});
 assert.equal((await otherEvent.json()).summary.people_confirmed,0);
});

test('public UI routes flagged events to multi-name picker and keeps legacy flow for others',async()=>{
 const src=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(src,/e\.extra_fields\?\.multi_guest_confirmation\?multiGuestLookup\(e\):publicLookup\(e\)/);
 assert.match(src,/function multiGuestLookup\(e\)/);
 assert.match(src,/picked\.set\(result\.guest\.id/);
 assert.match(src,/member_responses:\[/);
 assert.match(src,/qrCodes\.push/);
 assert.match(src,/Tentar novamente as pendentes/);
});
