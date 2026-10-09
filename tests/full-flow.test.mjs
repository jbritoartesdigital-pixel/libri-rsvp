import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';

async function runtime(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['0001_init.sql','0002_v1.sql','0003_v2.sql','0004_guest_type_limits.sql','0005_import_passkeys_checkin.sql'])
  db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const binding={
  prepare(sql){const statement=db.prepare(sql),bound=(args)=>({
   first:async()=>statement.get(...args)||null,
   all:async()=>({results:statement.all(...args)}),
   run:async()=>({meta:{changes:statement.run(...args).changes}})
  });return {...bound([]),bind(...args){return bound(args);}};},
  async batch(statements){db.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 };
 const env={DB:binding,ADMIN_PASSWORD:'safe-local-fixture-secret',SESSION_SECRET:'this-only-appears-in-local-test-fixture'};
 const origin='https://libri.example.test';
 const send=async(path,{method='GET',body=null,cookie=null}={})=>{
  const req=new Request(origin+path,{method,headers:{
   ...(method==='GET'?{}:{origin,'content-type':'application/json'}),...(cookie?{cookie}:{}),
  },...(body?{body:JSON.stringify(body)}:method!=='GET'?{body:'{}'}:{})});
  return worker.fetch(req,env);
 };
 const stamp='2026-10-09T18:00:00.000Z';
 db.prepare("INSERT INTO events(id,title,slug,event_date,rsvp_mode,status,created_at,updated_at,checkin_mode,max_capacity,waitlist_enabled) VALUES('e1','Festa Libri','festa-libri','2026-12-12','free','active',?,?, 'family',1,1)").run(stamp,stamp);
 return {db,env,send};
}
test('ponta a ponta: RSVP público gera QR, lotação vira espera e check-in recusa duplicidade',async()=>{
 const x=await runtime();
 const first=await x.send('/api/public/events/festa-libri/rsvp',{method:'POST',body:{
  primary_name:'Maria da Silva',response_status:'yes',members:[{name:'Maria da Silva',person_type:'adult',attendance_status:'yes'}]
 }});
 assert.equal(first.status,200);
 const body=await first.json();
 assert.equal(body.guest.response_status,'yes');
 assert.equal(body.qr.length,1);
 const code=body.qr[0].url.split('/').pop();
 const second=await x.send('/api/public/events/festa-libri/rsvp',{method:'POST',body:{
  primary_name:'Joana Pereira',response_status:'yes',members:[{name:'Joana Pereira',person_type:'adult',attendance_status:'yes'}]
 }});
 assert.equal(second.status,202);
 assert.equal((await second.json()).waitlisted,true);
 assert.equal(x.db.prepare("SELECT COUNT(*) n FROM guests WHERE deleted_at IS NULL").get().n,1);
 const login=await x.send('/api/admin/login',{method:'POST',body:{password:'safe-local-fixture-secret'}});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie')?.split(';')[0];assert(cookie);
 const check=await x.send('/api/admin/events/e1/checkin',{method:'POST',cookie,body:{token:code}});
 assert.equal(check.status,200);
 assert.equal((await check.json()).already_checked_in,false);
 const duplicate=await x.send('/api/admin/events/e1/checkin',{method:'POST',cookie,body:{token:code}});
 assert.equal((await duplicate.json()).already_checked_in,true);
 const w=await x.send('/api/admin/events/e1/waitlist',{cookie});
 assert.equal((await w.json()).waitlist.length,1);
});
test('ponta a ponta: conta admin acessa opções WebAuthn e mantém login por senha',async()=>{
 const x=await runtime();
 const login=await x.send('/api/admin/login',{method:'POST',body:{password:'safe-local-fixture-secret'}});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const rq=await x.send('/api/admin/passkeys/register/options',{method:'POST',cookie,body:{}});
 assert.equal(rq.status,200);
 const info=await rq.json();
 assert(info.options.challenge);
 assert(info.challenge_id);
 assert.equal(x.db.prepare("SELECT COUNT(*) n FROM passkey_challenges").get().n,1);
});
