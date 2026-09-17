const SCHEMA_VERSION=1;
const CURRENT_EVENT_KEY="libri_rsvp_current_event_id";
const ALLOWED_TOP_LEVEL=new Set([
  "title","event_date","event_time","welcome_message","rsvp_mode","list_behavior",
  "rsvp_deadline","max_people_per_rsvp","primary_color","accent_color","background_type",
  "background_image_url","background_video_url","appearance_settings","public_texts",
  "extra_fields","client_permissions"
]);
const MERGE_OBJECT_KEYS=new Set(["appearance_settings","public_texts","extra_fields","client_permissions"]);

function libriToast(message,error=false){
  const el=document.querySelector("#toast");
  if(!el){alert(message);return;}
  el.textContent=message;
  el.className=`toast show${error?" error":""}`;
  clearTimeout(libriToast._timer);
  libriToast._timer=setTimeout(()=>{el.className="toast"},3800);
}

async function libriApi(url,options={}){
  const headers={...(options.headers||{})};
  if(options.body!==undefined&&!(options.body instanceof FormData)&&!headers["Content-Type"]){
    headers["Content-Type"]="application/json";
  }
  const response=await fetch(url,{...options,headers,credentials:"same-origin"});
  const type=response.headers.get("content-type")||"";
  const data=type.includes("json")?await response.json():await response.text();
  if(!response.ok){
    const message=data&&typeof data==="object"?data.error:data;
    throw new Error(message||"Não foi possível concluir.");
  }
  return data;
}

function escapeHtml(value=""){
  return String(value??"").replace(/[&<>'"]/g,c=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "'":"&#39;",
    '"':"&quot;"
  }[c]));
}

function openLibriModal(title,bodyHtml,subtitle=""){
  const wrap=document.createElement("div");
  document.body.classList.add("modal-open");
  wrap.className="modal-backdrop";

  wrap.innerHTML=`
    <div class="modal large">
      <button class="close" type="button">×</button>
      <h2>${escapeHtml(title)}</h2>
      ${subtitle?`<p class="subtle">${escapeHtml(subtitle)}</p>`:""}
      ${bodyHtml}
    </div>
  `;

  document.body.append(wrap);

  const close=()=>{
    wrap.remove();
    if(!document.querySelector(".modal-backdrop")){
      document.body.classList.remove("modal-open");
    }
  };

  wrap.querySelector(".close").onclick=close;
  wrap.onclick=e=>{
    if(e.target===wrap)close();
  };

  wrap.closeModal=close;
  return wrap;
}

function sanitizeConfig(raw){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)){
    throw new Error("O JSON precisa ser um objeto de configuração.");
  }

  if(raw.schema_version!==undefined&&Number(raw.schema_version)!==SCHEMA_VERSION){
    throw new Error(`Versão de configuração incompatível. Esperado: ${SCHEMA_VERSION}.`);
  }

  const clean={};

  for(const [key,value] of Object.entries(raw)){
    if(!ALLOWED_TOP_LEVEL.has(key))continue;

    if(MERGE_OBJECT_KEYS.has(key)){
      if(value&&typeof value==="object"&&!Array.isArray(value)){
        clean[key]={...value};
      }
      continue;
    }

    clean[key]=value;
  }

  return clean;
}

function exportableEvent(event){
  const out={
    schema_version:SCHEMA_VERSION,
    exported_at:new Date().toISOString()
  };

  for(const key of ALLOWED_TOP_LEVEL){
    if(event[key]!==undefined){
      out[key]=event[key];
    }
  }

  return out;
}

function downloadJson(filename,data){
  const blob=new Blob(
    [JSON.stringify(data,null,2)+"\n"],
    {type:"application/json;charset=utf-8"}
  );

  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");

  a.href=url;
  a.download=filename;

  document.body.append(a);
  a.click();
  a.remove();

  setTimeout(()=>URL.revokeObjectURL(url),1200);
}

function slugFileName(value){
  return String(value||"evento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")||"evento";
}

