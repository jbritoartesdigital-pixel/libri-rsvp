import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {groupRows,pdfTableRows,parseEventCountTable} from '../public/import-wizard.js';

const header=['Nº','Grupo / nome do convite','Pessoas incluídas','Adultos','Crianças','Total'];
test('PDF/Excel tabular com números reconhece famílias, adultos e crianças',()=>{
 const rows=[['LISTA DE CONVIDADOS'],['Subtotal 10 pessoas'],header,
 ['1','Ingrid e Douglas','Ingrid; Douglas; 2 filhas','2','2','4'],
 ['2','Família Morato','Javier Morato; esposa','2','0','2'],
 ['3','Karina e Milton','Karina; Milton; Andrea; Melissa','2','2','4'],
 ['4','Carlos e família','Carlos e família; quantidade não informada','A confirmar','A confirmar','A confirmar'],
 ['Nº','Nome','Adultos','Crianças','Total'],
 ['1','Pessoa distante','A confirmar','A confirmar','A confirmar']];
 const got=groupRows(rows);
 assert.equal(got.length,3);
 assert.equal(got.reduce((n,g)=>n+g.members.length,0),10);
 assert.equal(got[0].members[2].person_type,'child');
 assert.match(got[0].members[2].name,/nome pendente/);
 assert.equal(got[2].members[2].name,'Andrea');
 assert.equal(got[2].members[3].name,'Melissa');
 assert.equal(got[1].members[1].person_type,'adult');
 assert.match(got[1].members[1].name,/nome pendente/);
 assert.deepEqual(got.skippedGroups,['Carlos e família']);
});
test('PDF text coordinates identify columns and join wrapped names without merging families',()=>{
 const cols=[144,162,284,576,620,664];
 const line=(y,values)=>values.flatMap((s,i)=>s?[{x:cols[i],y,s}]:[]);
 const blocks=[
  ...line(480,header),
  ...line(464,['1','Caroline Piovesana e Carlos','Caroline Piovesana; Carlos Eduardo; 1 filho','2','1','3']),
  ...line(456,['','Eduardo','','','','']),
  ...line(440,['2','Rolando e Damiana','Rolando; Damiana','2','0','2']),
 ];
 const parsed=pdfTableRows(blocks);
 assert.deepEqual(parsed[0],header);
 assert.equal(parsed[1][1],'Caroline Piovesana e Carlos Eduardo');
 assert.equal(parsed[2][1],'Rolando e Damiana');
 const groups=groupRows(parsed);
 assert.equal(groups.length,2);
 assert.equal(groups.reduce((n,g)=>n+g.members.length,0),5);
});
test('ordinary three-column CSV parsing remains unchanged',()=>{
 const groups=groupRows([['Família','Nome','Tipo'],['Almeida','Maria Almeida','adulto'],['Almeida','Lia Almeida','criança']]);
 assert.equal(groups.length,1);assert.equal(groups[0].members[1].person_type,'child');
});
test('import button blocking shows clear reason',async()=>{
 const src=await readFile(new URL('../public/import-wizard.js',import.meta.url),'utf8');
 assert.match(src,/família\(s\) pronta\(s\) para importar/);
 assert.match(src,/sem quantidade definida ficaram de fora/);
});
