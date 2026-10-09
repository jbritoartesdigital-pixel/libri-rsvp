// Import files locally in the browser. Guest lists are only sent when the user approves the preview.
export function parseDelimited(source){
 const text=String(source||'').replace(/^\uFEFF/,'');
 const head=text.split(/\r?\n/,1)[0]||'';
 const separators=[',',';','\t'],count=s=>(head.match(new RegExp(s==='\t'?'\\t':s===';'?';':',','g'))||[]).length;
 const delim=separators.reduce((a,b)=>count(b)>count(a)?b:a);
 const lines=[],row=[];let cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;continue;}
  if(!quoted&&c===delim){row.push(cell.trim());cell='';continue;}
  if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());lines.push([...row]);row.length=0;cell='';continue;}
  cell+=c;
 }
 if(quoted)throw Error('CSV com aspas não fechadas.');
 row.push(cell.trim());if(row.some(Boolean))lines.push([...row]);
 return lines;
}
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const splitPeople=s=>String(s||'').split(/\s*(?:\n|[|]+|,\s*|\s+e\s+)\s*/i).map(x=>x.trim()).filter(Boolean);
export function groupRows(rows){
 if(!rows?.length)return [];
 const first=rows[0]?.map(fold)||[];
 const idx=word=>first.findIndex(h=>word.some(x=>h.includes(x)));
 const family=idx(['familia','grupo','mesa']),name=idx(['nome','convidad','integrante','pessoa']),kind=idx(['tipo','idade','categoria']),adults=idx(['adultos','maiores']),children=idx(['criancas','menores']),responsible=idx(['responsavel','titular']);
 const typed=family>=0||name>=0||kind>=0||adults>=0||children>=0||responsible>=0;
 const groups=new Map(),output=[];
 const add=(label,person,type='unknown')=>{
  const nm=String(person||'').trim().replace(/^\d+[\s.)-]+/,'');
  if(!nm||/^(total|quantidade|lista de convidados|convidados|nome)$/i.test(nm))return;
  const guessed=/(?:\(\s*crianc|\bcrianc[ao]\b|infantil)/i.test(nm)?'child':/(\(\s*adulto\s*\)|\badulto\b)/i.test(nm)?'adult':type;
  const clean=nm.replace(/\s*\((?:crianc[ao]|adulto)\s*\)\s*/gi,'').trim();
  const key=fold(label||clean),title=String(label||clean).trim();
  if(!groups.has(key)){const g={group_label:title,primary_name:'',members:[],source_lines:[]};groups.set(key,g);output.push(g);}
  const g=groups.get(key);
  if(!g.members.some(m=>fold(m.name)===fold(clean)))g.members.push({name:clean,person_type:guessed});
  if(!g.primary_name)g.primary_name=clean;
 };
 if(typed){
  for(const row of rows.slice(1)){
   if(!row.some(Boolean))continue;
   const group=family>=0?row[family]||row[responsible]||'':responsible>=0?row[responsible]||'':'';
   if(adults>=0)for(const a of splitPeople(row[adults]))add(group||a,a,'adult');
   if(children>=0)for(const c of splitPeople(row[children]))add(group||c,c,'child');
   if(name>=0&&row[name]){
    const t=kind<0?'unknown':/crianc|infantil|menor/.test(fold(row[kind]))?'child':/adult|maior/.test(fold(row[kind]))?'adult':'unknown';
    add(group||row[name],row[name],t);
   }else if(responsible>=0&&row[responsible]&&adults<0)add(group||row[responsible],row[responsible],'unknown');
  }
 }else{
  let block='';
  for(const row of rows){
   const original=row.join(' ').trim();
   if(!original){block='';continue;}
   const f=original.match(/^\s*(?:fam[ií]lia|grupo)\s*(?::|-)?\s*(.+)$/i);
   if(f){block=original;continue;}
   if(/^(?:p[aá]gina|total|lista\s+de\s+convidados)\b/i.test(original))continue;
   const chunk=row.length>1?row.filter(Boolean):[original];
   for(const value of chunk)add(block||value,value);
  }
 }
 return output.filter(g=>g.members.length).slice(0,1000);
}
async function readCsv(file){return groupRows(parseDelimited(await file.text()));}
const xml=(s)=>{const doc=new DOMParser().parseFromString(s,'application/xml');if(doc.querySelector('parsererror'))throw Error('Planilha XML inválida.');return doc;};
async function xlsxEntries(file){
 const bytes=new Uint8Array(await file.arrayBuffer()),v=new DataView(bytes.buffer);
 const u16=i=>v.getUint16(i,true),u32=i=>v.getUint32(i,true);
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Excel inválido.');
 const total=u16(end+10);if(total>1500)throw Error('Planilha com muitos arquivos internos.');
 let pos=u32(end+16);const entries=new Map(),decoder=new TextDecoder();
 for(let n=0;n<total;n++){
  if(u32(pos)!==0x02014b50)throw Error('Estrutura Excel inválida.');
  const method=u16(pos+10),compressed=u32(pos+20),size=u32(pos+24),nameLen=u16(pos+28),extra=u16(pos+30),comment=u16(pos+32),offset=u32(pos+42);
  const name=decoder.decode(bytes.slice(pos+46,pos+46+nameLen));pos+=46+nameLen+extra+comment;
  if(!/^(xl\/worksheets\/sheet1\.xml|xl\/sharedStrings\.xml)$/.test(name))continue;
  if(size>12_000_000)throw Error('Planilha interna muito grande.');
  if(u32(offset)!==0x04034b50)throw Error('Excel corrompido.');
  const start=offset+30+u16(offset+26)+u16(offset+28),payload=bytes.slice(start,start+compressed);
  let decoded;
  if(method===0)decoded=payload;
  else if(method===8)decoded=new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  else throw Error('Compressão não suportada.');
  entries.set(name,decoder.decode(decoded));
 }
 return entries;
}
async function readExcel(file){
 const entries=await xlsxEntries(file),sheet=entries.get('xl/worksheets/sheet1.xml');
 if(!sheet)throw Error('Não encontrei a primeira aba do Excel.');
 const strings=entries.has('xl/sharedStrings.xml')
  ?[...xml(entries.get('xl/sharedStrings.xml')).getElementsByTagName('si')].map(x=>x.textContent):[];
 const doc=xml(sheet),rows=[];
 for(const r of doc.getElementsByTagName('row')){
  const cells=[];
  for(const c of r.getElementsByTagName('c')){
   const ref=c.getAttribute('r')||'',letters=ref.match(/^[A-Z]+/)?.[0]||'A';
   let col=0;for(const letter of letters)col=col*26+letter.charCodeAt(0)-64;col--;
   if(col>100)continue;
   const raw=c.getElementsByTagName('v')[0]?.textContent||c.getElementsByTagName('is')[0]?.textContent||'';
   cells[col]=c.getAttribute('t')==='s'?strings[Number(raw)]||'':raw;
  }
  rows.push(cells.map(x=>String(x||'').trim()));
  if(rows.length>3000)throw Error('Planilha muito extensa.');
 }
 return groupRows(rows);
}
async function readPDF(file){
 // PDF.js executes client side. The guest file stays on this device until the user confirms importing.
 const lib=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
 lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
 const job=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}),doc=await job.promise;
 let rows=[];
 try{
  if(doc.numPages>40)throw Error('PDF com muitas páginas. Divida a lista.');
  for(let p=1;p<=doc.numPages;p++){
   const page=await doc.getPage(p),t=await page.getTextContent();
   const blocks=t.items.filter(i=>i.str?.trim()).map(i=>({x:i.transform[4],y:i.transform[5],s:i.str.trim()}));
   blocks.sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x);
   let line=null,lastY=null;
   for(const block of blocks){
    if(lastY!==null&&Math.abs(block.y-lastY)>4){
     if(line?.length)rows.push([line.join(' ').trim()]);
     if(lastY-block.y>26)rows.push([]);
     line=[];
   }
    if(!line)line=[];
    line.push(block.s);lastY=block.y;
   }
   if(line?.length)rows.push([line.join(' ').trim()]);
   rows.push([]);if(rows.length>4000)throw Error('PDF muito extenso.');
  }
 }finally{await doc.destroy();}
 if(!rows.some(r=>r.some(Boolean)))throw Error('Este PDF não contém texto selecionável. PDFs digitalizados precisam de OCR.');
 return groupRows(rows);
}
export async function parseGuestFile(file){
 if(!file||file.size>8_000_000)throw Error('Use um arquivo de até 8 MB.');
 const name=file.name.toLowerCase();
 if(name.endsWith('.csv')||name.endsWith('.txt'))return readCsv(file);
 if(name.endsWith('.xlsx'))return readExcel(file);
 if(name.endsWith('.pdf'))return readPDF(file);
 throw Error('Use PDF com texto, Excel .xlsx ou CSV.');
}
export function openGuestImport({event,role,eventId,token,api,toast,modal,esc,onSaved}){
 const base=role==='admin'?'/api/admin/events/'+eventId:'/api/client/'+encodeURIComponent(token);
 let groups=[],file=null,duplicates=new Set();
 const w=modal('Importar lista de convidados',
  '<p>PDF, Excel (.xlsx) ou CSV. Os arquivos são analisados no navegador; nada é salvo antes da sua aprovação.</p>'+
  '<div class="field"><label>Arquivo</label><input id="guestFile" type="file" accept=".pdf,.xlsx,.csv,.txt,application/pdf,text/csv"></div>'+
  '<div id="importStatus" class="notice">Selecione um arquivo para conferir famílias e integrantes.</div>'+
  '<div id="importPreview"></div><div class="actions" style="margin-top:16px">'+
  '<button id="confirmImport" type="button" class="btn" disabled>Importar famílias revisadas</button>'+
  '<button id="markAdults" type="button" class="btn secondary" hidden>Classificar indefinidos como adultos</button></div>', '',true);
 const status=w.querySelector('#importStatus'),preview=w.querySelector('#importPreview'),submit=w.querySelector('#confirmImport'),fix=w.querySelector('#markAdults');
 const render=()=>{
  const count=groups.reduce((n,g)=>n+g.members.length,0),unknown=groups.reduce((n,g)=>n+g.members.filter(m=>m.person_type==='unknown').length,0);
  status.textContent=groups.length+' família(s), '+count+' pessoa(s). '+(unknown?unknown+' pessoa(s) ainda precisam de classificação.':'Revise os nomes e grupos antes de salvar.');
  fix.hidden=!unknown;submit.disabled=!groups.length||unknown>0||groups.some(g=>!g.primary_name||!g.members.length)||groups.length>300;
  preview.innerHTML=groups.map((g,i)=>'<section class="card panel" style="margin:12px 0" data-group="'+i+'"><label>Família / grupo <input class="family-label" value="'+esc(g.group_label)+'"></label><div class="import-members">'+g.members.map((m,k)=>
   '<div style="display:flex;gap:6px;align-items:center;margin:7px 0" data-member="'+k+'"><input style="flex:2;min-width:0" class="import-name" value="'+esc(m.name)+'">'+
   '<select class="import-kind"><option value="unknown" '+(m.person_type==='unknown'?'selected':'')+'>A conferir</option><option value="adult" '+(m.person_type==='adult'?'selected':'')+'>Adulto</option><option value="child" '+(m.person_type==='child'?'selected':'')+'>Criança</option></select>'+
   '<button type="button" class="btn secondary small remove-member">×</button></div>').join('')+
   '</div><button class="btn secondary small remove-family" type="button">Remover família</button></section>').join('');
  preview.querySelectorAll('[data-group]').forEach(row=>{
   const idx=Number(row.dataset.group);
   row.querySelector('.family-label').oninput=e=>{groups[idx].group_label=e.target.value;groups[idx].primary_name=groups[idx].members[0]?.name||'';};
   row.querySelector('.remove-family').onclick=()=>{groups.splice(idx,1);render();};
   row.querySelectorAll('[data-member]').forEach(el=>{
    const mi=Number(el.dataset.member);
    el.querySelector('.import-name').oninput=e=>{groups[idx].members[mi].name=e.target.value;groups[idx].primary_name=groups[idx].members[0]?.name||'';};
    el.querySelector('.import-kind').onchange=e=>{groups[idx].members[mi].person_type=e.target.value;render();};
    el.querySelector('.remove-member').onclick=()=>{groups[idx].members.splice(mi,1);groups[idx].primary_name=groups[idx].members[0]?.name||'';render();};
   });
  });
 };
 w.querySelector('#guestFile').onchange=async e=>{
  file=e.target.files?.[0];if(!file)return;
  status.textContent='Analisando arquivo…';submit.disabled=true;
  try{groups=await parseGuestFile(file);if(!groups.length)throw Error('Nenhum nome foi reconhecido. Confira as colunas do arquivo.');render();}
  catch(err){groups=[];preview.innerHTML='';status.textContent=err.message;toast(err.message,true);}
 };
 fix.onclick=()=>{groups.forEach(g=>g.members.forEach(m=>{if(m.person_type==='unknown')m.person_type='adult';}));render();};
 submit.onclick=async()=>{
  const rows=groups.map(g=>({primary_name:g.members[0].name.trim(),group_label:g.group_label.trim(),members:g.members.map(m=>({name:m.name.trim(),person_type:m.person_type})),response_status:'pending'}));
  if(rows.some(g=>!g.primary_name||g.members.some(m=>!m.name||m.person_type==='unknown')))return toast('Revise os dados antes de importar.',true);
  submit.disabled=true;
  try{
   const r=await api(base+'/import',{method:'POST',body:JSON.stringify({rows,file_name:file?.name||'Lista',source_type:file?.name.split('.').pop()||'arquivo'})});
   if(r.failed?.length)toast(r.created.length+' famílias importadas. '+r.failed.length+' registros ignorados por duplicidade ou erro.',true);
   else toast(r.created.length+' família(s) importada(s).');
   w.closeModal();onSaved?.();
  }catch(err){submit.disabled=false;toast(err.message,true);}
 };
}