function summaryHtml(config,current=null){
  const parts=[];

  const push=(label,value)=>{
    if(value!==undefined&&value!==null&&value!==""){
      parts.push(`
        <div class="setting-card">
          <div>
            <h4>${escapeHtml(label)}</h4>
            <p>${escapeHtml(value)}</p>
          </div>
        </div>
      `);
    }
  };

  push("Evento",config.title||current?.title);
  push("Data",config.event_date);
  push("Horário",config.event_time);
  push("Tipo",config.rsvp_mode);
  push("Lista",config.list_behavior);

  if(config.appearance_settings){
    push("Aparência",`${Object.keys(config.appearance_settings).length} campo(s)`);
  }

  if(config.public_texts){
    push("Textos",`${Object.keys(config.public_texts).length} campo(s)`);
  }

  if(config.extra_fields){
    push("Campos opcionais",`${Object.keys(config.extra_fields).length} campo(s)`);
  }

  if(config.client_permissions){
    push("Permissões",`${Object.keys(config.client_permissions).length} campo(s)`);
  }

  const other=Object.keys(config).filter(k=>![
    "title",
    "event_date",
    "event_time",
    "rsvp_mode",
    "list_behavior",
    "appearance_settings",
    "public_texts",
    "extra_fields",
    "client_permissions"
  ].includes(k));

  if(other.length){
    push("Outros campos",other.join(", "));
  }

  return `
    <div class="settings-list">
      ${parts.join("")||'<div class="empty">Nenhum campo reconhecido.</div>'}
    </div>
  `;
}

async function getEventInfo(id){
  return await libriApi(`/api/admin/events/${encodeURIComponent(id)}`);
}

function mergeForPatch(current,incoming){
  const patch={...incoming};

  for(const key of MERGE_OBJECT_KEYS){
    if(incoming[key]!==undefined){
      patch[key]={
        ...(current[key]||{}),
        ...(incoming[key]||{})
      };
    }
  }

  return patch;
}

async function applyImport(config,targetEventId=null){
  const clean=sanitizeConfig(config);

  if(targetEventId){
    const info=await getEventInfo(targetEventId);
    const patch=mergeForPatch(info.event,clean);

    const result=await libriApi(
      `/api/admin/events/${encodeURIComponent(targetEventId)}`,
      {
        method:"PATCH",
        body:JSON.stringify(patch)
      }
    );

    return{
      mode:"update",
      event:result.event
    };
  }

  if(!String(clean.title||"").trim()){
    throw new Error("Para criar um evento novo, o JSON precisa conter o campo title.");
  }

  const result=await libriApi("/api/admin/events",{
    method:"POST",
    body:JSON.stringify(clean)
  });

  return{
    mode:"create",
    event:result.event
  };
}

function importModal(targetEventId=null){
  let parsed=null;
  let current=null;

  const modal=openLibriModal(
    targetEventId
      ?"Importar configuração Libri"
      :"Criar evento por JSON",

    `
      <div class="form-section">

        <div class="field">
          <label>Arquivo JSON</label>
          <input
            id="libriJsonFile"
            type="file"
            accept="application/json,.json"
          >
        </div>

        <div class="field">
          <label>Ou cole o JSON</label>
          <textarea
            id="libriJsonText"
            rows="12"
            placeholder='{ "schema_version": 1, "title": "..." }'
          ></textarea>
        </div>

        <div class="actions">
          <button
            class="btn secondary"
            id="libriJsonReview"
            type="button"
          >
            Revisar configuração
          </button>
        </div>

      </div>

      <div id="libriJsonPreview"></div>
    `,

    targetEventId
      ?"Só os campos presentes no arquivo serão alterados. IDs, slug, convidados e respostas não são importados."
      :"O evento será criado sem convidados. IDs, slug e link privado serão gerados pelo próprio RSVP."
  );

  const file=modal.querySelector("#libriJsonFile");
  const text=modal.querySelector("#libriJsonText");
  const preview=modal.querySelector("#libriJsonPreview");
  const review=modal.querySelector("#libriJsonReview");

  file.onchange=async()=>{
    const selected=file.files?.[0];
    if(!selected)return;

    try{
      text.value=await selected.text();
      preview.innerHTML="";
    }catch{
      libriToast("Não foi possível ler o arquivo.",true);
    }
  };

  review.onclick=async()=>{
    try{
      parsed=JSON.parse(text.value.trim());

      const clean=sanitizeConfig(parsed);

      if(targetEventId){
        current=(await getEventInfo(targetEventId)).event;
      }

      preview.innerHTML=`
        <section
          class="card panel"
          style="margin-top:14px"
        >

          <h3>Revisão</h3>

          ${summaryHtml(clean,current)}

          <div
            class="notice"
            style="margin-top:12px"
          >
            <strong>
              ${targetEventId?"Atualização parcial":"Novo evento"}
            </strong>

            <span>
              ${
                targetEventId
                  ?"Campos não enviados serão preservados."
                  :"O backend criará ID, slug e link privado automaticamente."
              }
            </span>
          </div>

          <button
            class="btn block large"
            id="libriJsonApply"
            type="button"
            style="margin-top:14px"
          >
            ${targetEventId?"Aplicar neste evento":"Criar evento"}
          </button>

        </section>
      `;

      preview.querySelector("#libriJsonApply").onclick=async e=>{
        const button=e.currentTarget;
        button.disabled=true;

        try{
          const result=await applyImport(parsed,targetEventId);

          if(result.event?.id){
            sessionStorage.setItem(
              CURRENT_EVENT_KEY,
              result.event.id
            );
          }

          libriToast(
            result.mode==="create"
              ?"Evento criado pelo JSON. ✨"
              :"Configuração aplicada. ✨"
          );

          modal.closeModal();

          setTimeout(()=>{
            location.reload();
          },650);

        }catch(err){
          libriToast(err.message,true);
          button.disabled=false;
        }
      };

    }catch(err){
      libriToast(
        err.message||"JSON inválido.",
        true
      );
    }
  };
}

