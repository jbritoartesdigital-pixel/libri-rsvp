const app=document.querySelector("#app"),toastEl=document.querySelector("#toast"),path=location.pathname;
let toastTimer,suggestTimer,appearanceDirty=false,activeInterfaceLanguage="pt-BR";

const RSVP_EMBED_MODE=new URLSearchParams(location.search).get("embed")==="1";
const RSVP_EMBED_ALLOWED_ORIGINS=new Set([
 "https://libriconvites.com.br",
 "https://www.libriconvites.com.br"
]);

if(RSVP_EMBED_MODE){
 document.documentElement.dataset.libriRsvpEmbed="1";
}

function postRsvpEmbedMessage(type,payload={}){
 if(!RSVP_EMBED_MODE||window.parent===window)return false;

 const message={
  source:"libri-rsvp",
  type,
  ...payload
 };

 const targets=[];

 try{
  const refOrigin=new URL(document.referrer).origin;
  if(RSVP_EMBED_ALLOWED_ORIGINS.has(refOrigin))targets.push(refOrigin);
 }catch{}

 if(!targets.length){
  targets.push(...RSVP_EMBED_ALLOWED_ORIGINS);
 }

 for(const origin of [...new Set(targets)]){
  try{
   window.parent.postMessage(message,origin);
  }catch{}
 }

 return true;
}

const DEFAULT_APPEARANCE={background_color:"#f8efec",card_color:"#fffaf7",text_color:"#4f2d2a",muted_color:"#866e68",button_color:"#b8735f",button_text_color:"#ffffff",overlay_color:"#3a1f1b",overlay_opacity:.18,card_opacity:.94,card_blur:12,card_radius:28,font_style:"elegant",card_style:"glass",background_position:"center",background_x:"center",card_width:"medium",interface_language:"pt-BR",invitation_url:"",calendar_location:"",calendar_end_time:"",cover_url:"",logo_url:""};
const DEFAULT_TEXTS={eyebrow:"Confirmação de presença",intro:"Confirme sua presença para que tudo seja preparado com carinho.",lookup_label:"Digite seu nome",lookup_placeholder:"Comece a digitar seu nome",yes_button:"Sim, estarei presente!",no_button:"Não poderei comparecer",message_label:"Deixe uma mensagem carinhosa 💌",message_placeholder:"Uma mensagem especial para quem está celebrando...",success_title:"Presença confirmada!",success_message:"Que bom ter você com a gente. 💛",decline_title:"Resposta registrada",decline_message:"Obrigada por avisar.",decline_hint:"Tudo bem 💛 Se quiser, você ainda pode deixar uma mensagem carinhosa abaixo.",name_label:"Seu nome",calendar_button:"Adicionar à agenda",back_button:"Voltar ao convite",closed_title:"Confirmações encerradas"};
const DEFAULT_TEXTS_EN={eyebrow:"RSVP",intro:"Please confirm your attendance so everything can be prepared with care.",lookup_label:"Enter your name",lookup_placeholder:"Start typing your name",yes_button:"Yes, I'll be there!",no_button:"I won't be able to attend",message_label:"Leave a sweet message 💌",message_placeholder:"A special message for the celebration...",success_title:"Attendance confirmed!",success_message:"We're so happy you'll be there. 💛",decline_title:"Response received",decline_message:"Thank you for letting us know.",decline_hint:"That's okay 💛 If you'd like, you can still leave a message below.",name_label:"Your name",calendar_button:"Add to calendar",back_button:"Back to invitation",closed_title:"RSVP closed"};
const DEFAULT_PERMS={manage_guests:true,manage_appearance:true,manage_texts:true,view_messages:true,export_guests:true,manage_event_details:false};

