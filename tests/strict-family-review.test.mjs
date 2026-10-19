import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pendingRegisteredMembers} from '../public/family-limits.js';

const people=[
 {id:'p1',name:'Aparecida',attendance_status:'pending'},
 {id:'p2',name:'João',attendance_status:'pending'},
 {id:'p3',name:'Júlia',attendance_status:'pending'},
 {id:'p4',name:'Antônio',attendance_status:'pending'},
 {id:'p5',name:'Ivoney',attendance_status:'pending'},
];

test('strict list: 5 registered people, only 1 yes -> popup must show 4 unanswered',()=>{
 const answers=[{id:'p1',attendance_status:'yes'}];
 assert.deepEqual(pendingRegisteredMembers(people,answers).map(p=>p.name),
   ['João','Júlia','Antônio','Ivoney']);
});

test('strict list: yes/no are already answered; only genuinely pending count',()=>{
 const answers=[
  {id:'p1',attendance_status:'yes'},
  {id:'p2',attendance_status:'no'},
  {id:'p3',attendance_status:'no'},
  {id:'p4',attendance_status:'no'},
  {id:'p5',attendance_status:'no'},
 ];
 assert.deepEqual(pendingRegisteredMembers(people,answers),[]);
 const partiallyAnswered=answers.filter(x=>x.id!=='p4');
 assert.deepEqual(pendingRegisteredMembers(people,partiallyAnswered).map(x=>x.id),['p4']);
});

test('strict list: saved yes/no statuses and non-confirmed people are not misclassified',()=>{
 const existing=[
  {id:'one',name:'Titular',attendance_status:'yes'},
  {id:'two',name:'Convidado',attendance_status:'no'},
  {id:'three',name:'Pendente',attendance_status:'pending'},
 ];
 assert.deepEqual(pendingRegisteredMembers(existing,[]).map(x=>x.name),['Pendente']);
 assert.deepEqual(pendingRegisteredMembers(existing,[{id:'three',attendance_status:'no'}]),[]);
 assert.deepEqual(pendingRegisteredMembers([],[]),[]);
});

test('strict popup can review or submit unchanged choices; flexible review remains independent',async()=>{
 const src=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const start=src.indexOf('function listRsvp('),end=src.indexOf('function freeRsvp(',start);
 assert.ok(start>=0&&end>start);
 const list=src.slice(start,end);
 assert.match(list,/const unanswered=!flex\?pendingRegisteredMembers\(g\.members,responses\):\[\]/);
 assert.match(list,/if\(!flex&&confirmed>0&&unanswered\.length>0\)/);
 assert.match(list,/data-review-registered/);
 assert.match(list,/data-confirm-registered/);
 assert.match(list,/popup\.querySelector\("\[data-confirm-registered\]"\)\.onclick=\(\)=>\{popup\.closeModal\(\);sendConfirmation\(\)\}/);
 assert.match(list,/if\(flex&&confirmed>0&&remaining\.total>0\)/);
 assert.ok(list.indexOf('if(!flex&&confirmed>0&&unanswered.length>0)')<list.lastIndexOf('await sendConfirmation()'));
});