async function exportCurrentEvent(id){
  try{
    const info=await getEventInfo(id);
    const data=exportableEvent(info.event);

    downloadJson(
      `${slugFileName(info.event.title)}-rsvp-config.json`,
      data
    );

    libriToast("Configuração exportada. ✨");

  }catch(err){
    libriToast(err.message,true);
  }
}

function currentEventId(){
  return sessionStorage.getItem(CURRENT_EVENT_KEY)||"";
}

function injectDashboardTools(){
  const newEvent=document.querySelector("#newEvent");

  if(!newEvent||document.querySelector("#libriJsonCreate")){
    return;
  }

  const btn=document.createElement("button");

  btn.id="libriJsonCreate";
  btn.type="button";
  btn.className="btn secondary large";
  btn.textContent="Importar JSON";
  btn.onclick=()=>importModal(null);

  newEvent.insertAdjacentElement("afterend",btn);
}

function injectEventTools(){
  const dup=document.querySelector("#dup");

  if(!dup||document.querySelector("#libriJsonImportCurrent")){
    return;
  }

  const id=currentEventId();

  if(!id)return;

  const importBtn=document.createElement("button");

  importBtn.id="libriJsonImportCurrent";
  importBtn.type="button";
  importBtn.className="btn secondary";
  importBtn.textContent="Importar JSON";
  importBtn.onclick=()=>importModal(id);

  const exportBtn=document.createElement("button");

  exportBtn.id="libriJsonExportCurrent";
  exportBtn.type="button";
  exportBtn.className="btn secondary";
  exportBtn.textContent="Exportar JSON";
  exportBtn.onclick=()=>exportCurrentEvent(id);

  dup.parentElement?.prepend(exportBtn);
  dup.parentElement?.prepend(importBtn);
}

function rememberEventClicks(){
  document.addEventListener(
    "click",
    event=>{
      const button=event.target.closest?.("[data-event]");

      if(button?.dataset?.event){
        sessionStorage.setItem(
          CURRENT_EVENT_KEY,
          button.dataset.event
        );
      }
    },
    true
  );
}

function observeUi(){
  let scheduled=false;

  const run=()=>{
    scheduled=false;

    if(
      location.pathname!=="/admin"&&
      location.pathname!=="/admin/"
    ){
      return;
    }

    injectDashboardTools();
    injectEventTools();
  };

  const schedule=()=>{
    if(scheduled)return;

    scheduled=true;
    requestAnimationFrame(run);
  };

  const observer=new MutationObserver(schedule);

  observer.observe(
    document.body,
    {
      childList:true,
      subtree:true
    }
  );

  schedule();
}

rememberEventClicks();

if(document.readyState==="loading"){
  document.addEventListener(
    "DOMContentLoaded",
    observeUi,
    {once:true}
  );
}else{
  observeUi();
}