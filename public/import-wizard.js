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
 const typed=((rows[0]?.length||0)>1&&(family>=0||name>=0||kind>=0||adults>=0||children>=0||responsible>=0)) || ((rows[0]?.length||0)===1&&['nome','convidado','convidados'].includes(first[0]));
 const groups=new Map(),output=[];
 const add=(label,person,type='unknown')=>{
  const nm=String(person||'').trim().replace(/^\d+[\s.)-]+/,'');
  if(!nm||/^(total|quantidade|lista de convidados|convidados|nome)$/i.test(nm))return;
  const guessed=/(?:\(\s*crianc|\bcrianc[ao]\b|infantil)/i.test(fold(nm))?'child':/(\(\s*adulto\s*\)|\badulto\b)/i.test(fold(nm))?'adult':type;
  const clean=nm.replace(/\s*\((?:crian[çc][ao]|adulto)\s*\)\s*/gi,'').trim();
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
async function readPDF(file,options={}){
 // PDF.js and OCR execute locally. Guest data is transmitted only after explicit import.
 const lib=await import('/vendor/pdf.min.mjs');
 lib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.mjs';
 const job=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}),doc=await job.promise;
 let rows=[],ocr=null;
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
   const chars=blocks.map(b=>b.s).join(' ').trim().length;
   if(chars<20){
    if(p>20)throw Error('PDF digitalizado com mais de 20 páginas. Divida o arquivo para evitar sobrecarga.');
    if(!ocr){const {startLocalOCR}=await import('./ocr-local.js');ocr=await startLocalOCR({progress:options?.onProgress||(()=>{})});}
    options?.onProgress?.('OCR: página '+p+' de '+doc.numPages);
    const {scannedPdfPage}=await import('./ocr-local.js');
    const recognized=await scannedPdfPage(page,ocr,{progress:options?.onProgress||(()=>{})});
    // Confidence is informative; never treat OCR as authoritative.
    if(recognized.text.trim())rows.push(...recognized.text.split(/\r?\n/).map(x=>[x.trim()]));
   }
   rows.push([]);if(rows.length>4000)throw Error('PDF muito extenso.');
  }
 }finally{await ocr?.terminate();await doc.destroy();}
 if(!rows.some(r=>r.some(Boolean)))throw Error('Não foi possível reconhecer nomes neste PDF. Confira a digitalização e tente uma imagem mais nítida.');
 return groupRows(rows);
}
export async function parseGuestFile(file,options={}){
 if(!file||file.size>8_000_000)throw Error('Use um arquivo de até 8 MB.');
 const name=file.name.toLowerCase();
 if(name.endsWith('.csv')||name.endsWith('.txt'))return readCsv(file);
 if(name.endsWith('.xlsx'))return readExcel(file);
 if(name.endsWith('.pdf'))return readPDF(file,options);
 throw Error('Use PDF com texto, Excel .xlsx ou CSV.');
}
// Explicit labels and editable full names avoid the mobile flex layout swallowing name inputs.
export function importPreviewMarkup(groups,warnings=[],esc=value=>String(value)){
 return '<div class="import-preview-list">'+groups.map((g,i)=>{
  const adults=g.members.filter(m=>m.person_type==='adult').length;
  const children=g.members.filter(m=>m.person_type==='child').length;
  const kindOption=(m,value,text)=>'<option value="'+value+'" '+(m.person_type===value?'selected':'')+'>'+text+'</option>';
  return '<section class="import-family-card" data-group="'+i+'">'+
   '<div class="import-family-heading"><strong>Família '+(i+1)+' de '+groups.length+'</strong><span class="import-family-summary">'+g.members.length+' pessoa(s) · '+adults+' adulto(s) · '+children+' criança(s)</span></div>'+
   '<label class="import-group-field"><span class="import-field-label">Nome da família / grupo</span><input class="family-label" value="'+esc(g.group_label)+'" aria-label="Nome da família '+(i+1)+'"></label>'+
   '<div class="import-members">'+g.members.map((m,k)=>
    '<div class="import-member-row" data-member="'+k+'">'+
    '<label class="import-name-field"><span class="import-field-label">Nome da pessoa '+(k+1)+'</span><input class="import-name" value="'+esc(m.name)+'" aria-label="Nome da pessoa '+(k+1)+'" autocomplete="off"></label>'+
    '<label class="import-kind-field"><span class="import-field-label">Categoria</span><select class="import-kind" aria-label="Categoria de '+esc(m.name)+'">'+
    kindOption(m,'unknown','A conferir')+kindOption(m,'adult','Adulto')+kindOption(m,'child','Criança')+'</select></label>'+
    '<button type="button" class="btn secondary small remove-member" aria-label="Remover '+esc(m.name)+'">×</button></div>').join('')+'</div>'+
   warnings.filter(w=>w.i===i).map(w=>'<div class="notice" style="margin:8px 0;color:#9c4b2b"><strong>Nome igual: '+esc(w.name)+'</strong><p>'+esc(w.details)+'</p></div>').join('')+
   '<div class="actions"><button class="btn secondary small add-member" type="button">+ Integrante</button><button class="btn secondary small remove-family" type="button">Remover família</button></div></section>';
 }).join('')+'</div>';
}
export function openGuestImport({event,role,eventId,token,api,toast,modal,esc,onSaved}){
 const base=role==='admin'?'/api/admin/events/'+eventId:'/api/client/'+encodeURIComponent(token);
 let groups=[],file=null,existingNames=new Map(),nameWarnings=[];
 const w=modal('Importar lista de convidados',
  '<p>PDF (inclusive digitalizado via OCR), Excel (.xlsx) ou CSV. O arquivo é analisado neste dispositivo, e você revisa as famílias antes de salvar. O OCR pode demorar e não garante nomes corretos.</p>'+
  '<div class="field"><label>Arquivo</label><input id="guestFile" type="file" accept=".pdf,.xlsx,.csv,.txt,application/pdf,text/csv"></div>'+
  '<div id="importStatus" class="notice">Selecione um arquivo para conferir famílias e integrantes.</div>'+
  '<p class="subtle" style="margin:10px 0">Confira cada <strong>nome completo</strong> abaixo. A categoria de adulto ou criança fica em outro campo.</p>'+< 'div' + ' id="importPreview" class="import-preview-list"></div><div class="actions" style="margin-top:16px">'+
  '<button id="confirmImport" type="button" class="btn" disabled>Importar famílias revisadas</button>'+
  '<button id="markAdults" type="button" class="btn secondary" hidden>Classificar indefinidos como adultos</button></div>', '',true);
 const status=w.querySelector('#importStatus'),preview=w.querySelector('#importPreview'),submit=w.querySelector('#confirmImport'),fix=w.querySelector('#markAdults');
 const render=()=>{
  nameWarnings=[];
  const current=new Map();
  groups.forEach((g,i)=>g.members.forEach((m,k)=>{
   const key=fold(m.name).replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
   if(!key)return;
   const found=existingNames.get(key)||[];
   if(found.length)nameWarnings.push({i,k,name:m.name,details:'Já consta na lista: '+found.join(', ')});
   const previous=current.get(key)||[];
   if(previous.some(x=>x.i!==i))nameWarnings.push({i,k,name:m.name,details:'Também aparece em outra família deste arquivo'});
   current.set(key,[...previous,{i,k}]);
  }));
  const count=groups.reduce((n,g)=>n+g.members.length,0),unknown=groups.reduce((n,g)=>n+g.members.filter(m=>m.person_type==='unknown').length,0);
  status.textContent=groups.length+' família(s), '+count+' pessoa(s). '+(unknown?unknown+' pessoa(s) a classificar. ':'')+(nameWarnings.length?nameWarnings.length+' possível(is) nome(s) repetido(s): revise antes de importar.':'Revise os nomes antes de salvar.');
  status.style.borderColor=nameWarnings.length?'#bf7233':'';
  fix.hidden=!unknown;submit.disabled=!groups.length||unknown>0||nameWarnings.length>0||groups.some(g=>!g.primary_name||!g.members.length)||groups.length>300;
  preview.innerHTML=importPreviewMarkup(groups,nameWarnings,esc);
  preview.querySelectorAll('[data-group]').forEach(row=>{
   const idx=Number(row.dataset.group);
   row.querySelector('.family-label').onchange=e=>{groups[idx].group_label=e.target.value;groups[idx].primary_name=groups[idx].members[0]?.name||'';render();};
   row.querySelector('.remove-family').onclick=()=>{groups.splice(idx,1);render();};
   row.querySelector('.add-member').onclick=()=>{groups[idx].members.push({name:'',person_type:'unknown'});render();};
   row.querySelectorAll('[data-member]').forEach(el=>{
    const mi=Number(el.dataset.member);
    el.querySelector('.import-name').onchange=e=>{groups[idx].members[mi].name=e.target.value;groups[idx].primary_name=groups[idx].members[0]?.name||'';render();};
    el.querySelector('.import-kind').onchange=e=>{groups[idx].members[mi].person_type=e.target.value;render();};
    el.querySelector('.remove-member').onclick=()=>{groups[idx].members.splice(mi,1);groups[idx].primary_name=groups[idx].members[0]?.name||'';render();};
   });
  });
 };
 w.querySelector('#guestFile').onchange=async e=>{
  file=e.target.files?.[0];if(!file)return;
  status.textContent='Analisando arquivo…';submit.disabled=true;
  try{
   const prev=await api(base+'/guests?q=&status=');
   existingNames=new Map();
   for(const g of prev.guests||[])for(const m of g.members||[]){
    const key=fold(m.name).replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
    const labels=existingNames.get(key)||new Set();labels.add(g.group_label||g.primary_name);existingNames.set(key,labels);
   }
   existingNames=new Map([...existingNames].map(([k,v])=>[k,[...v]]));
   groups=await parseGuestFile(file,{onProgress:message=>{status.textContent=message;}});
   if(!groups.length)throw Error('Nenhum nome foi reconhecido. Confira as colunas do arquivo.');
   render();
  }
  catch(err){groups=[];preview.innerHTML='';status.textContent=err.message;toast(err.message,true);}
 };
 fix.onclick=()=>{groups.forEach(g=>g.members.forEach(m=>{if(m.person_type==='unknown')m.person_type='adult';}));render();};
 submit.onclick=async()=>{
  // Explicitly edited matching group names represent one family, not separate invitations.
  const merged=new Map();
  for(const g of groups){
   const label=g.group_label.trim(),key=fold(label);
   if(!merged.has(key))merged.set(key,{group_label:label,members:[]});
   for(const m of g.members){
    if(!merged.get(key).members.some(x=>fold(x.name)===fold(m.name)))merged.get(key).members.push({name:m.name.trim(),person_type:m.person_type});
   }
  }
  const rows=[...merged.values()].map(g=>({primary_name:g.members[0]?.name?.trim()||'',group_label:g.group_label,members:g.members,response_status:'pending'}));
  if(rows.some(g=>!g.primary_name||g.members.some(m=>!m.name||m.person_type==='unknown')))return toast('Revise os dados antes de importar.',true);
  if(nameWarnings.length){toast('Corrija ou confira os nomes repetidos antes de importar.',true);return;}
  submit.disabled=true;
  try{
   const r=await api(base+'/import',{method:'POST',body:JSON.stringify({rows,file_name:file?.name||'Lista',source_type:file?.name.split('.').pop()||'arquivo'})});
   if(r.failed?.length)toast(r.created.length+' famílias importadas. '+r.failed.length+' registros ignorados por duplicidade ou erro.',true);
   else toast(r.created.length+' família(s) importada(s).');
   w.closeModal();onSaved?.();
  }catch(err){submit.disabled=false;toast(err.message,true);}
 };
}