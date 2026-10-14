import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseFamilyLimit,effectiveFamilyLimit} from '../public/family-limits.js';

test('limites de adultos e crianças preservam zero, um e dois durante a edição',()=>{
 assert.equal(parseFamilyLimit('0',{minimum:0}),0);
 assert.equal(parseFamilyLimit('1',{minimum:0}),1);
 assert.equal(parseFamilyLimit('2',{minimum:0}),2);
 assert.equal(parseFamilyLimit(' 1 ',{minimum:0}),1);
 assert.equal(parseFamilyLimit('',{minimum:0}),null);
 assert.equal(parseFamilyLimit('2',{minimum:0})+parseFamilyLimit('1',{minimum:0}),3);
});

test('o limite do evento só é herdado quando o limite individual está vazio',()=>{
 assert.equal(effectiveFamilyLimit('2',1),2);
 assert.equal(effectiveFamilyLimit('1',2),1);
 assert.equal(effectiveFamilyLimit('',1),1);
 assert.equal(effectiveFamilyLimit(null,2),2);
 assert.equal(effectiveFamilyLimit('',null),null);
 assert.ok(Number.isNaN(effectiveFamilyLimit('0',1)));
 assert.ok(Number.isNaN(effectiveFamilyLimit('abc',1)));
});

test('valores fora do intervalo e entradas parciais não são arredondados silenciosamente',()=>{
 for(const value of ['-1','1.5','1e2','101','abc','2x','1234']){
  assert.ok(Number.isNaN(parseFamilyLimit(value,{minimum:0})),value);
 }
 assert.ok(Number.isNaN(parseFamilyLimit('0',{minimum:1})));
 assert.equal(parseFamilyLimit('100',{minimum:0}),100);
});

test('formulário de lista flexível usa teclado numérico sem input nativo number',async()=>{
 const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const flexibleMarkup=source.split(':!isList?')[0]; // O modo livre mantém o seu campo próprio.
 for(const name of ['familyLimit','familyAdultLimit','familyChildLimit']){
  assert.match(flexibleMarkup,new RegExp('id="'+name+'" type="text" inputmode="numeric"'));
  assert.doesNotMatch(flexibleMarkup,new RegExp('id="'+name+'" type="number"'));
 }
 assert.match(source,/parseFamilyLimit\(childLimitInput\?\.value,\{minimum:0\}\)/);
 assert.match(source,/effectiveFamilyLimit\(limitInput\?\.value,event\.max_people_per_rsvp\)/);
 assert.match(source,/if\(!Number\.isInteger\(a\)\|\|!Number\.isInteger\(c\)\)/);
});
