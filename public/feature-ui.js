const safe=(s)=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toBytes=s=>Uint8Array.from(atob(String(s).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const toBase64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const credentialJSON=credential=>credential.toJSON?.()||{
 id:credential.id,rawId:toBase64(credential.rawId),type:'public-key',
 response:Object.fromEntries(Object.entries({
  clientDataJSON:credential.response.clientDataJSON,
  attestationObject:credential.response.attestationObject,
  authenticatorData:credential.response.authenticatorData,
  signature:credential.response.signature,
  userHandle:credential.response.userHandle
 }).filter(([,v])=>v!=null).map(([k,v])=>[k,toBase64(v)]))
};
function registerOptions(options){
 if(PublicKeyCredential.parseCreationOptionsFromJSON)return PublicKeyCredential.parseCreationOptionsFromJSON(options);
 return {...options,challenge:toBytes(options.challenge),user:{...options.user,id:toBytes(options.user.id)},
  excludeCredentials:(options.excludeCredentials||[]).map(x=>({...x,id:toBytes(x.id)}))};
}
function loginOptions(options){
 if(PublicKeyCredential.parseRequestOptionsFromJSON)return PublicKeyCredential.parseRequestOptionsFromJSON(options);
 return {...options,challenge:toBytes(options.challenge),allowCredentials:(options.allowCredentials||[]).map(x=>({...x,id:toBytes(x.id)}))};
}
const supported=()=>window.isSecureContext&&'credentials' in navigator&&'PublicKeyCredential' in window;
export async function passkeyLogin({api,toast,onSuccess}){
 if(!supported())return toast('Seu navegador precisa de HTTPS e suporte a passkeys.',true);
 try{
  const start=await api('/api/admin/passkeys/login/options',{method:'POST',body:'{}'});
  const assertion=await navigator.credentials.get({publicKey:loginOptions(start.options)});
  await api('/api/admin/passkeys/login/verify',{method:'POST',body:JSON.stringify({challenge_id:start.challenge_id,response:credentialJSON(assertion)})});
  toast('Acesso autorizado.');await onSuccess();
 }catch(e){toast(e.message||'Digital não reconhecida.',true);}
}
export async function passkeysModal({api,modal,toast}){
 const w=modal('Entrar com digital / reconhecimento facial',
 '<p>Cadastre a segurança do seu celular enquanto estiver conectada com a senha. A biometria nunca sai do aparelho.</p>'+
 '<button class="btn block" id="registerDevice">Cadastrar este dispositivo</button><div id="devices"></div>');
 const render=async()=>{
  const r=await api('/api/admin/passkeys');
  w.querySelector('#devices').innerHTML=r.passkeys.length?r.passkeys.map(k=>
   '<div class="setting-card"><strong>'+safe(k.label)+'</strong> <button type="button" class="btn secondary small remove-key" data-id="'+safe(k.id)+'">Remover</button></div>').join(''):'<p>Nenhum dispositivo cadastrado.</p>';
  w.querySelectorAll('.remove-key').forEach(b=>b.onclick=async()=>{
   if(!confirm('Remover este dispositivo?'))return;
   await api('/api/admin/passkeys/delete',{method:'POST',body:JSON.stringify({id:b.dataset.id})});render();
  });
 };
 w.querySelector('#registerDevice').onclick=async()=>{
  if(!supported())return toast('Passkeys indisponíveis neste navegador.',true);
  try{
   const x=await api('/api/admin/passkeys/register/options',{method:'POST',body:'{}'});
   const credential=await navigator.credentials.create({publicKey:registerOptions(x.options)});
   await api('/api/admin/passkeys/register/verify',{method:'POST',body:JSON.stringify({
    challenge_id:x.challenge_id,response:credentialJSON(credential),label:'Meu dispositivo'
   })});
   toast('Digital cadastrada.');await render();
  }catch(e){toast(e.message||'Não foi possível cadastrar.',true);}
 };
 await render();
}
export async function showImportHistory({base,api,modal,toast,onSaved}){
 const {imports}=await api(base+'/imports');
 const w=modal('Histórico das importações',imports.length?imports.map(i=>
  '<div class="setting-card"><div><strong>'+safe(i.file_name)+'</strong><div class="subtle">'+safe(new Date(i.created_at).toLocaleString('pt-BR'))+'</div></div>'+
  (i.undone_at?'<span>Desfeita</span>':'<button class="btn secondary small undo" data-id="'+safe(i.id)+'">Desfazer</button>')+'</div>').join(''):'Nenhuma importação registrada.');
 w.querySelectorAll('.undo').forEach(b=>b.onclick=async()=>{
  if(!confirm('Desfazer apenas as famílias desta importação que ainda não foram alteradas ou confirmadas?'))return;
  try{
   const result=await api(base+'/imports/'+encodeURIComponent(b.dataset.id)+'/undo',{method:'POST',body:'{}'});
   toast(result.undone+' famílias desfeitas. '+(result.remaining?result.remaining+' preservadas por terem alterações ou confirmações.':''));
   w.closeModal();onSaved?.();
  }catch(e){toast(e.message,true);}
 });
}
export async function mountFeatureSettings({root,event,api,toast,modal}){
 const panel=document.createElement('section');panel.className='card panel';panel.style.marginTop='16px';panel.innerHTML=
 '<h3>Controle de vagas e entrada</h3><p>Capacidade geral, lista de espera e QR Code são opcionais.</p>'+
 '<div class="grid two"><label>Capacidade máxima da festa<input id="eventCapacity" type="number" min="1" placeholder="Sem limite"></label>'+
 '<label>Check-in<select id="checkinMode"><option value="off">Desativado</option><option value="family">Por família</option><option value="individual">Por pessoa</option></select></label></div>'+
 '<label><input type="checkbox" id="enableWaitlist"> Permitir lista de espera ao atingir a capacidade</label>'+
 '<div class="actions" style="margin:12px 0"><button class="btn" id="saveExtra">Salvar regras</button><button class="btn secondary" id="openCheckin">Abrir check-in</button><button class="btn secondary" id="openQueue">Lista de espera</button><button class="btn secondary" id="staffAccess">Acesso da recepção</button></div><div id="extraDetail"></div>';
 root.append(panel);
 const base='/api/admin/events/'+event.id,data=await api(base+'/features'),rules=data.settings;
 panel.querySelector('#eventCapacity').value=rules.max_capacity||'';
 panel.querySelector('#enableWaitlist').checked=rules.waitlist_enabled;
 panel.querySelector('#checkinMode').value=rules.checkin_mode||'off';
 const detail=panel.querySelector('#extraDetail');
 panel.querySelector('#saveExtra').onclick=async()=>{
  try{
   await api(base+'/features',{method:'PATCH',body:JSON.stringify({
    max_capacity:panel.querySelector('#eventCapacity').value,
    checkin_mode:panel.querySelector('#checkinMode').value,
    waitlist_enabled:panel.querySelector('#enableWaitlist').checked
   })});toast('Regras atualizadas.');}
  catch(e){toast(e.message,true);}
 };
 panel.querySelector('#openCheckin').onclick=()=>showAdminCheckin({base,api,modal,toast});
 panel.querySelector('#openQueue').onclick=async()=>{
  const r=await api(base+'/waitlist');
  detail.innerHTML='<h4>Famílias na espera</h4>'+(r.waitlist.length?r.waitlist.map(w=>
   '<div class="setting-card"><strong>'+safe(w.display_name)+'</strong> · '+w.people_count+' pessoas · '+safe(w.status)+
   (w.status==='waiting'?'<div class="actions"><button class="btn small promote" data-id="'+safe(w.id)+'">Liberar vagas</button><button class="btn secondary small cancel" data-id="'+safe(w.id)+'">Cancelar</button></div>':'')+'</div>').join(''):'<p>Nenhuma família aguardando vaga.</p>');
  detail.querySelectorAll('.promote,.cancel').forEach(btn=>btn.onclick=async()=>{
   try{await api(base+'/waitlist/'+btn.dataset.id+'/'+(btn.classList.contains('promote')?'promote':'cancel'),{method:'POST',body:'{}'});toast('Lista de espera atualizada.');panel.querySelector('#openQueue').click();}
   catch(e){toast(e.message,true);}
  });
 };
 panel.querySelector('#staffAccess').onclick=async()=>{
  const existing=await api(base+'/reception');
  const w=modal('Equipe de recepção',
   '<p>Crie um link restrito à entrada deste evento. O acesso vence automaticamente e pode ser revogado.</p>'+
   '<label>Nome da pessoa/equipe<input id="staffLabel" value="Recepção"></label><label>Validade em dias<input type="number" id="staffDays" value="2" min="1" max="30"></label>'+
   '<button class="btn block" id="makeStaff">Gerar link restrito</button><div id="staffResult"></div>'+
   existing.access.map(a=>'<div class="setting-card"><strong>'+safe(a.label)+'</strong> '+(a.revoked_at?'(revogado)':'')+
   (!a.revoked_at?'<button class="btn secondary small revoke" data-id="'+safe(a.id)+'">Revogar</button>':'')+'</div>').join(''));
  w.querySelector('#makeStaff').onclick=async()=>{
   try{const r=await api(base+'/reception',{method:'POST',body:JSON.stringify({label:w.querySelector('#staffLabel').value,days:Number(w.querySelector('#staffDays').value)})});
    w.querySelector('#staffResult').innerHTML='<p>Copie agora. Por segurança, o link completo não será exibido novamente.</p><input readonly value="'+safe(r.url)+'"><button id="copyStaff" class="btn secondary">Copiar</button>';
    w.querySelector('#copyStaff').onclick=()=>navigator.clipboard.writeText(r.url).then(()=>toast('Link copiado.'));
   }catch(e){toast(e.message,true);}
  };
  w.querySelectorAll('.revoke').forEach(b=>b.onclick=async()=>{await api(base+'/reception/'+b.dataset.id+'/revoke',{method:'POST',body:'{}'});b.disabled=true;toast('Acesso revogado.');});
 };
}
async function showAdminCheckin({base,api,modal,toast}){
 const r=await api(base+'/checkin'),codes=await api(base+'/qr-list');
 const w=modal('Check-in · '+r.event.title,
 '<p>O QR é conferido antes de registrar a entrada. Busca manual disponível.</p>'+
 '<div class="actions"><button class="btn" id="cameraStart">Abrir câmera</button><button class="btn secondary" id="cameraStop" hidden>Parar</button></div>'+
 '<video id="scannerVideo" autoplay playsinline muted style="width:100%;max-height:260px" hidden></video>'+
 '<label>Código ou link do QR<input id="manualQr" placeholder="Cole o código"></label>'+
 '<button class="btn" id="checkCode">Conferir QR</button><div id="qrPreview"></div>'+
 '<h4>Buscar família / convidado</h4><input id="filterPeople" placeholder="Filtrar nome"><div id="checkinPeople">'+
 codes.groups.map(g=>'<div class="setting-card" data-search="'+safe(g.name.toLowerCase())+'"><strong>'+safe(g.name)+'</strong>'+g.qr.map(x=>
 '<div><span>'+safe(x.name)+'</span> <a href="'+safe(x.url)+'" target="_blank" rel="noopener">Ver QR</a> <button class="btn secondary small by-code" data-code="'+safe(x.url.split('/').pop())+'">Conferir entrada</button></div>').join('')+'</div>').join('')+'</div><p>Entradas registradas: '+r.checkins.length+'</p>', '',true);
 let stream=null,running=false;
 const stop=()=>{running=false;stream?.getTracks().forEach(t=>t.stop());stream=null;w.querySelector('#scannerVideo')?.setAttribute('hidden','');w.querySelector('#cameraStop').hidden=true;};
 const preview=w.querySelector('#qrPreview');
 const inspect=async code=>{
  code=String(code||'').trim().split('/').pop();const data=await api('/api/q/'+encodeURIComponent(code));
  preview.innerHTML='<div class="notice"><strong>'+safe(data.name)+'</strong><p>'+safe(data.event_title)+'</p>'+
   (data.checked_in?'<p>Entrada já registrada.</p>':'<button class="btn" id="acceptQr">Confirmar entrada</button>')+'</div>';
  preview.querySelector('#acceptQr')?.addEventListener('click',async()=>{
   try{const r=await api(base+'/checkin',{method:'POST',body:JSON.stringify({token:code})});toast(r.already_checked_in?'Já registrado.':'Entrada registrada.');preview.innerHTML='';}
   catch(e){toast(e.message,true);}
  });
 };
 w.querySelector('#checkCode').onclick=()=>inspect(w.querySelector('#manualQr').value).catch(e=>toast(e.message,true));
 w.querySelectorAll('.by-code').forEach(b=>b.onclick=()=>inspect(b.dataset.code).catch(e=>toast(e.message,true)));
 w.querySelector('#filterPeople').oninput=e=>w.querySelectorAll('[data-search]').forEach(el=>el.hidden=!el.dataset.search.includes(e.target.value.toLowerCase()));
 w.querySelector('#cameraStop').onclick=stop;
 w.querySelector('#cameraStart').onclick=async()=>{
  if(!('BarcodeDetector'in window))return toast('Leitura automática não disponível. Use a busca pelo nome ou código.',true);
  try{
   stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
   const video=w.querySelector('#scannerVideo');video.srcObject=stream;video.hidden=false;w.querySelector('#cameraStop').hidden=false;
   await video.play();running=true;const detector=new BarcodeDetector({formats:['qr_code']});
   const loop=async()=>{if(!running||!w.isConnected)return stop();try{const found=await detector.detect(video);if(found.length){stop();await inspect(found[0].rawValue);return;}}catch{}setTimeout(loop,260);};loop();
  }catch(e){stop();toast('Não foi possível abrir a câmera.',true);}
 };
}
export async function receptionPage({token,api,app,toast}){
 const root=document.createElement('main');root.className='shell';app.innerHTML='';app.append(root);
 const load=async()=>{
  try{
   const r=await api('/api/recepcao/'+encodeURIComponent(token));
   root.innerHTML='<section class="card panel"><h1>Recepção · '+safe(r.event.title)+'</h1><p>Entradas: '+r.checkins.length+'</p>'+
    '<input id="receptionSearch" placeholder="Buscar família ou convidado"><div id="receptionPeople">'+r.guests.filter(g=>g.response_status==='yes').map(g=>
    '<div class="setting-card" data-search="'+safe((g.group_label||g.primary_name).toLowerCase())+'"><strong>'+safe(g.group_label||g.primary_name)+'</strong>'+
    (r.event.checkin_mode==='family'?'<button class="btn small entry" data-guest="'+safe(g.id)+'">Registrar família</button>':
     r.members.filter(m=>m.guest_id===g.id).map(m=>'<button class="btn small entry" data-guest="'+safe(g.id)+'" data-member="'+safe(m.id)+'">Entrada: '+safe(m.name)+'</button>').join(''))+'</div>').join('')+'</div>'+
    '<label>Código QR<input id="receptionQr"></label><button id="receptionCode" class="btn secondary">Conferir e registrar código</button>'+
    '<div id="receptionConfirm"></div></section>';
   root.querySelector('#receptionSearch').oninput=e=>root.querySelectorAll('[data-search]').forEach(el=>el.hidden=!el.dataset.search.includes(e.target.value.toLowerCase()));
   const check=async b=>{
    if(!confirm('Registrar esta entrada?'))return;
    const result=await api('/api/recepcao/'+encodeURIComponent(token)+'/checkin',{method:'POST',body:JSON.stringify(b)});
    toast(result.already_checked_in?'Entrada já registrada.':'Entrada registrada.');await load();
   };
   root.querySelectorAll('.entry').forEach(b=>b.onclick=()=>check({guest_id:b.dataset.guest,member_id:b.dataset.member}).catch(e=>toast(e.message,true)));
   root.querySelector('#receptionCode').onclick=()=>check({token:root.querySelector('#receptionQr').value.split('/').pop()}).catch(e=>toast(e.message,true));
  }catch(e){root.innerHTML='<section class="card panel"><h1>Acesso indisponível</h1><p>'+safe(e.message)+'</p></section>';}
 };
 await load();
}
export async function publicQrPage({code,api,app}){
 try{
  const d=await api('/api/q/'+encodeURIComponent(code));
  app.innerHTML='<main class="shell"><section class="card panel" style="max-width:450px;margin:24px auto;text-align:center"><h1>Entrada · '+safe(d.name)+'</h1><p>'+safe(d.event_title)+'</p><img style="width:min(100%,320px)" src="/api/qr-svg/'+encodeURIComponent(code)+'" alt="QR de entrada">'+
   '<p>'+ (d.checked_in?'Entrada já registrada.':'Mostre este QR na recepção da festa.')+'</p></section></main>';
 }catch(e){app.innerHTML='<main class="shell"><section class="card panel"><h1>QR indisponível</h1><p>'+safe(e.message)+'</p></section></main>';}
}