const esc=(v="")=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const fmtDate=v=>fmtDateLang(v,"pt-BR");
const fmtDT=v=>fmtDTLang(v,"pt-BR");
const safeAppearance=e=>({...DEFAULT_APPEARANCE,...(e?.appearance_settings||{})});
const eventLang=e=>safeAppearance(e).interface_language==="en"?"en":"pt-BR";
const setActiveLanguage=lang=>{activeInterfaceLanguage=lang==="en"?"en":"pt-BR";document.documentElement.lang=activeInterfaceLanguage==="en"?"en":"pt-BR"};
const tr=(lang,pt,en)=>lang==="en"?en:pt;
const localeFor=lang=>lang==="en"?"en-US":"pt-BR";
const defaultTextsFor=lang=>lang==="en"?DEFAULT_TEXTS_EN:DEFAULT_TEXTS;
const safeTexts=e=>({...defaultTextsFor(eventLang(e)),...(e?.public_texts||{})});
const safePerms=e=>({...DEFAULT_PERMS,...(e?.client_permissions||{})});
const fmtDateLang=(v,lang="pt-BR")=>{if(!v)return tr(lang,"Data não informada","Date not provided");try{return new Intl.DateTimeFormat(localeFor(lang),{dateStyle:"medium"}).format(new Date(`${v}T12:00:00`))}catch{return v}};
const fmtDTLang=(v,lang="pt-BR")=>{if(!v)return"";try{return new Intl.DateTimeFormat(localeFor(lang),{dateStyle:"short",timeStyle:"short"}).format(new Date(v))}catch{return v}};
const statusLabel=(s,lang="pt-BR")=>s==="yes"?tr(lang,"Confirmado","Confirmed"):s==="no"?tr(lang,"Não irá","Not attending"):tr(lang,"Aguardando","Pending");
const attendanceLabel=(s,lang="pt-BR")=>s==="yes"?tr(lang,"Vai","Attending"):s==="no"?tr(lang,"Não vai","Not attending"):tr(lang,"Aguardando","Pending");
const sourceLabel=(s,lang="pt-BR")=>({admin:"Libri",client:tr(lang,"Cliente","Client"),public:tr(lang,"Convidado","Guest"),import:tr(lang,"Importação","Import")}[s]||s||"—");

