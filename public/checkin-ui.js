import {startUniversalQR,extractQrToken} from './qr-scanner.js';
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function summaryMarkup(s={}){
 return '<div class="grid two" style="margin:10px 0">'+
  [['Confirmadas','confirmed'],['Já chegaram','present'],['Ainda não chegaram','not_arrived'],['Adultos presentes','present_adults'],['Crianças presentes','present_children'],['Check-ins realizados','entries']]
   .map(([title,key])=>'<div class="setting-card" style="padding:10px"><small>'+title+'</small><strong style="display:block;font-size:22px">'+Number(s[key]||0)+'</strong></div>').join('')+'</div>';
}
const canScan=()=>Boolean(navigator.mediaDevices?.getUserMedia);
async function withCamera({root,videoId,startId,stopId,toast,onRead}){
 let stop=null;
 const video=root.querySelector('#'+videoId),start=root.querySelector('#'+startId),end=root.querySelector('#'+stopId);
 const off=()=>{stop?.();stop=null;if(video)video.hidden=true;if(end)end.hidden=true;};
 if(end)end.onclick=off;
 if(start)start.onclick=async()=>{
  off();
  if(!canScan())return toast('A câmera não está disponível. Use a busca manual ou cole o QR.',true);
  try{
   if(end)end.hidden=false;
   stop=await startUniversalQR({video,onRead:async code=>{off();await onRead(code);},onStop:()=>{video.hidden=true;if(end)end.hidden=true;},onError:()=>{}});
  }catch(e){off();toast(e.message,true);}
 };
 const watcher=setInterval(()=>{if(!root.isConnected){off();clearInterval(watcher);}},700);
 window.addEventListener('pagehide',off,{once:true});
 return off;
}
function checkinLines(data,{base=null,api,toast,refresh}){
 return data.checkins.map(c=>'<div class="setting-card" style="margin:7px 0"><div><strong>'+safe(c.name)+'</strong><p class="subtle">'+safe(new Date(c.created_at).toLocaleString('pt-BR'))+'</p></div>'+
 (base?'<button class="btn secondary small undo-check" data-id="'+safe(c.id)+'">Desfazer check-in</button>':'')+'</div>').join('')||'<p>Nenhuma entrada registrada.</p>';
}
export async function showAdminCheckin({base,api,modal,toast}){
 const [initial,codes]=await Promise.all([api(base+'/checkin'),api(base+'/qr-list')]);
 const w=modal('Check-in · '+initial.event.title,
 '<p>A câmera só confere o QR. Confirme a entrada após verificar o nome.</p>'+
 '<h3>Entradas ao vivo</h3><div id="liveSummary">'+summaryMarkup(initial.summary)+'</div>'+
 '<div class="actions"><button class="btn" id="cameraStart">Abrir câmera QR</button><button class="btn secondary" id="cameraStop" hidden>Parar câmera</button></div>'+
 '<video id="scannerVideo" autoplay muted playsinline style="width:100%;max-height:270px" hidden></video>'+
 '<label>Código ou link QR<input id="manualQr" placeholder="Cole o QR aqui"></label><button class="btn secondary" id="checkCode">Conferir QR</button><div id="qrPreview"></div>'+
 '<h3>Localizar pessoa ou família</h3><input id="filterPeople" placeholder="Buscar nome">'+
 '<div id="checkinPeople">'+codes.groups.map(g=>
  '<div class="setting-card" data-search="'+safe((g.name+' '+g.qr.map(x=>x.name).join(' ')).toLowerCase())+'"><strong>'+safe(g.name)+'</strong>'+
  g.qr.map(x=>'<div style="margin:5px 0"><span>'+safe(x.name)+'</span> <a href="'+safe(x.url)+'" target="_blank" rel="noopener">Ver ou salvar QR</a> <button class="btn secondary small by-code" data-code="'+safe(x.url.split('/').pop())+'">Conferir</button></div>').join('')+'</div>').join('')+'</div>'+
 '<h3>Entradas recentes <small>(atualização a cada 8 segundos)</small></h3><div id="recentCheckins"></div>', '',true);
 const status=w.querySelector('#liveSummary'),history=w.querySelector('#recentCheckins'),preview=w.querySelector('#qrPreview');
 let busy=false;
 const paint=data=>{
  status.innerHTML=summaryMarkup(data.summary);
  history.innerHTML=checkinLines(data,{base});
  history.querySelectorAll('.undo-check').forEach(button=>button.onclick=async()=>{
   const reason=prompt('Motivo para desfazer este check-in:','Entrada marcada por engano');
   if(reason===null||!reason.trim())return;
   if(!confirm('Desfazer a entrada? A correção ficará registrada no histórico.'))return;
   try{
    await api(base+'/checkin/'+encodeURIComponent(button.dataset.id)+'/undo',{method:'POST',body:JSON.stringify({confirm:true,reason})});
    toast('Entrada desfeita. O QR poderá ser usado novamente.');await refresh();
   }catch(e){toast(e.message,true);}
  });
 };
 const refresh=async()=>{
  if(!w.isConnected||busy)return;
  busy=true;try{paint(await api(base+'/checkin'));}catch(e){toast('Não foi possível atualizar as entradas.',true);}finally{busy=false;}
 };
 paint(initial);
 const inspect=async value=>{
  const code=extractQrToken(value);
  if(!code)throw Error('Cole um QR do próprio Libri RSVP.');
  const result=await api('/api/q/'+encodeURIComponent(code));
  if(result.event_title!==initial.event.title)throw Error('Este QR pertence a outro evento.');
  preview.innerHTML='<div class="notice"><strong>'+safe(result.name)+'</strong><p>'+safe(result.event_title)+'</p>'+
  (result.checked_in?'<p>Entrada já registrada.</p>':'<button class="btn" id="confirmAdmission">Confirmar entrada</button>')+'</div>';
  preview.querySelector('#confirmAdmission')?.addEventListener('click',async()=>{
   try{const result=await api(base+'/checkin',{method:'POST',body:JSON.stringify({token:code})});
    toast(result.already_checked_in?'A entrada já estava registrada.':'Entrada confirmada.');
    preview.innerHTML='';await refresh();
   }catch(e){toast(e.message,true);}
  });
 };
 w.querySelector('#checkCode').onclick=()=>inspect(w.querySelector('#manualQr').value).catch(e=>toast(e.message,true));
 w.querySelectorAll('.by-code').forEach(button=>button.onclick=()=>inspect(button.dataset.code).catch(e=>toast(e.message,true)));
 w.querySelector('#filterPeople').oninput=e=>w.querySelectorAll('[data-search]').forEach(row=>row.hidden=!row.dataset.search.includes(e.target.value.trim().toLowerCase()));
 await withCamera({root:w,videoId:'scannerVideo',startId:'cameraStart',stopId:'cameraStop',toast,onRead:code=>inspect(code).catch(e=>toast(e.message,true))});
 const interval=setInterval(()=>{if(!w.isConnected){clearInterval(interval);return;}if(document.visibilityState==='visible')refresh();},8000);
}
export async function receptionPage({token,api,app,toast}){
 const root=document.createElement('main');root.className='shell';app.replaceChildren(root);
 const base='/api/recepcao/'+encodeURIComponent(token);
 let stopCamera=null,liveTimer=null,currentEventId=null;
 const cleanup=()=>{stopCamera?.();if(liveTimer)clearInterval(liveTimer);};
 window.addEventListener('pagehide',cleanup,{once:true});
 async function populate(){
  const initial=await api(base);
  currentEventId=initial.event.id;
  root.innerHTML='<section class="card panel"><h1>Recepção · '+safe(initial.event.title)+'</h1>'+
   '<p>Esta tela dá acesso somente à entrada desta festa.</p><div id="receptionLive">'+summaryMarkup(initial.summary)+'</div>'+
   '<div class="actions"><button id="staffStart" class="btn">Abrir câmera QR</button><button id="staffStop" class="btn secondary" hidden>Parar câmera</button></div>'+
   '<video id="staffVideo" autoplay muted playsinline style="width:100%;max-height:270px" hidden></video>'+
   '<label>QR ou link<input id="receptionQr" placeholder="Cole o código"></label><button id="receptionCode" class="btn secondary">Conferir QR</button>'+
   '<div id="receptionPreview"></div><h3>Busca manual</h3><input id="receptionSearch" placeholder="Buscar família ou pessoa">'+
   '<div id="receptionPeople">'+initial.guests.filter(g=>g.response_status==='yes').map(g=>
    '<div class="setting-card" data-search="'+safe(((g.group_label||g.primary_name)+' '+initial.members.filter(m=>m.guest_id===g.id).map(m=>m.name).join(' ')).toLowerCase())+'"><strong>'+safe(g.group_label||g.primary_name)+'</strong>'+
    (initial.event.checkin_mode==='family'?'<button class="btn secondary small manual-entry" data-guest="'+safe(g.id)+'">Conferir família</button>':
     initial.members.filter(m=>m.guest_id===g.id).map(m=>'<button class="btn secondary small manual-entry" data-guest="'+safe(g.id)+'" data-member="'+safe(m.id)+'">Conferir '+safe(m.name)+'</button>').join(''))+'</div>').join('')+'</div>'+
   '<h3>Entradas recentes</h3><div id="receptionRecent"></div></section>';
  const paint=r=>{root.querySelector('#receptionLive').innerHTML=summaryMarkup(r.summary);root.querySelector('#receptionRecent').innerHTML=checkinLines(r,{api,toast});};
  paint(initial);
  const refresh=async()=>{if(!root.isConnected)return;try{const r=await api(base);if(r.event.id===currentEventId)paint(r);}catch(e){cleanup();root.innerHTML='<section class="card panel"><h1>Acesso encerrado</h1><p>Este link foi revogado ou expirou.</p></section>';}};
  const check=async payload=>{
   if(!confirm('Confirmar esta entrada?'))return;
   const r=await api(base+'/checkin',{method:'POST',body:JSON.stringify(payload)});
   toast(r.already_checked_in?'Essa entrada já estava registrada.':'Entrada confirmada.');await refresh();
  };
  const inspect=async value=>{
   const code=extractQrToken(value);
   if(!code)throw Error('QR inválido.');
   const r=await api('/api/q/'+encodeURIComponent(code));
   if(r.event_title!==initial.event.title)throw Error('QR de outra festa.');
   const box=root.querySelector('#receptionPreview');
   box.innerHTML='<div class="notice"><strong>'+safe(r.name)+'</strong><p>'+safe(r.event_title)+'</p>'+
    (r.checked_in?'<p>Já entrou.</p>':'<button class="btn" id="receptionAccept">Confirmar entrada</button>')+'</div>';
   box.querySelector('#receptionAccept')?.addEventListener('click',()=>check({token:code}).catch(e=>toast(e.message,true)));
  };
  root.querySelector('#receptionCode').onclick=()=>inspect(root.querySelector('#receptionQr').value).catch(e=>toast(e.message,true));
  root.querySelector('#receptionSearch').oninput=e=>root.querySelectorAll('[data-search]').forEach(row=>row.hidden=!row.dataset.search.includes(e.target.value.toLowerCase()));
  root.querySelectorAll('.manual-entry').forEach(btn=>btn.onclick=()=>{
   const g=initial.guests.find(x=>x.id===btn.dataset.guest);
   const name=btn.dataset.member?initial.members.find(m=>m.id===btn.dataset.member)?.name:(g?.group_label||g?.primary_name);
   if(!confirm('Conferir e registrar entrada de '+name+'?'))return;
   api(base+'/checkin',{method:'POST',body:JSON.stringify({guest_id:btn.dataset.guest,member_id:btn.dataset.member||undefined})}).then(()=>{toast('Entrada registrada.');refresh();}).catch(e=>toast(e.message,true));
  });
  stopCamera=await withCamera({root,videoId:'staffVideo',startId:'staffStart',stopId:'staffStop',toast,onRead:code=>inspect(code).catch(e=>toast(e.message,true))});
  if(liveTimer)clearInterval(liveTimer);
  liveTimer=setInterval(()=>{if(!root.isConnected){cleanup();return;}if(document.visibilityState==='visible')refresh();},8000);
 }
 try{await populate();}catch(e){root.innerHTML='<section class="card panel"><h1>Link de recepção indisponível</h1><p>'+safe(e.message)+'</p></section>';}
}
export async function saveQrPNG(code,filename='entrada-libri'){
 const response=await fetch('/api/qr-svg/'+encodeURIComponent(code),{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('O QR expirou ou foi revogado.');
 const svg=await response.blob(),url=URL.createObjectURL(svg);
 try{
  const img=new Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=900;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Não foi possível gerar o PNG.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,900,900);ctx.drawImage(img,0,0,900,900);
  const file=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!file)throw Error('Não foi possível salvar o QR.');
  const png=URL.createObjectURL(file),a=document.createElement('a');a.href=png;
  a.download=String(filename).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]/gi,'-').slice(0,65)+'.png';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(png),2000);
 }finally{URL.revokeObjectURL(url);}
}
export async function publicQrPage({code,api,app}){
 try{
  const r=await api('/api/q/'+encodeURIComponent(code));
  app.innerHTML='<main class="shell"><section class="card panel" style="max-width:450px;margin:24px auto;text-align:center"><h1>Entrada · '+safe(r.name)+'</h1><p>'+safe(r.event_title)+'</p>'+
   '<img style="width:min(100%,320px)" src="/api/qr-svg/'+encodeURIComponent(code)+'" alt="Código QR de entrada">'+
   '<p>'+(r.checked_in?'Entrada já registrada.':'Apresente este QR na recepção da festa.')+'</p>'+
   '<button class="btn block" id="saveQrPNG">Salvar QR no celular (PNG)</button><p id="qrSaveStatus" role="status"></p></section></main>';
  app.querySelector('#saveQrPNG').onclick=async()=>{
   const status=app.querySelector('#qrSaveStatus');
   try{await saveQrPNG(code,'qr-'+r.name);status.textContent='Imagem preparada. Procure em Downloads ou Arquivos do celular.';}
   catch(e){status.textContent=e.message;}
  };
 }catch(e){app.innerHTML='<main class="shell"><section class="card panel"><h1>QR indisponível</h1><p>'+safe(e.message)+'</p></section></main>';}
}
