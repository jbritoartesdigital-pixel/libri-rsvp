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
   run:async()=>({meta:{changes:statement.run(...args).changes}}),
  });return {...bound([]),bind(...args){return bound(args)}};},
  async batch(statements){db.exec('BEGIN');try{const r=[];for(const statement of statements)r.push(await statement.run());db.exec('COMMIT');return r}catch(error){db.exec('ROLLBACK');throw error}}
 };
 const env={DB:binding,ADMIN_PASSWORD:'fixture-password',SESSION_SECRET:'fixture-secret'};
 const origin='https://rsvp.example.test';
 const send=async(path,{method='GET',body,cookie}={})=>worker.fetch(new Request(origin+path,{
  method,headers:{...(method==='GET'?{}:{origin,'content-type':'application/json'}),...(cookie?{cookie}:{})},
  ...(method==='GET'?{}:{body:JSON.stringify(body||{})})
 }),env);
 const stamp='2026-10-19T17:00:00.000Z';
 db.prepare("INSERT INTO events(id,title,slug,rsvp_mode,list_behavior,extra_fields,status,created_at,updated_at) VALUES('evt','Lista de teste','lista-teste','list','flexible','{}','active',?,?)").run(stamp,stamp);
 const login=await send('/api/admin/login',{method:'POST',body:{password:'fixture-password'}});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 return {db,send,cookie};
}
const rows=[
 {group_label:'Família A',primary_name:'Tatiana',members:[{name:'Tatiana',person_type:'adult'}]},
 {group_label:'Família Bastos',primary_name:'Tatiana',members:[{name:'Tatiana',person_type:'adult'},{name:'Diógenes',person_type:'adult'}]}
];
const post=(x,rows,allow_homonyms=false)=>x.send('/api/admin/events/evt/import',{method:'POST',cookie:x.cookie,body:{rows,allow_homonyms,file_name:'lista-teste.pdf',source_type:'pdf'}});

test('same first name in two different families imports both after explicit namesake approval',async()=>{
 const x=await fixture();
 const res=await post(x,rows,true);
 assert.equal(res.status,200);
 const output=await res.json();
 assert.equal(output.created.length,2,JSON.stringify(output.failed));
 assert.deepEqual(output.created.map(g=>g.group_label),['Família A','Família Bastos']);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guest_members WHERE name='Tatiana' AND deleted_at IS NULL").get().n,2);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guests WHERE deleted_at IS NULL").get().n,2);
 const repeated=await post(x,[rows[0]],true);
 assert.equal(repeated.status,200);
 const rejected=await repeated.json();
 assert.equal(rejected.created.length,0);
 assert.equal(rejected.failed.length,1);
 assert.match(rejected.failed[0].error,/mesma família/);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guests WHERE deleted_at IS NULL").get().n,2);
});

test('cross-family name collision is rejected without explicit consent',async()=>{
 const x=await fixture();
 const res=await post(x,rows,false);
 assert.equal(res.status,200);
 const output=await res.json();
 assert.equal(output.created.length,1);
 assert.equal(output.failed.length,1);
 assert.match(output.failed[0].error,/outra família/);
 const approved=await post(x,[rows[1]],true);
 assert.equal(approved.status,200);
 assert.equal((await approved.json()).created.length,1);
});
