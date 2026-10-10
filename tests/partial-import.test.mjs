import test from 'node:test';
import assert from 'node:assert/strict';
import {groupRows,planImport} from '../public/import-wizard.js';

const family=(name,members)=>({group_label:name,primary_name:members[0]?.name||'',members});
const person=(name,person_type)=>({name,person_type});

test('bloqueadores afetam somente famílias pendentes, não toda a importação',()=>{
 const data=[
  family('Família Rocha',[person('Joana Rocha','adult'),person('Luiz Rocha','child')]),
  family('Família Silva',[person('Pedro Silva','unknown')]),
  family('Família Leite',[person('Marta Leite','adult')])
 ];
 const p=planImport(data);
 assert.deepEqual(p.ready,[0,2]);
 assert.deepEqual(p.pending,[1]);
 assert.match(p.issues[1].join(' '),/Defina adulto ou criança/);
});

test('nomes duplicados entre famílias bloqueiam apenas famílias envolvidas',()=>{
 const data=[
  family('Família A',[person('Nome Igual','adult')]),
  family('Família B',[person('Nome Igual','adult')]),
  family('Família C',[person('Nome Único','child')])
 ];
 const p=planImport(data);
 assert.deepEqual(p.ready,[2]);
 assert.deepEqual(p.pending,[0,1]);
 assert.match(p.issues[0].join(' '),/repetido/);
});

test('nomes existentes e nomes vazios não são importados; outras famílias permanecem prontas',()=>{
 const data=[
  family('Existente',[person('Carlos Teste','adult')]),
  family('Sem nome',[person('','adult')]),
  family('Livre',[person('Ana Livre','adult')])
 ];
 const p=planImport(data,new Map([['carlos teste',['Família anterior']]]));
 assert.deepEqual(p.ready,[2]);
 assert.deepEqual(p.pending,[0,1]);
});

test('Excel padrão com Família Nome Tipo preserva adulto e criança sem preencher pessoas desconhecidas',()=>{
 const parsed=groupRows([
  ['Família','Nome','Tipo'],
  ['Família Moura','Sofia Moura','Criança'],
  ['Família Moura','Marcos Moura','Adulto'],
  ['Família Amor','Laura Amor','Adulto']
 ]);
 assert.equal(parsed.length,2);
 assert.deepEqual(parsed[0].members.map(m=>m.person_type),['child','adult']);
 assert.deepEqual(planImport(parsed).ready,[0,1]);
});
