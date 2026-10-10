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
// Libri-style multi-column tables include a group, individual names and numerical adult/child counts.
// Countless/incomplete rows are held aside instead of guessing somebody's age or family size.
export function parseEventCountTable(rows){
 const result=[],skipped=[];
 let columns=null,seen=false;
 for(const row of rows||[]){
  const cells=(row||[]).map(x=>String(x??'').replace(/\s+/g,' ').trim());
  const headers=cells.map(fold);
  if(headers.some(x=>x.includes('grupo')&&x.includes('nome'))&&
     headers.some(x=>x.includes('pessoas incluidas'))&&
     headers.some(x=>x==='adultos')&&headers.some(x=>x==='criancas')){
   const locate=p=>headers.findIndex(p);
   columns={group:locate(x=>x.includes('grupo')&&x.includes('nome')),
    persons:locate(x=>x.includes('pessoas incluidas')),adults:headers.indexOf('adultos'),
    children:headers.indexOf('criancas')};
   seen=true;continue;
  }
  if(headers.some(x=>x==='nome')&&headers.some(x=>x==='adultos')&&!headers.some(x=>x.includes('pessoas incluidas'))){
   columns=null;continue; // an independent incomplete guest list, e.g. Bolivia
  }
  if(!columns||cells.length<4)continue;
  const group=cells[columns.group]||'',membersText=cells[columns.persons]||'';
  const adultText=cells[columns.adults]||'',childText=cells[columns.children]||'';
  if(!group||!membersText)continue;
  if(!/^\d+$/.test(adultText)||!/^\d+$/.test(childText)){
   if(/a confirmar|não informad|nao informad/i.test(adultText+' '+childText))
    skipped.push(group);
   continue;
  }
  const countAdults=Number(adultText),countChildren=Number(childText);
  if(countAdults+countChildren<1||countAdults+countChildren>100)continue;
  const named=[],unnamedChildren=[];
  for(const value of membersText.split(';').map(x=>x.trim()).filter(Boolean)){
   const childMarker=value.match(/^(\d+)\s+(filh[oa]s?|crian[çc]as?)\b/i);
   if(childMarker){
    const label=/filha/i.test(childMarker[2])?'Filha':/filho/i.test(childMarker[2])?'Filho':'Criança';
    for(let n=0;n<Number(childMarker[1])&&n<100;n++)
      unnamedChildren.push(label+' '+(n+1)+' ('+group+': nome pendente)');
   }else if(/^pai\s+e\s+m[aã]e$/i.test(value)){
    named.push('Pai ('+group+': nome pendente)','Mãe ('+group+': nome pendente)');
   }else if(/^(?:espos[ao]|noiv[ao]|pai|m[aã]e|noiv[ao]\s+de\s+.+)$/i.test(value)){
    named.push(value+' ('+group+': nome pendente)');
   }else named.push(value);
  }
  if(named.length>countAdults+countChildren||unnamedChildren.length>countChildren){
   skipped.push(group);continue;
  }
  const adults=named.slice(0,countAdults),children=named.slice(countAdults).concat(unnamedChildren);
  while(adults.length<countAdults)
   adults.push('Adulto '+(adults.length+1)+' ('+group+': nome pendente)');
  while(children.length<countChildren)
   children.push('Criança '+(children.length+1)+' ('+group+': nome pendente)');
  if(children.length!==countChildren){skipped.push(group);continue;}
  const members=[...adults.map(name=>({name,person_type:'adult'})),
                 ...children.map(name=>({name,person_type:'child'}))];
  result.push({group_label:group,primary_name:members[0].name,members,source_lines:[]});
 }
 if(!seen)return null;
 Object.defineProperty(result,'skippedGroups',{value:skipped,enumerable:false,configurable:true});
 return result;
}
// Extract a PDF table using text coordinates. Keeps individual columns separate,
// unlike joining an entire printed row into one unclassifiable guest name.
export function pdfTableRows(blocks){
 const ordered=[...(blocks||[])].sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x);
 const lines=[];
 for(const item of ordered){
  let line=lines[lines.length-1];
  if(!line||Math.abs(line.y-item.y)>4){line={y:item.y,items:[]};lines.push(line);}
  line.items.push(item);
 }
 const rows=[];
 let colPositions=null,lastData=null,seen=false;
 for(const line of lines){
  const items=line.items.sort((a,b)=>a.x-b.x);
  const text=items.map(i=>i.s).join(' ').toLowerCase();
  if(text.includes('grupo / nome do convite')&&text.includes('pessoas inclu')){
   const find=part=>items.find(i=>fold(i.s).includes(part))?.x;
   const positions=['nº','grupo / nome','pessoas inclui','adultos','criancas','total'].map(find);
   if(positions.some(x=>!Number.isFinite(x))){colPositions=null;continue;}
   colPositions=positions;seen=true;lastData=null;
   rows.push(['Nº','Grupo / nome do convite','Pessoas incluídas','Adultos','Crianças','Total']);
   continue;
  }
  if(/(?:fam[ií]lia e amigos da bol[ií]via|quantidade de pessoas por convite)/i.test(text) ||
      (colPositions&&/\bnome\b/.test(text)&&text.includes('adultos')&&text.includes('crianças')&&!text.includes('grupo'))){
   colPositions=null;lastData=null;continue;
  }
  if(!colPositions)continue;
  const cells=['','','','','',''];
  for(const item of items){
   let column=0;
   for(let i=1;i<colPositions.length;i++)
    if(item.x>=colPositions[i]-2)column=i;
   cells[column]+=(cells[column]?' ':'')+item.s;
  }
  const number=cells[0].trim();
  if(/^\d+$/.test(number)){rows.push(cells);lastData=cells;}
  else if(lastData&&(cells[1]||cells[2]||cells[3]||cells[4]||cells[5])){
   // Wrapped content (long family names) belongs to the last numbered row.
   for(let k=1;k<6;k++)if(cells[k])lastData[k]+=(lastData[k]?' ':'')+cells[k];
  }
 }
 return seen?rows:null;
}
export function groupRows(rows){
 if(!rows?.length)return [];
 const table=parseEventCountTable(rows);
 if(table)return table;
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
   const tableRows=pdfTableRows(blocks);
   if(tableRows){rows.push(...tableRows,[]);continue;}
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
export function openGuestImport({event,role,eventId,token,api,toast,modal,esc,onSaved}){
 const base=role==='admin'?'/api/admin/events/'+eventId:'/api/client/'+encodeURIComponent(token);
 let groups=[],file=null,existingNames=new Map(),nameWarnings=[];
 const w=modal('Importar lista de convidados',
  '<p>PDF (inclusive digitalizado via OCR), Excel (.xlsx) ou CSV. O arquivo é analisado neste dispositivo, e você revisa as famílias antes de salvar. O OCR pode demorar e não garante nomes corretos.</p>'+
  '<div class="field"><label>Arquivo</label><input id="guestFile" type="file" accept=".pdf,.xlsx,.csv,.txt,application/pdf,text/csv"></div>'+
  '<div id="importStatus" class="notice">Selecione um arquivo para conferir famílias e integrantes.</div>'+
  '<div id="importPreview"></div><div class="actions" style="margin-top:16px">'+
  '<button id="confirmImport" type="button" class="btn" disabled>Importar famílias revisadas</button>'+
  '<button id="markAdults" type="button" class="btn secondary" hidden>Marcar indefinidos como adultos (somente se confirmado)</button></div>', '',true);
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
  const skipped=groups.skippedGroups||[];
  const placeholders=groups.reduce((n,g)=>n+g.members.filter(m=>/nome pendente/i.test(m.name)).length,0);
  status.textContent=groups.length+' família(s), '+count+' pessoa(s). '+
   (skipped.length?skipped.length+' grupo(s) sem quantidade definida ficaram fora: '+skipped.join(', ')+'. ':'')+
   (placeholders?placeholders+' nome(s) pendente(s) de confirmação. ':'')+
   (unknown?unknown+' pessoa(s) sem classificação. Revise as categorias antes de salvar. ':'')+
   (nameWarnings.length?nameWarnings.length+' nome(s) repetido(s). Corrija os nomes duplicados antes de importar. ':'')+
   ((!unknown&&!nameWarnings.length)?'Confira os nomes e clique em Importar famílias revisadas.':'O botão de importação ficará desativado até resolver as pendências.');
  status.style.borderColor=nameWarnings.length?'#bf7233':'';
  fix.hidden=!unknown;submit.disabled=!groups.length||unknown>0||nameWarnings.length>0||groups.some(g=>!g.primary_name||!g.members.length)||groups.length>300;
  submit.title=submit.disabled?'Revise nomes repetidos, classificações ou famílias vazias. Veja a mensagem acima.':'';
  preview.innerHTML=groups.map((g,i)=>'<section class="card panel import-family" data-group="'+i+'"><label>Família / grupo <input class="family-label" value="'+esc(g.group_label)+'"></label><div class="import-members">'+g.members.map((m,k)=>
   '<div class="import-member" data-member="'+k+'"><label class="import-member-name"><span>Nome do integrante</span><input class="import-name" aria-label="Nome do integrante" value="'+esc(m.name)+'"></label>'+
   '<label class="import-member-kind"><span>Classificação</span><select class="import-kind" aria-label="Classificação do integrante"><option value="unknown" '+(m.person_type==='unknown'?'selected':'')+'>A conferir</option><option value="adult" '+(m.person_type==='adult'?'selected':'')+'>Adulto</option><option value="child" '+(m.person_type==='child'?'selected':'')+'>Criança</option></select></label>'+
   '<button type="button" class="btn secondary small remove-member" aria-label="Remover integrante">Remover</button></div>').join('')+
   '</div>'+nameWarnings.filter(w=>w.i===i).map(w=>'<div class="notice" style="margin:8px 0;color:#9c4b2b"><strong>Nome igual: '+esc(w.name)+'</strong><p>'+esc(w.details)+'</p></div>').join('')+'<div class="actions"><button class="btn secondary small add-member" type="button">+ Integrante</button><button class="btn secondary small remove-family" type="button">Remover família</button></div></section>').join('');
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
  const placeholders=rows.flatMap(g=>g.members.filter(m=>/nome pendente/i.test(m.name)));
  const skipped=groups.skippedGroups||[];
  if((placeholders.length||skipped.length)&&!confirm(
   'Revisão necessária: '+placeholders.length+' pessoa(s) estão identificadas como nome pendente e '+
   skipped.length+' família(s) sem quantidade definida não serão importadas.\n\n'+
   'Os nomes pendentes são apenas identificadores temporários, não os nomes reais. Deseja continuar com esta lista revisada?'
  ))return;
  submit.disabled=true;
  try{
   const r=await api(base+'/import',{method:'POST',body:JSON.stringify({rows,file_name:file?.name||'Lista',source_type:file?.name.split('.').pop()||'arquivo'})});
   if(r.failed?.length)toast(r.created.length+' famílias importadas. '+r.failed.length+' registros ignorados por duplicidade ou erro.',true);
   else toast(r.created.length+' família(s) importada(s).');
   w.closeModal();onSaved?.();
  }catch(err){submit.disabled=false;toast(err.message,true);}
 };
}