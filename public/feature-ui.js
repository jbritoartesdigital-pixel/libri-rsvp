import {showAdminCheckin} from './checkin-ui.js?v=20261009-mobile-ocr-qr-readable-v4';
export {receptionPage,publicQrPage} from './checkin-ui.js?v=20261009-mobile-ocr-qr-readable-v4';
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
 '<label class="feature-waitlist-toggle"><input type="checkbox" id="enableWaitlist"><span>Permitir lista de espera ao atingir a capacidade</span></label>'+
 '<div class="actions" style="margin:12px 0"><button class="btn" id="saveExtra">Salvar regras</button><button class="btn secondary" id="openCheckin">Abrir check-in</button><button class="btn secondary" id="openQueue">Lista de espera</button><button class="btn secondary" id="staffAccess">Acesso da recepção</button><button class="btn secondary" id="privacyCleanup">Privacidade após a festa</button></div><div id="extraDetail"></div>';
 root.append(panel);
 const base='/api/admin/events/'+event.id,data=await api(base+'/features'),rules=data.settings;
 panel.querySelector('#eventCapacity').value=rules.max_capacity||'';
 panel.querySelector('#enableWaitlist').checked=rules.waitlist_enabled;
 panel.querySelector('#checkinMode').value=rules.checkin_mode||'off';
 const detail=panel.querySelector('#extraDetail');
 panel.querySelector('#privacyCleanup').onclick=()=>privacyCleanupModal({base,api,toast,modal});
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

async function privacyCleanupModal({base,api,toast,modal}){
 try{
  const d=await api(base+'/privacy'),counts=d.counts;
  const w=modal('Privacidade e limpeza após a festa',
   '<p>Remova os dados pessoais de convidados após o período definido. A exclusão é permanente. Exporte sua lista CSV antes.</p>'+
   '<p><strong>Evento:</strong> '+safe(d.event.title)+'</p>'+
   '<p><strong>Data:</strong> '+safe(d.event.event_date||'Não informada')+'</p>'+
   '<p><strong>Prazo mínimo:</strong> '+safe(d.due_date||'Indisponível')+'</p>'+
   '<p><strong>Cadastros:</strong> '+counts.guests+' | <strong>Pessoas:</strong> '+counts.guest_members+
   ' | <strong>Entradas:</strong> '+counts.event_checkins+' | <strong>Espera:</strong> '+counts.waitlist_entries+'</p>'+
   '<div class="field"><label>Dias após a data da festa (1 a 3650)</label><input id="retentionDays" type="number" min="1" max="3650" value="'+safe(d.event.retention_days??1)+'"></div>'+
   '<button class="btn secondary" id="saveRetention">Salvar prazo de retenção</button>'+
   '<div class="notice" style="margin-top:16px"><strong>'+safe(d.eligible?'Exclusão disponível após confirmação':'Exclusão indisponível no momento')+'</strong><p>'+safe(d.reason||'Apaga convidados, membros, respostas, check-ins, links da recepção, filas e registros pessoais. Mantém o cadastro do evento e artes R2.')+'</p></div>'+
   '<p>Para confirmar, digite exatamente o identificador <strong>'+safe(d.event.slug)+'</strong> e depois a frase <strong>EXCLUIR DADOS</strong>.</p>'+
   '<div class="field"><label>Identificador</label><input id="purgeSlug" autocomplete="off"></div>'+
   '<div class="field"><label>Frase de confirmação</label><input id="purgePhrase" autocomplete="off"></div>'+
   '<button id="purgeGuestData" class="btn danger block" '+(!d.eligible?'disabled':'')+'>Excluir definitivamente dados pessoais deste evento</button>', '',true);
  w.querySelector('#saveRetention').onclick=async()=>{
   const days=Number(w.querySelector('#retentionDays').value);
   try{await api(base+'/privacy/settings',{method:'PATCH',body:JSON.stringify({retention_days:days})});
    toast('Prazo salvo. Abra esta tela novamente para consultar a nova data de liberação.');w.closeModal();
   }catch(e){toast(e.message,true);}
  };
  w.querySelector('#purgeGuestData').onclick=async()=>{
   const slug=w.querySelector('#purgeSlug').value.trim(),phrase=w.querySelector('#purgePhrase').value.trim();
   if(slug!==d.event.slug||phrase!=='EXCLUIR DADOS')return toast('Preencha as duas confirmações exatamente.',true);
   if(!confirm('Esta ação é IRREVERSÍVEL. Já exportou seus dados? Confirmar exclusão definitiva?'))return;
   const button=w.querySelector('#purgeGuestData');button.disabled=true;
   try{const result=await api(base+'/privacy/cleanup',{method:'POST',body:JSON.stringify({confirm_slug:slug,confirm_text:phrase})});
    toast(result.counts.guests+' cadastros removidos. O evento foi arquivado.');w.closeModal();
   }catch(e){button.disabled=false;toast(e.message,true);}
  };
 }catch(e){toast(e.message,true);}
}
