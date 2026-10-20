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
   run:async()=>sql.trimStart().toUpperCase().startsWith("SELECT")?{results:statement.all(...args)}:{meta:{changes:statement.run(...args).changes}},
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


test('homônimos em famílias diferentes exigem confirmação explícita, mas não são bloqueados',async()=>{
 const x=await fixture();x.event('hom','list',true);
 const first=await x.send('/api/admin/events/hom/guests',{method:'POST',cookie:x.cookie,body:{
  primary_name:'Marina',group_label:'Família Marina',max_adults_allowed:1,max_children_allowed:1,
  members:[{name:'Marina',person_type:'adult',attendance_status:'pending'},
   {name:'Pedro',person_type:'child',attendance_status:'pending'}]
 }});
 assert.equal(first.status,200);
 const firstGuest=(await first.json()).guest;
 const second=await x.send('/api/admin/events/hom/guests',{method:'POST',cookie:x.cookie,body:{
  primary_name:'Clara',group_label:'Família Clara',max_adults_allowed:2,max_children_allowed:1,
  members:[{name:'Clara',person_type:'adult',attendance_status:'pending'}]
 }});
 assert.equal(second.status,200);
 const secondGuest=(await second.json()).guest;
 const payload={guest_id:secondGuest.id,
  member_responses:secondGuest.members.map(m=>({id:m.id,attendance_status:'yes'})),
  new_members:[{name:'Pedro',person_type:'child',attendance_status:'yes',child_age:'0'}]};
 const blocked=await x.send('/api/public/events/teste-hom/rsvp',{method:'POST',body:payload});
 assert.equal(blocked.status,409);
 assert.equal((await blocked.json()).code,'NAME_IN_ANOTHER_CONFIRMATION');
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guest_members WHERE name='Pedro' AND deleted_at IS NULL").get().n,1);
 const confirmed=await x.send('/api/public/events/teste-hom/rsvp',{method:'POST',
  body:{...payload,allow_homonym:true}});
 assert.equal(confirmed.status,200);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guest_members WHERE name='Pedro' AND deleted_at IS NULL").get().n,2);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guest_members WHERE name='Pedro' AND guest_id=? AND deleted_at IS NULL").get(firstGuest.id).n,1);
 const sameFamily=await x.send('/api/public/events/teste-hom/rsvp',{method:'POST',
  body:{...payload,allow_homonym:true}});
 assert.equal(sameFamily.status,400);
 assert.match((await sameFamily.json()).error,/já está nesta confirmação/);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guest_members WHERE name='Pedro' AND deleted_at IS NULL").get().n,2);
});
test('revisão das vagas respeita composição por idade e não aparece sem limite',async()=>{
 const {flexibleRemainingSlots}=await import('../public/family-limits.js');
 assert.deepEqual(flexibleRemainingSlots({composition:true,adultLimit:2,childLimit:1,
  confirmedAdults:1,confirmedChildren:0}),{adults:1,children:1,total:2});
 assert.deepEqual(flexibleRemainingSlots({composition:true,adultLimit:1,childLimit:1,
  confirmedAdults:1,confirmedChildren:1}),{adults:0,children:0,total:0});
 assert.deepEqual(flexibleRemainingSlots({composition:false,limit:4,
  confirmedAdults:1,confirmedChildren:2}),{adults:null,children:null,total:1});
 assert.deepEqual(flexibleRemainingSlots({composition:false,limit:null,
  confirmedAdults:1,confirmedChildren:0}),{adults:0,children:0,total:0});
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/data-add-people/);
 assert.match(app,/data-confirm-selected/);
 assert.match(app,/if\(flex&&confirmed>0&&remaining\.total>0\)/);
 assert.match(app,/NAME_IN_ANOTHER_CONFIRMATION/);
});


