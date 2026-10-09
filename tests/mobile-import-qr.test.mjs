import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importPreviewMarkup} from '../public/import-wizard.js';
import {qrFamilyMarkup} from '../public/checkin-ui.js';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('revisão OCR exibe nomes completos, família e classificação em campos distintos',()=>{
 const groups=[{group_label:'Família Almeida',members:[
  {name:'Maria Eduarda Almeida',person_type:'adult'},
  {name:'João Pedro Almeida',person_type:'child'},
  {name:'Ana & Felipe',person_type:'adult'}]}];
 const html=importPreviewMarkup(groups,[],escape);
 for(const name of ['Maria Eduarda Almeida','João Pedro Almeida','Ana &amp; Felipe'])
  assert(html.includes(name),'The mobile preview lost '+name);
 assert.match(html,/Nome da pessoa 1/);
 assert.match(html,/Nome da pessoa 2/);
 assert.match(html,/class="import-name-field"/);
 assert.match(html,/class="import-kind-field"/);
 assert.match(html,/3 pessoa\(s\)/);
 assert.match(html,/2 adulto\(s\)/);
 assert.match(html,/1 criança\(s\)/);
});
test('QR card separates names from link and confirmation even on narrow screens',()=>{
 const groups=[{name:'Família Almeida',qr:[
  {name:'Maria Eduarda Almeida',url:'https://example.test/qr/'+'A'.repeat(43)},
  {name:'João Pedro Almeida',url:'https://example.test/qr/'+'B'.repeat(43)}]}];
 const html=qrFamilyMarkup(groups);
 assert.match(html,/class="qr-family-card"/);
 assert.match(html,/class="qr-person-row"/);
 assert.match(html,/class="qr-person-name">Maria Eduarda Almeida/);
 assert.match(html,/class="qr-person-name">João Pedro Almeida/);
 assert.equal(html.match(/class="qr-person-actions"/g).length,2);
 assert.equal(html.match(/>Ver \/ salvar QR</g).length,2);
 assert.equal(html.match(/>Conferir entrada</g).length,2);
});
test('QR card escapes untrusted person names',()=>{
 const html=qrFamilyMarkup([{name:'Família <script>',qr:[{name:'<img src=x onerror=1>',url:'https://example.test/qr/'+'Z'.repeat(43)}]}]);
 assert(!html.includes('<script>'));
 assert(!html.includes('<img '));
 assert(html.includes('&lt;script&gt;'));
});
test('CSS prevents member name truncation, QR overlap and huge waitlist toggle on mobile',async()=>{
 const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 for(const className of ['.import-member-row','.qr-person-row','.qr-person-actions','.qr-waitlist-toggle input[type="checkbox"]','.qr-scanner-video[hidden]'])
  assert(css.includes(className),'Missing responsive '+className);
 assert.match(css,/\.guest-member-name\s*\{[^}]*white-space:normal/);
 assert.match(css,/\.qr-scanner-video\[hidden\]\s*\{\s*display:none !important/);
});
