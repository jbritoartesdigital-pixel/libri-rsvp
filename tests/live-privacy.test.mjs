import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {qrRoutes} from '../src/checkin.js';
import {privacyRoutes,retentionEligibility} from '../src/privacy.js';
import {extractQrToken} from '../public/qr-scanner.js';
async function setup(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_init.sql','0002_v1.sql','0003_v2.sql','0004_guest_type_limits.sql','0005_import_passkeys_checkin.sql','0006_live_scanner_retention.sql']){
  db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 }
 const env={DB:{
  prepare(sql){const st=db.prepare(sql);return{bind(...args){return {
   first:async()=>st.get(...args)||null,all:async()=>({results:st.all(...args)}),
   run:async()=>({meta:{changes:st.run(...args).changes}})
  };}};},
  async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(err){db.exec('ROLLBACK');throw err;}}
 }};
 const date='2026-01-01',created='2026-01-01T00:00:00.000Z';
 db.prepare("INSERT INTO events(id,title,slug,event_date,rsvp_mode,status,checkin_mode,created_at,updated_at,retention_days) VALUES('ev','Festa Teste','festa-teste',?,'list','active','individual',?,?,1)").run(date,created,created);
 db.prepare("INSERT INTO guests(id,event_id,primary_name,normalized_name,response_status,created_at,updated_at,source) VALUES('g1','ev','Ana','ana','yes',?,?,'admin')").run(created,created);
 db.prepare("INSERT INTO guest_members(id,guest_id,event_id,name,normalized_name,person_type,is_primary,sort_order,created_at,updated_at,attendance_status,is_preapproved) VALUES('a1','g1','ev','Ana','ana','adult',1,0,?,?,'yes',1)").run(created,created);
 db.prepare("INSERT INTO guest_members(id,guest_id,event_id,name,normalized_name,person_type,is_primary,sort_order,created_at,updated_at,attendance_status,is_preapproved) VALUES('c1','g1','ev','Bia','bia','child',0,1,?,?,'yes',1)").run(created,created);
 const origin='https://libri.example.test';
 const api={isAdmin:async()=>true,getEvent:async(_env,id)=>db.prepare('SELECT * FROM events WHERE id=?').get(id)};
 const send=async(action,path,method='GET',body=null,originHeader=origin)=>{
  const url=new URL(path,origin),req=new Request(url,{
   method,...(method==='GET'?{}:{headers:{origin:originHeader,'content-type':'application/json'},body:JSON.stringify(body||{})})
  });
  return action(req,env,url,api);
 };
 return {db,env,api,send};
}
test('leitor universal extrai somente QR do mesmo domínio e bloqueia URLs de terceiros',()=>{
 const token='A'.repeat(43);
 assert.equal(extractQrToken(token),token);
 assert.equal(extractQrToken('https://libri.example.test/qr/'+token,'https://libri.example.test'),token);
 assert.equal(extractQrToken('https://evil.example.test/qr/'+token,'https://libri.example.test'),'');
 assert.equal(extractQrToken('https://libri.example.test/admin','https://libri.example.test'), '');
});
test('contagem em tempo real diferencia adultos/crianças e família vs. pessoas',async()=>{
 const x=await setup();
 const qr=await x.send(qrRoutes,'/api/admin/events/ev/qr-list'),{groups}=await qr.json();
 assert.equal(groups.length,1);
 let report=await x.send(qrRoutes,'/api/admin/events/ev/checkin');
 let data=await report.json();
 assert.deepEqual([data.summary.confirmed,data.summary.present,data.summary.not_arrived,data.summary.adults,data.summary.children],[2,0,2,1,1]);
 const code=groups[0].qr[0].url.split('/').pop();
 await x.send(qrRoutes,'/api/admin/events/ev/checkin','POST',{token:code});
 report=await x.send(qrRoutes,'/api/admin/events/ev/checkin');
 data=await report.json();
 assert.deepEqual([data.summary.confirmed,data.summary.present,data.summary.not_arrived],[2,1,1]);
 assert.equal(data.summary.present_adults,1);
});
test('desfazer check-in grava reversão e aceita novo registro sem duplicidade',async()=>{
 const x=await setup();
 const qr=await x.send(qrRoutes,'/api/admin/events/ev/qr-list'),{groups}=await qr.json();
 const code=groups[0].qr[0].url.split('/').pop();
 const first=await x.send(qrRoutes,'/api/admin/events/ev/checkin','POST',{token:code});
 const check=(await first.json()).checkin;
 let bad=await x.send(qrRoutes,'/api/admin/events/ev/checkin/'+check.id+'/undo','POST',{confirm:false,reason:'erro'});
 assert.equal(bad.status,400);
 const undone=await x.send(qrRoutes,'/api/admin/events/ev/checkin/'+check.id+'/undo','POST',{confirm:true,reason:'Confusão entre nomes'});
 assert.equal(undone.status,200);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM event_checkins').get().n,0);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM checkin_reversals').get().n,1);
 assert.equal((await x.send(qrRoutes,'/api/admin/events/ev/checkin/'+check.id+'/undo','POST',{confirm:true})).status,404);
 const again=await x.send(qrRoutes,'/api/admin/events/ev/checkin','POST',{token:code});
 assert.equal((await again.json()).already_checked_in,false);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM event_checkins').get().n,1);
});
test('retention respects days and requires an inactive/archived event',()=>{
 const e={event_date:'2026-10-01',retention_days:7,status:'inactive'};
 assert.equal(retentionEligibility(e,new Date('2026-10-07T12:00:00Z')).eligible,false);
 assert.equal(retentionEligibility(e,new Date('2026-10-08T12:00:00Z')).eligible,true);
 assert.equal(retentionEligibility({...e,status:'active'},new Date('2026-10-09T12:00:00Z')).eligible,false);
});
test('post-event cleanup requires explicit confirmation and preserves event/R2 media metadata',async()=>{
 const x=await setup();
 x.db.prepare("UPDATE events SET status='inactive',archived_at='2026-10-08T00:00:00Z' WHERE id='ev'").run();
 const base='/api/admin/events/ev/privacy';
 const notConfirmed=await x.send(privacyRoutes,base+'/cleanup','POST',{confirm_slug:'wrong',confirm_text:'EXCLUIR DADOS'});
 assert.equal(notConfirmed.status,400);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM guests').get().n,1);
 const post=await x.send(privacyRoutes,base+'/cleanup','POST',{confirm_slug:'festa-teste',confirm_text:'EXCLUIR DADOS'});
 assert.equal(post.status,200);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM guests').get().n,0);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM guest_members').get().n,0);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM events').get().n,1);
 assert.equal((await x.send(privacyRoutes,base+'/cleanup','POST',{confirm_slug:'festa-teste',confirm_text:'EXCLUIR DADOS'})).status,409);
});