function translateServerMessage(message,lang=activeInterfaceLanguage){
 if(lang!=="en")return message||"";
 let m=String(message||"");
 const exact={
  "Não foi possível concluir.":"Unable to complete the request.",
  "Acesso inválido.":"Invalid access.",
  "Este link não é válido ou foi substituído.":"This private link is invalid or has been replaced.",
  "Convidado não encontrado.":"Guest not found.",
  "Convidado não encontrado neste evento.":"Guest not found for this event.",
  "Digite seu nome.":"Enter your name.",
  "Informe seu nome.":"Enter your name.",
  "Informe pelo menos uma pessoa que irá à festa.":"Please add at least one person who will attend.",
  "Escolha se poderá comparecer.":"Please choose whether you will attend.",
  "Localize seu nome na lista antes de confirmar.":"Find your name on the guest list before submitting your RSVP.",
  "Não encontramos esse nome na lista. Confira a escrita ou fale com o anfitrião.":"We couldn't find that name on the guest list. Check the spelling or contact the host.",
  "Este evento não utiliza lista pré-cadastrada.":"This event does not use a pre-registered guest list.",
  "Pessoas pré-cadastradas não podem ser removidas pelo convite.":"Pre-registered guests cannot be removed from the invitation.",
  "Este convite permite confirmar apenas as pessoas já cadastradas.":"This invitation only allows RSVP for pre-registered guests.",
  "As confirmações deste evento estão encerradas.":"RSVPs for this event are closed.",
  "As confirmações estão temporariamente pausadas.":"RSVPs are temporarily paused.",
  "O prazo para confirmação de presença foi encerrado.":"The RSVP deadline has passed.",
  "A personalização visual está bloqueada para este evento.":"Visual customization is disabled for this event.",
  "A edição dos textos está bloqueada para este evento.":"Text editing is disabled for this event.",
  "A edição dos dados do evento está bloqueada.":"Event details editing is disabled.",
  "Esta função está bloqueada para o painel da cliente.":"This feature is disabled for the private dashboard.",
  "Use imagem JPG, PNG, WebP ou AVIF.":"Use a JPG, PNG, WebP or AVIF image.",
  "A imagem pode ter no máximo 10 MB.":"Images can be up to 10 MB.",
  "Use vídeo MP4 ou WebM para o fundo.":"Use an MP4 or WebM video for the background.",
  "O vídeo de fundo pode ter no máximo 20 MB.":"Background videos can be up to 20 MB.",
  "O arquivo pode ter no máximo 20 MB.":"Files can be up to 20 MB.",
  "Escolha um arquivo para enviar.":"Choose a file to upload.",
  "Mídia não encontrada.":"Media not found.",
  "Envie a mídia pelo campo de upload.":"Upload the media using the file field.",
  "O armazenamento de mídia ainda não está conectado ao Worker.":"Media storage is not connected to the service yet.",
  "Tipo de mídia inválido.":"Invalid media type.",
  "O arquivo está vazio.":"The file is empty.",
  "Formato de arquivo não permitido.":"File format not allowed.",
  "Informe o nome do responsável pela confirmação.":"Enter the primary contact name.",
  "O nome informado é muito longo.":"The name is too long.",
  "Envie pelo menos um convidado para importar.":"Add at least one guest to import.",
  "A URL informada não é válida.":"The URL is invalid.",
  "A mídia precisa usar um endereço http ou https.":"Media must use an http or https address.",
  "Rota não encontrada.":"Route not found."
 };
 if(exact[m])return exact[m];
 m=m.replace(/^Esta confirmação permite no máximo (\d+) pessoas presentes\.$/,"This RSVP allows up to $1 attendees.");
 m=m.replace(/^Importe no máximo (\d+) confirmações por vez\.$/,"Import up to $1 RSVPs at a time.");
 m=m.replace(/^Esta confirmação permite no máximo (\d+) pessoas\.$/,"This RSVP allows up to $1 people.");
 m=m.replace(/^(.+) já está nesta confirmação\.$/,"$1 is already included in this RSVP.");
 m=m.replace(/^(.+) já consta em outra confirmação deste evento\.$/,"$1 is already included in another RSVP for this event.");
 return m;
}
const effectiveLimit=(e,g)=>Number(g?.max_people_allowed||0)||Number(e?.max_people_per_rsvp||0)||null;
const clone=v=>JSON.parse(JSON.stringify(v));
const rgb=(h,f="255,253,251")=>{h=String(h||"").replace("#","");if(!/^[0-9a-f]{6}$/i.test(h))return f;return`${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`};
const rgba=(h,a)=>{const r=rgb(h,"58,31,27");return`rgba(${r},${Number(a||0)})`};
const normalizeHex=v=>{
 let h=String(v||"").trim().replace(/^#/,"");
 if(/^[0-9a-f]{3}$/i.test(h))h=h.split("").map(c=>c+c).join("");
 if(!/^[0-9a-f]{6}$/i.test(h))return null;
 return`#${h.toUpperCase()}`;
};

const bgPositionCss=(v,x="center")=>`${x==="left"?"left":x==="right"?"right":"center"} ${v==="top"?"top":v==="bottom"?"bottom":"center"}`;
const publicCardWidthCss=v=>v==="narrow"?"min(82vw,430px)":v==="wide"?"min(94vw,590px)":"min(88vw,510px)";
const previewInset=v=>v==="narrow"?24:v==="wide"?8:16;

const isRecentResponse=v=>{
 if(!v)return false;
 const t=new Date(v).getTime();
 return Number.isFinite(t)&&Date.now()-t>=0&&Date.now()-t<24*60*60*1000;
};

const dateKeySao=d=>{
 try{
  const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const pick=k=>parts.find(p=>p.type===k)?.value||"";
  return`${pick("year")}-${pick("month")}-${pick("day")}`;
 }catch{return""}
};

const fmtResponseTime=(v,lang="pt-BR")=>{
 if(!v)return"";
 try{
  const d=new Date(v),now=new Date(),yesterday=new Date(Date.now()-86400000);
  const time=new Intl.DateTimeFormat(localeFor(lang),{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit"}).format(d);
  if(dateKeySao(d)===dateKeySao(now))return tr(lang,`Hoje às ${time}`,`Today at ${time}`);
  if(dateKeySao(d)===dateKeySao(yesterday))return tr(lang,`Ontem às ${time}`,`Yesterday at ${time}`);
  const day=new Intl.DateTimeFormat(localeFor(lang),{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit"}).format(d);
  return tr(lang,`${day} às ${time}`,`${day} at ${time}`);
 }catch{return fmtDTLang(v,lang)}
};

function scrollToProblem(el){
 if(!el)return;
 try{el.scrollIntoView({behavior:"smooth",block:"center"})}catch{}
 setTimeout(()=>{if(typeof el.focus==="function")el.focus({preventScroll:true})},260);
}

function bindInvalidScroll(form){
 if(!form)return;
 form.addEventListener("invalid",e=>scrollToProblem(e.target),true);
}

function syncPublicViewport(){
 const apply=()=>{
  const h=window.visualViewport?.height||window.innerHeight;
  document.documentElement.style.setProperty("--public-vh",`${Math.max(320,Math.round(h))}px`);
 };
 apply();
 window.visualViewport?.addEventListener("resize",apply,{passive:true});
 window.addEventListener("orientationchange",()=>setTimeout(apply,120),{passive:true});
}

function uploadWithProgress(url,formData,onProgress){
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();
  xhr.open("POST",url,true);
  xhr.responseType="json";
  xhr.upload.onprogress=e=>{
   if(e.lengthComputable)onProgress?.(Math.min(100,Math.round(e.loaded/e.total*100)));
  };
  xhr.onerror=()=>reject(new Error(tr(activeInterfaceLanguage,"Não foi possível enviar a mídia.","Unable to upload media.")));
  xhr.onload=()=>{
   const data=xhr.response||{};
   if(xhr.status>=200&&xhr.status<300)return resolve(data);
   reject(new Error(translateServerMessage(data?.error||tr(activeInterfaceLanguage,"Não foi possível concluir o upload.","Unable to complete the upload."),activeInterfaceLanguage)));
  };
  xhr.send(formData);
 });
}

const pad2=n=>String(n).padStart(2,"0");
const compactDate=v=>String(v||"").replaceAll("-","");
const compactTime=v=>String(v||"00:00").replace(":","")+"00";

function addCalendarHours(date,time,hours=4){
 if(!date)return{date:"",time:""};
 const [y,m,d]=date.split("-").map(Number);
 const [hh,mm]=String(time||"00:00").split(":").map(Number);
 const dt=new Date(Date.UTC(y,m-1,d,hh,mm,0));
 dt.setUTCHours(dt.getUTCHours()+hours);
 return{
  date:`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth()+1)}-${pad2(dt.getUTCDate())}`,
  time:`${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`
 };
}

function calendarRange(e,a){
 const date=e.event_date;
 if(!date)return null;

 if(!e.event_time){
  const next=addCalendarHours(date,"00:00",24);
  return{allDay:true,start:compactDate(date),end:compactDate(next.date)};
 }

 let endDate=date,endTime=a.calendar_end_time;
 if(endTime){
  const [sh,sm]=e.event_time.split(":").map(Number);
  const [eh,em]=endTime.split(":").map(Number);
  if(eh*60+em<=sh*60+sm){
   endDate=addCalendarHours(date,"00:00",24).date;
  }
 }else{
  const end=addCalendarHours(date,e.event_time,4);
  endDate=end.date;
  endTime=end.time;
 }

 return{
  allDay:false,
  start:`${compactDate(date)}T${compactTime(e.event_time)}`,
  end:`${compactDate(endDate)}T${compactTime(endTime)}`
 };
}

function calendarDescription(e,a){
 const L=eventLang(e),bits=[tr(L,"Evento adicionado pelo Libri RSVP.","Event added by Libri RSVP.")];
 if(a.invitation_url)bits.push(`${tr(L,"Convite","Invitation")}: ${a.invitation_url}`);
 return bits.join("\n");
}

function googleCalendarUrl(e){
 const a=safeAppearance(e),range=calendarRange(e,a);
 if(!range)return"";
 const q=new URLSearchParams({
  action:"TEMPLATE",
  text:e.title||tr(eventLang(e),"Evento","Event"),
  dates:`${range.start}/${range.end}`,
  details:calendarDescription(e,a),
  location:a.calendar_location||""
 });
 if(!range.allDay)q.set("ctz","America/Sao_Paulo");
 return`https://calendar.google.com/calendar/render?${q.toString()}`;
}

function icsEscape(v=""){
 return String(v)
  .replace(/\\/g,"\\\\")
  .replace(/\r?\n/g,"\\n")
  .replace(/,/g,"\\,")
  .replace(/;/g,"\\;");
}

function downloadCalendarIcs(e){
 const a=safeAppearance(e),range=calendarRange(e,a);
 if(!range)return toast(tr(eventLang(e),"Este evento ainda não tem data configurada.","This event does not have a date yet."),true);

 const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
 const start=range.allDay
  ?`DTSTART;VALUE=DATE:${range.start}`
  :`DTSTART;TZID=America/Sao_Paulo:${range.start}`;
 const end=range.allDay
  ?`DTEND;VALUE=DATE:${range.end}`
  :`DTEND;TZID=America/Sao_Paulo:${range.end}`;

 const body=[
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Libri Convites//Libri RSVP//PT-BR",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "BEGIN:VEVENT",
  `UID:${icsEscape(e.id||e.slug||crypto.randomUUID())}@confirmacao.libriconvites.com.br`,
  `DTSTAMP:${stamp}`,
  start,
  end,
  `SUMMARY:${icsEscape(e.title||tr(eventLang(e),"Evento","Event"))}`,
  `DESCRIPTION:${icsEscape(calendarDescription(e,a))}`,
  a.calendar_location?`LOCATION:${icsEscape(a.calendar_location)}`:"",
  "END:VEVENT",
  "END:VCALENDAR"
 ].filter(Boolean).join("\r\n");

 const blob=new Blob([body],{type:"text/calendar;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");
 link.href=url;
 link.download=`${String(e.slug||e.title||tr(eventLang(e),"evento","event")).replace(/[^a-z0-9_-]+/gi,"-")}.ics`;
 document.body.append(link);
 link.click();
 link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}

function openCalendarMenu(e){
 const L=eventLang(e),google=googleCalendarUrl(e);
 if(!google)return toast(tr(L,"Este evento ainda não tem data configurada.","This event does not have a date yet."),true);

 const w=modal(
  tr(L,"Adicionar à agenda","Add to calendar"),
  `<div class="calendar-options">
    <a class="btn block" href="${esc(google)}" target="_blank" rel="noopener">Google Calendar</a>
    <button class="btn secondary block" type="button" id="calendarIcs">Apple / iPhone / ${tr(L,"outros","others")}</button>
   </div>`,
  tr(L,"Escolha onde deseja salvar este evento.","Choose where you'd like to save this event.")
 );
 w.querySelector("#calendarIcs").onclick=()=>downloadCalendarIcs(e);
}

function setAppearanceDirty(value=true){
 appearanceDirty=Boolean(value);
 window.onbeforeunload=appearanceDirty?()=>"":null;
 const el=document.querySelector("#appearanceUnsaved");
 if(el){
  el.className=`unsaved-indicator ${appearanceDirty?"dirty":"saved"}`;
  el.textContent=appearanceDirty
   ?tr(activeInterfaceLanguage,"● Alterações não salvas","● Unsaved changes")
   :tr(activeInterfaceLanguage,"✓ Tudo salvo","✓ All changes saved");
 }
}

function canLeaveAppearance(){
 if(!appearanceDirty)return true;
 if(confirm(tr(activeInterfaceLanguage,"Você tem alterações de aparência que ainda não foram salvas. Deseja sair mesmo assim?","You have unsaved customization changes. Leave without saving?"))){
  setAppearanceDirty(false);
  return true;
 }
 return false;
}

async function api(url,options={}){
 const headers={...(options.headers||{})};
 if(options.body!==undefined&&!(options.body instanceof FormData)&&!headers["Content-Type"])headers["Content-Type"]="application/json";
 const res=await fetch(url,{...options,headers}),ct=res.headers.get("content-type")||"",data=ct.includes("json")?await res.json():await res.text();
 if(!res.ok)throw new Error(translateServerMessage(data?.error||tr(activeInterfaceLanguage,"Não foi possível concluir.","Unable to complete the request."),activeInterfaceLanguage));
 return data;
}
function toast(msg,error=false){clearTimeout(toastTimer);toastEl.textContent=msg;toastEl.className=`toast show${error?" error":""}`;toastTimer=setTimeout(()=>toastEl.className="toast",3500)}
async function copy(text){try{await navigator.clipboard.writeText(text);toast(tr(activeInterfaceLanguage,"Link copiado.","Link copied."))}catch{toast(tr(activeInterfaceLanguage,"Não foi possível copiar o link.","Unable to copy the link."),true)}}
function brand(event){const p=event?.primary_color||"#b8735f",a=event?.accent_color||"#f8efec";document.documentElement.style.setProperty("--brand",p);document.documentElement.style.setProperty("--brand-strong",p);document.documentElement.style.setProperty("--soft",a)}
function topbar(extra="",lang=activeInterfaceLanguage){return`<div class="topbar"><a class="brand" href="/"><div class="mark">L</div><div><h1>Libri RSVP</h1><small>${tr(lang,"Convites virtuais e arte digital","Virtual invitations & digital art")}</small></div></a>${extra}</div>`}
function modal(title,html,subtitle="",large=false){const w=document.createElement("div");document.body.classList.add("modal-open");w.className="modal-backdrop";w.innerHTML=`<div class="modal${large?" large":""}"><button class="close" type="button">×</button><h2>${esc(title)}</h2>${subtitle?`<p class="subtle">${esc(subtitle)}</p>`:""}${html}</div>`;document.body.append(w);const close=()=>{w.remove();if(!document.querySelector(".modal-backdrop"))document.body.classList.remove("modal-open")};w.querySelector(".close").onclick=close;w.onclick=e=>{if(e.target===w)close()};w.closeModal=close;return w}
const loading=(lang=activeInterfaceLanguage)=>`<div class="card panel"><div class="loading-inline"><span class="spinner"></span>${tr(lang,"Carregando...","Loading...")}</div></div>`;

if(path==="/admin"||path==="/admin/")adminApp();
else if(path.startsWith("/cliente/"))clientApp(decodeURIComponent(path.split("/")[2]||""));
else if(path.startsWith("/e/"))publicApp(decodeURIComponent(path.split("/")[2]||""));
else home();

function home(){brand();app.innerHTML=`<main class="shell">${topbar()}<section class="card hero"><div><span class="chip">LIBRI RSVP</span><h2>Confirmações bonitas por fora e organizadas por dentro.</h2><p>Gestão de convidados, famílias, mensagens e presença.</p></div><a class="btn" href="/admin">Área Libri</a></section></main>`}

async function adminApp(){
 brand();
 app.innerHTML=`<main class="shell">${topbar()}<section class="card panel panel-narrow"><span class="eyebrow">Área administrativa</span><h1>Entrar na Libri</h1><form id="login"><div class="field"><label>Senha</label><input name="password" type="password" required></div><button class="btn block">Entrar</button></form></section></main>`;
 try{await api("/api/admin/me");return renderAdminDashboard()}catch{}
 document.querySelector("#login").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api("/api/admin/login",{method:"POST",body:JSON.stringify({password:new FormData(e.currentTarget).get("password")})});