test('cadastro manual pela Libri inclui o contato automaticamente como adulto pesquisável',async()=>{
 const x=await fixture();x.event('main-contact','list',false,'strict');
 const created=await x.send('/api/admin/events/main-contact/guests',{method:'POST',cookie:x.cookie,body:{
  primary_name:'João Silva',group_label:'Família Silva',members:[],
 }});
 assert.equal(created.status,200,await created.clone().text());
 const guest=(await created.json()).guest;
 assert.deepEqual(guest.members.map(m=>[m.name,m.person_type,m.attendance_status]),
  [['João Silva','adult','pending']]);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM guest_members WHERE guest_id=?").get(guest.id).n,1);
 const found=await x.send('/api/public/events/teste-main-contact/suggestions?q=Jo%C3%A3o');
 assert.equal(found.status,200);
 const suggestions=(await found.json()).suggestions;
 assert.equal(suggestions.length,1);
 assert.ok(suggestions[0].member_id);
 assert.match(suggestions[0].display_name,/João S\./);
});

test('cadastro pela cliente preenche contato faltante uma vez e conserva pessoas pré-cadastradas',async()=>{
 const x=await fixture();x.event('client-contact','list',false,'strict');
 x.db.prepare("UPDATE events SET client_token='token_contacto',client_permissions='{}' WHERE id='client-contact'").run();
 const added=await x.send('/api/client/token_contacto/guests',{method:'POST',body:{
  primary_name:'Marina',group_label:'Família Marina',members:[
   {name:'Lia',person_type:'child',attendance_status:'pending'}
  ]
 }});
 assert.equal(added.status,200,await added.clone().text());
 const guest=(await added.json()).guest;
 assert.deepEqual(guest.members.map(m=>[m.name,m.person_type]),
  [['Marina','adult'],['Lia','child']]);
 const updated=await x.send('/api/client/token_contacto/guests/'+encodeURIComponent(guest.id),{
  method:'PATCH',body:{primary_name:'Responsável diferente',phone:'123456',members:guest.members}
 });
 assert.equal(updated.status,200);
 const saved=(await updated.json()).guest;
 assert.deepEqual(saved.members.map(m=>m.name),['Marina','Lia']);
 assert.equal(saved.primary_name,'Responsável diferente');
});

test('contato já incluído não duplica, inclusive com diferenças de maiúsculas e acentuação',async()=>{
 const x=await fixture();x.event('dedup-contact','list',false,'strict');
 const added=await x.send('/api/admin/events/dedup-contact/guests',{method:'POST',cookie:x.cookie,body:{
  primary_name:'José',members:[{name:'jose',person_type:'adult',attendance_status:'pending'}]
 }});
 assert.equal(added.status,200);
 const g=(await added.json()).guest;
 assert.deepEqual(g.members.map(m=>m.name),['jose']);
});

test('limite flexível sem vaga de adulto não aceita acrescentar titular silenciosamente',async()=>{
 const x=await fixture();x.event('limit-contact','list',false,'flexible');
 const bad=await x.send('/api/admin/events/limit-contact/guests',{method:'POST',cookie:x.cookie,body:{
  primary_name:'Responsável',max_adults_allowed:0,max_children_allowed:1,
  members:[{name:'Bebê',person_type:'child',attendance_status:'pending'}]
 }});
 assert.equal(bad.status,400);
 assert.match((await bad.json()).error,/vaga de adulto|limite de pessoas/);
 assert.equal(x.db.prepare("SELECT COUNT(*) n FROM guests WHERE event_id='limit-contact'").get().n,0);
});

test('contrato do formulário espelha contato novo e verifica no envio, sem alterar edições antigas',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const modal=app.slice(app.indexOf('function guestModal('),app.indexOf('function bulkModal('));
 assert.match(modal,/const syncPrimaryContact=\(\)=>/);
 assert.match(modal,/if\(guest\)return true/);
 assert.match(modal,/primary\.oninput=syncPrimaryContact/);
 assert.match(modal,/primary\.onchange=syncPrimaryContact/);
 assert.match(modal,/if\(!syncPrimaryContact\(\)\)/);
});
