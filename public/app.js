const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const path = location.pathname;
let toastTimer;

const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  "'":'&#39;',
  '"':'&quot;'
}[c]));

const fmtDate = d =>
  d
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle:'medium' })
        .format(new Date(`${d}T12:00:00`))
    : 'Data não informada';

const api = async (url, options={}) => {
  const res = await fetch(url, {
    ...options,
    headers:{
      'Content-Type':'application/json',
      ...(options.headers || {})
    }
  });

  const type = res.headers.get('content-type') || '';
  const data = type.includes('json')
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    throw Object.assign(
      new Error(data?.error || 'Não foi possível concluir.'),
      { status:res.status, data }
    );
  }

  return data;
};

function toast(msg, error=false) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className = `toast show${error ? ' error' : ''}`;

  toastTimer = setTimeout(() => {
    toastEl.className = 'toast';
  }, 3200);
}

function topbar(extra='') {
  return `
    <div class="topbar">
      <div class="brand">
        <div class="mark">L</div>
        <div>
          <h1>Libri RSVP</h1>
          <small>Confirmação de presença</small>
        </div>
      </div>
      ${extra}
    </div>
  `;
}

if (path === '/admin' || path === '/admin/') {
  adminApp();
} else if (path.startsWith('/cliente/')) {
  clientApp(decodeURIComponent(path.split('/')[2] || ''));
} else if (path.startsWith('/e/')) {
  publicApp(path.split('/')[2] || '');
} else {
  home();
}

function home() {
  app.innerHTML = `
    <main class="shell">
      ${topbar()}
      <section class="card panel">
        <h1>Libri RSVP</h1>
        <p class="meta">Ferramenta de confirmação de presença.</p>

        <div class="actions">
          <a class="btn" href="/admin">Área Libri</a>
        </div>
      </section>
    </main>
  `;
}

async function adminApp() {
  app.innerHTML = `
    <main class="shell">
      ${topbar()}

      <div class="card panel">
        <h1>Entrar na área Libri</h1>

        <p class="meta">
          Use a senha administrativa configurada no Cloudflare.
        </p>

        <form id="login">
          <div class="field">
            <label>Senha</label>
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              required
            >
          </div>

          <button class="btn" type="submit">
            Entrar
          </button>
        </form>
      </div>
    </main>
  `;

  try {
    await api('/api/admin/me');
    await renderAdminDashboard();
  } catch {}

  document.querySelector('#login')?.addEventListener(
    'submit',
    async e => {
      e.preventDefault();

      const btn = e.submitter;
      btn.disabled = true;

      try {
        await api('/api/admin/login', {
          method:'POST',
          body:JSON.stringify({
            password:new FormData(e.currentTarget).get('password')
          })
        });

        renderAdminDashboard();
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    }
  );
}

async function renderAdminDashboard() {
  const data = await api('/api/admin/events');

  app.innerHTML = `
    <main class="shell">

      ${topbar(`
        <div class="actions">
          <button
            class="btn secondary small"
            id="logout"
          >
            Sair
          </button>
        </div>
      `)}

      <section class="grid">
        <div class="card hero">
          <div>
            <span class="chip">PAINEL LIBRI</span>

            <h2>Seus eventos em um só lugar.</h2>

            <p>
              Crie a confirmação, acompanhe respostas e entregue
              à cliente um painel privado sem criar uma conta para ela.
            </p>
          </div>

          <button class="btn" id="newEvent">
            + Criar evento
          </button>
        </div>
      </section>

      <div class="section-title">
        <h2>Eventos</h2>
        <span class="meta">
          ${data.events.length} cadastrado(s)
        </span>
      </div>

      <div class="events" id="events">
        ${
          data.events.length
            ? data.events.map(eventCard).join('')
            : `
              <div class="empty">
                Nenhum evento ainda.
                Crie o primeiro e o sistema gera os links automaticamente.
              </div>
            `
        }
      </div>

    </main>
  `;

  document.querySelector('#logout').onclick = async () => {
    await api('/api/admin/logout', {
      method:'POST',
      body:'{}'
    });

    adminApp();
  };

  document.querySelector('#newEvent').onclick = () => {
    eventModal();
  };

  document.querySelectorAll('[data-event]').forEach(b => {
    b.onclick = () => renderAdminEvent(b.dataset.event);
  });
}

function eventCard(e) {
  return `
    <article class="event-card">

      <div class="meta">
        ${fmtDate(e.event_date)}
        ${e.event_time ? ` • ${esc(e.event_time)}` : ''}
      </div>

      <h3>${esc(e.title)}</h3>

      <div class="chips">
        <span class="chip">
          ${
            e.rsvp_mode === 'list'
              ? 'Lista controlada'
              : 'Confirmação livre'
          }
        </span>

        <span class="chip">
          ${e.status === 'active' ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      <div class="stats">

        <div class="stat good">
          <strong>${e.yes_responses}</strong>
          <span>sim</span>
        </div>

        <div class="stat bad">
          <strong>${e.no_responses}</strong>
          <span>não</span>
        </div>

        <div class="stat pending">
          <strong>${e.pending_responses}</strong>
          <span>pend.</span>
        </div>

        <div class="stat">
          <strong>${e.people_confirmed}</strong>
          <span>pessoas</span>
        </div>

      </div>

      <button
        class="btn secondary"
        data-event="${esc(e.id)}"
      >
        Abrir painel
      </button>

    </article>
  `;
}

function eventModal() {
  const wrap = document.createElement('div');

  wrap.className = 'modal-backdrop';

  wrap.innerHTML = `
    <div class="modal">

      <button
        class="close"
        type="button"
      >
        ×
      </button>

      <h2>Novo evento</h2>

      <form id="eventForm">

        <div class="field">
          <label>Nome do evento</label>
          <input
            name="title"
            placeholder="Helena • 1 aninho"
            required
          >
        </div>

        <div class="row">

          <div class="field">
            <label>Data</label>
            <input
              type="date"
              name="event_date"
            >
          </div>

          <div class="field">
            <label>Horário</label>
            <input
              type="time"
              name="event_time"
            >
          </div>

        </div>

        <div class="field">
          <label>Tipo de confirmação</label>

          <select name="rsvp_mode">
            <option value="free">
              Confirmação livre
            </option>

            <option value="list">
              Lista pré-cadastrada
            </option>
          </select>
        </div>

        <div class="field">
          <label>Mensagem pública</label>

          <textarea
            name="welcome_message"
            rows="3"
            placeholder="Ficaremos muito felizes em celebrar com você!"
          ></textarea>
        </div>

        <div class="row">

          <div class="field">
            <label>Cor principal</label>

            <input
              type="color"
              name="primary_color"
              value="#6f4f5f"
            >
          </div>

          <div class="field">
            <label>Cor suave</label>

            <input
              type="color"
              name="accent_color"
              value="#f4e8ed"
            >
          </div>

        </div>

        <div class="checks">

          <label class="check">
            <input
              type="checkbox"
              name="phone"
            >
            Telefone
          </label>

          <label class="check">
            <input
              type="checkbox"
              name="dietary"
            >
            Restrição alimentar
          </label>

          <label class="check">
            <input
              type="checkbox"
              name="notes"
            >
            Observações
          </label>

        </div>

        <div class="divider"></div>

        <button
          class="btn"
          type="submit"
        >
          Criar evento
        </button>

      </form>

    </div>
  `;

  document.body.append(wrap);

  wrap.querySelector('.close').onclick = () => {
    wrap.remove();
  };

  wrap.onclick = e => {
    if (e.target === wrap) {
      wrap.remove();
    }
  };

  wrap.querySelector('form').onsubmit = async e => {
    e.preventDefault();

    const f = new FormData(e.currentTarget);
    const btn = e.submitter;

    btn.disabled = true;

    try {
      const data = await api('/api/admin/events', {
        method:'POST',

        body:JSON.stringify({
          title:f.get('title'),
          event_date:f.get('event_date'),
          event_time:f.get('event_time'),
          rsvp_mode:f.get('rsvp_mode'),
          welcome_message:f.get('welcome_message'),
          primary_color:f.get('primary_color'),
          accent_color:f.get('accent_color'),

          extra_fields:{
            phone:f.has('phone'),
            adults_children:true,
            companions:true,
            dietary:f.has('dietary'),
            notes:f.has('notes')
          }
        })
      });

      wrap.remove();

      toast('Evento criado. ✨');

      renderAdminEvent(data.event.id);

    } catch (err) {
      toast(err.message, true);

    } finally {
      btn.disabled = false;
    }
  };
}

async function renderAdminEvent(id) {
  const [info, list] = await Promise.all([
    api(`/api/admin/events/${id}`),
    api(`/api/admin/events/${id}/guests`)
  ]);

  const e = info.event;
  const s = info.summary;

  app.innerHTML = `
    <main class="shell">

      ${topbar(`
        <button
          class="btn secondary small"
          id="back"
        >
          ← Eventos
        </button>
      `)}

      <section
        class="client-head"
        style="--brand:${esc(e.primary_color)}"
      >

        <div
          class="meta"
          style="color:#fff;opacity:.8"
        >
          ${fmtDate(e.event_date)}
          ${e.event_time ? ` • ${esc(e.event_time)}` : ''}
        </div>

        <h1>${esc(e.title)}</h1>

        <p>
          ${
            e.rsvp_mode === 'list'
              ? 'Lista pré-cadastrada'
              : 'Confirmação livre'
          }
          •
          ${e.status === 'active' ? 'Ativo' : 'Inativo'}
        </p>

      </section>

      ${summaryHtml(s)}

      <div
        class="grid"
        style="margin-top:18px"
      >

        <section
          class="card"
          style="grid-column:span 12"
        >

          <div class="section-title">
            <h3>Links</h3>
          </div>

          <div class="field">
            <label>Convidados</label>

            <div
              class="codebox"
              id="publicUrl"
            >
              ${esc(location.origin + '/e/' + e.slug)}
            </div>
          </div>

          <div class="field">
            <label>Cliente</label>

            <div
              class="codebox"
              id="clientUrl"
            >
              ${
                esc(
                  info.client_url ||
                  'Configure SESSION_SECRET para gerar o link.'
                )
              }
            </div>
          </div>

          <div class="actions">

            <button
              class="btn secondary small"
              id="copyPublic"
            >
              Copiar confirmação
            </button>

            <button
              class="btn secondary small"
              id="copyClient"
            >
              Copiar cliente
            </button>

            <button
              class="btn danger small"
              id="resetClient"
            >
              Trocar link da cliente
            </button>

          </div>

        </section>

      </div>

      <div class="section-title">

        <h2>Convidados</h2>

        <div class="actions">

          <button
            class="btn secondary small"
            id="export"
          >
            Exportar CSV
          </button>

          <button
            class="btn"
            id="addGuest"
          >
            + Adicionar
          </button>

        </div>

      </div>

      <div class="toolbar">

        <input
          class="search"
          id="search"
          placeholder="Buscar convidado"
        >

        <select
          id="filter"
          class="search"
          style="flex:0 0 180px"
        >

          <option value="">
            Todos
          </option>

          <option value="yes">
            Confirmados
          </option>

          <option value="no">
            Não irão
          </option>

          <option value="pending">
            Pendentes
          </option>

        </select>

      </div>

      <div id="guestTable">
        ${guestTable(list.guests, true)}
      </div>

    </main>
  `;

  document.querySelector('#back').onclick =
    renderAdminDashboard;

  document.querySelector('#copyPublic').onclick = () =>
    copy(location.origin + '/e/' + e.slug);

  document.querySelector('#copyClient').onclick = () =>
    copy(info.client_url);

  document.querySelector('#resetClient').onclick = async () => {
    if (
      !confirm(
        'O link atual da cliente deixará de funcionar. Continuar?'
      )
    ) {
      return;
    }

    const d = await api(
      `/api/admin/events/${id}/client-link/reset`,
      {
        method:'POST',
        body:'{}'
      }
    );

    document.querySelector('#clientUrl').textContent =
      d.client_url;

    toast('Novo link gerado.');
  };

  document.querySelector('#export').onclick = () => {
    location.href =
      `/api/admin/events/${id}/export.csv`;
  };

  document.querySelector('#addGuest').onclick = () =>
    guestModal({
      eventId:id,
      role:'admin'
    });

  let t;

  const refresh = async () => {
    const q = encodeURIComponent(
      document.querySelector('#search').value
    );

    const st =
      document.querySelector('#filter').value;

    const d = await api(
      `/api/admin/events/${id}/guests?q=${q}&status=${st}`
    );

    document.querySelector('#guestTable').innerHTML =
      guestTable(d.guests, true);

    bindGuestActions(id, 'admin');
  };

  document.querySelector('#search').oninput = () => {
    clearTimeout(t);
    t = setTimeout(refresh, 250);
  };

  document.querySelector('#filter').onchange =
    refresh;

  bindGuestActions(id, 'admin');
}

function summaryHtml(s) {
  return `
    <div class="stats">

      <div class="stat good">
        <strong>${s.yes_responses}</strong>
        <span>Confirmações positivas</span>
      </div>

      <div class="stat bad">
        <strong>${s.no_responses}</strong>
        <span>Não irão</span>
      </div>

      <div class="stat pending">
        <strong>${s.pending_responses}</strong>
        <span>Pendentes</span>
      </div>

      <div class="stat">
        <strong>${s.people_confirmed}</strong>
        <span>Pessoas confirmadas</span>
      </div>

    </div>
  `;
}

function guestTable(guests, editable) {
  if (!guests.length) {
    return `
      <div class="empty">
        Nenhum convidado encontrado.
      </div>
    `;
  }

  return `
    <div class="table-wrap">

      <table>

        <thead>
          <tr>
            <th>Nome</th>
            <th>Status</th>
            <th>Pessoas</th>
            <th>Telefone</th>
            <th>Origem</th>
            ${editable ? '<th>Ações</th>' : ''}
          </tr>
        </thead>

        <tbody>

          ${
            guests.map(g => `
              <tr>

                <td>
                  <strong>
                    ${esc(g.primary_name)}
                  </strong>

                  ${
                    g.companions.length
                      ? `
                        <div class="subtle">
                          + ${esc(g.companions.join(', '))}
                        </div>
                      `
                      : ''
                  }
                </td>

                <td>
                  <span
                    class="status ${g.response_status}"
                  >
                    ${
                      g.response_status === 'yes'
                        ? 'Confirmado'
                        : g.response_status === 'no'
                          ? 'Não irá'
                          : 'Pendente'
                    }
                  </span>
                </td>

                <td>
                  ${
                    g.response_status === 'no'
                      ? 0
                      : g.adults + g.children
                  }
                </td>

                <td>
                  ${esc(g.phone || '—')}
                </td>

                <td>
                  ${esc(g.source || '—')}
                </td>

                ${
                  editable
                    ? `
                      <td>
                        <div class="actions">

                          <button
                            class="btn secondary small"
                            data-edit="${g.id}"
                            data-guest='${esc(JSON.stringify(g))}'
                          >
                            Editar
                          </button>

                          <button
                            class="btn danger small"
                            data-delete="${g.id}"
                            data-name="${esc(g.primary_name)}"
                          >
                            Excluir
                          </button>

                        </div>
                      </td>
                    `
                    : ''
                }

              </tr>
            `).join('')
          }

        </tbody>

      </table>

    </div>
  `;
}

function bindGuestActions(eventId, role, token) {
  document
    .querySelectorAll('[data-edit]')
    .forEach(b => {
      b.onclick = () =>
        guestModal({
          eventId,
          role,
          token,
          guest:JSON.parse(b.dataset.guest)
        });
    });

  document
    .querySelectorAll('[data-delete]')
    .forEach(b => {
      b.onclick = async () => {

        if (
          !confirm(`Excluir ${b.dataset.name}?`)
        ) {
          return;
        }

        try {
          const base =
            role === 'client'
              ? `/api/client/${encodeURIComponent(token)}`
              : `/api/admin/events/${eventId}`;

          await api(
            `${base}/guests/${b.dataset.delete}`,
            {
              method:'DELETE',
              body:'{}'
            }
          );

          toast('Convidado excluído.');

          role === 'client'
            ? clientApp(token)
            : renderAdminEvent(eventId);

        } catch (err) {
          toast(err.message, true);
        }
      };
    });
}

function guestModal({
  eventId,
  role,
  token,
  guest=null
}) {
  const wrap =
    document.createElement('div');

  wrap.className =
    'modal-backdrop';

  wrap.innerHTML = `
    <div class="modal">

      <button class="close">
        ×
      </button>

      <h2>
        ${guest ? 'Editar' : 'Adicionar'} convidado
      </h2>

      <form>

        <div class="field">
          <label>Nome</label>

          <input
            name="primary_name"
            required
            value="${esc(guest?.primary_name || '')}"
          >
        </div>

        <div class="row">

          <div class="field">
            <label>Status</label>

            <select name="response_status">

              <option
                value="pending"
                ${
                  guest?.response_status === 'pending'
                    ? 'selected'
                    : ''
                }
              >
                Pendente
              </option>

              <option
                value="yes"
                ${
                  guest?.response_status === 'yes'
                    ? 'selected'
                    : ''
                }
              >
                Confirmado
              </option>

              <option
                value="no"
                ${
                  guest?.response_status === 'no'
                    ? 'selected'
                    : ''
                }
              >
                Não irá
              </option>

            </select>
          </div>

          <div class="field">
            <label>Telefone</label>

            <input
              name="phone"
              value="${esc(guest?.phone || '')}"
            >
          </div>

        </div>

        <div class="row">

          <div class="field">
            <label>Adultos</label>

            <input
              type="number"
              min="0"
              name="adults"
              value="${guest?.adults ?? 1}"
            >
          </div>

          <div class="field">
            <label>Crianças</label>

            <input
              type="number"
              min="0"
              name="children"
              value="${guest?.children ?? 0}"
            >
          </div>

        </div>

        <div class="field">
          <label>
            Acompanhantes, um por linha
          </label>

          <textarea
            name="companions"
            rows="3"
          >${esc((guest?.companions || []).join('\n'))}</textarea>
        </div>

        <div class="field">
          <label>
            Restrição alimentar
          </label>

          <input
            name="dietary"
            value="${esc(guest?.dietary || '')}"
          >
        </div>

        <div class="field">
          <label>Observações</label>

          <textarea name="notes">${esc(guest?.notes || '')}</textarea>
        </div>

        <button
          class="btn"
          type="submit"
        >
          Salvar
        </button>

      </form>

    </div>
  `;

  document.body.append(wrap);

  wrap.querySelector('.close').onclick =
    () => wrap.remove();

  wrap.onclick = e => {
    if (e.target === wrap) {
      wrap.remove();
    }
  };

  wrap.querySelector('form').onsubmit =
    async e => {

      e.preventDefault();

      const f =
        new FormData(e.currentTarget);

      const base =
        role === 'client'
          ? `/api/client/${encodeURIComponent(token)}`
          : `/api/admin/events/${eventId}`;

      const url =
        guest
          ? `${base}/guests/${guest.id}`
          : `${base}/guests`;

      try {
        await api(url, {
          method:guest ? 'PATCH' : 'POST',

          body:JSON.stringify({
            primary_name:f.get('primary_name'),
            response_status:f.get('response_status'),
            phone:f.get('phone'),
            adults:f.get('adults'),
            children:f.get('children'),

            companions:String(
              f.get('companions') || ''
            )
              .split('\n')
              .map(x => x.trim())
              .filter(Boolean),

            dietary:f.get('dietary'),
            notes:f.get('notes')
          })
        });

        wrap.remove();

        toast('Salvo.');

        role === 'client'
          ? clientApp(token)
          : renderAdminEvent(eventId);

      } catch (err) {
        toast(err.message, true);
      }
    };
}

async function clientApp(token) {
  try {
    const [info, list] =
      await Promise.all([
        api(`/api/client/${encodeURIComponent(token)}/event`),
        api(`/api/client/${encodeURIComponent(token)}/guests`)
      ]);

    const e = info.event;
    const s = info.summary;

    document.documentElement
      .style
      .setProperty('--brand', e.primary_color);

    document.documentElement
      .style
      .setProperty('--soft', e.accent_color);

    app.innerHTML = `
      <main class="shell">

        ${topbar()}

        <section class="client-head">

          <div
            class="meta"
            style="color:#fff;opacity:.8"
          >
            PAINEL DO CLIENTE
          </div>

          <h1>${esc(e.title)}</h1>

          <p>
            ${fmtDate(e.event_date)}
            ${e.event_time ? ` • ${esc(e.event_time)}` : ''}
          </p>

        </section>

        ${summaryHtml(s)}

        <div class="section-title">

          <h2>Lista de convidados</h2>

          <div class="actions">

            <button
              class="btn secondary small"
              id="export"
            >
              Exportar CSV
            </button>

            <button
              class="btn"
              id="addGuest"
            >
              + Adicionar
            </button>

          </div>

        </div>

        <div class="toolbar">

          <input
            class="search"
            id="search"
            placeholder="Buscar convidado"
          >

          <select
            id="filter"
            class="search"
            style="flex:0 0 180px"
          >

            <option value="">
              Todos
            </option>

            <option value="yes">
              Confirmados
            </option>

            <option value="no">
              Não irão
            </option>

            <option value="pending">
              Pendentes
            </option>

          </select>

        </div>

        <div id="guestTable">
          ${guestTable(list.guests, true)}
        </div>

        <p
          class="subtle"
          style="margin-top:18px"
        >
          Alterações feitas aqui ficam restritas a este evento.
        </p>

      </main>
    `;

    document.querySelector('#export').onclick =
      () => {
        location.href =
          `/api/client/${encodeURIComponent(token)}/export.csv`;
      };

    document.querySelector('#addGuest').onclick =
      () =>
        guestModal({
          eventId:e.id,
          role:'client',
          token
        });

    let t;

    const refresh = async () => {
      const q = encodeURIComponent(
        document.querySelector('#search').value
      );

      const st =
        document.querySelector('#filter').value;

      const d = await api(
        `/api/client/${encodeURIComponent(token)}/guests?q=${q}&status=${st}`
      );

      document.querySelector('#guestTable').innerHTML =
        guestTable(d.guests, true);

      bindGuestActions(
        e.id,
        'client',
        token
      );
    };

    document.querySelector('#search').oninput =
      () => {
        clearTimeout(t);
        t = setTimeout(refresh, 250);
      };

    document.querySelector('#filter').onchange =
      refresh;

    bindGuestActions(
      e.id,
      'client',
      token
    );

  } catch (err) {
    app.innerHTML = `
      <main class="shell">
        ${topbar()}

        <div class="card panel">
          <h1>Acesso indisponível</h1>
          <p>${esc(err.message)}</p>
        </div>
      </main>
    `;
  }
}

async function publicApp(slug) {
  try {
    const {
      event,
      turnstile_sitekey
    } = await api(
      `/api/public/events/${encodeURIComponent(slug)}`
    );

    document.documentElement
      .style
      .setProperty('--brand', event.primary_color);

    document.documentElement
      .style
      .setProperty('--soft', event.accent_color);

    const bg =
      event.background_image_url
        ? `background-image:url('${event.background_image_url.replace(/'/g,'%27')}')`
        : '';

    app.innerHTML = `
      <main
        class="public-page"
        style="${bg}"
      >

        <section class="public-card">

          <div class="eyebrow">
            Confirmação de presença
          </div>

          <h1>
            ${esc(event.title)}
          </h1>

          <div class="date">
            ${fmtDate(event.event_date)}
            ${
              event.event_time
                ? ` • ${esc(event.event_time)}`
                : ''
            }
          </div>

          <p>
            ${
              esc(
                event.welcome_message ||
                'Confirme sua presença para que tudo seja preparado com carinho.'
              )
            }
          </p>

          <div id="publicFlow"></div>

        </section>

      </main>
    `;

    event.rsvp_mode === 'list'
      ? renderLookup(
          event,
          turnstile_sitekey
        )
      : renderRsvp(
          event,
          turnstile_sitekey
        );

  } catch (err) {
    app.innerHTML = `
      <main class="public-page">

        <section class="public-card">

          <h1>
            Convite indisponível
          </h1>

          <p>
            ${esc(err.message)}
          </p>

        </section>

      </main>
    `;
  }
}

function renderLookup(
  event,
  sitekey
) {
  const root =
    document.querySelector('#publicFlow');

  root.innerHTML = `
    <form id="lookup">

      <div class="field">

        <label>
          Digite seu nome completo
        </label>

        <input
          name="name"
          autocomplete="name"
          required
          placeholder="Como está na lista"
        >

      </div>

      <button
        class="btn"
        type="submit"
      >
        Encontrar meu convite
      </button>

    </form>
  `;

  root.querySelector('form').onsubmit =
    async e => {

      e.preventDefault();

      try {
        const d = await api(
          `/api/public/events/${encodeURIComponent(event.slug)}/lookup`,
          {
            method:'POST',

            body:JSON.stringify({
              name:new FormData(
                e.currentTarget
              ).get('name')
            })
          }
        );

        renderRsvp(
          event,
          sitekey,
          d.guest
        );

      } catch (err) {
        toast(err.message, true);
      }
    };
}

function renderRsvp(
  event,
  sitekey,
  guest=null
) {
  const root =
    document.querySelector('#publicFlow');

  const f =
    event.extra_fields || {};

  root.innerHTML = `
    <form id="rsvp">

      <div class="field">

        <label>Nome</label>

        <input
          name="primary_name"
          autocomplete="name"
          required
          ${guest ? 'readonly' : ''}
          value="${esc(guest?.primary_name || '')}"
        >

      </div>

      <div class="choice">

        <button
          type="button"
          data-choice="yes"
          class="active"
        >
          ✓ Estarei presente
        </button>

        <button
          type="button"
          data-choice="no"
        >
          Não poderei ir
        </button>

      </div>

      <input
        type="hidden"
        name="response_status"
        value="yes"
      >

      ${
        f.phone
          ? `
            <div class="field">
              <label>Telefone</label>
              <input
                name="phone"
                inputmode="tel"
              >
            </div>
          `
          : ''
      }

      ${
        f.adults_children !== false
          ? `
            <div class="row">

              <div class="field">
                <label>Adultos</label>

                <input
                  type="number"
                  name="adults"
                  min="0"
                  value="${guest?.adults ?? 1}"
                >
              </div>

              <div class="field">
                <label>Crianças</label>

                <input
                  type="number"
                  name="children"
                  min="0"
                  value="${guest?.children ?? 0}"
                >
              </div>

            </div>
          `
          : ''
      }

      ${
        f.companions !== false
          ? `
            <div class="field">

              <label>
                Nome dos acompanhantes
              </label>

              <textarea
                name="companions"
                rows="3"
                placeholder="Um nome por linha"
              ></textarea>

            </div>
          `
          : ''
      }

      ${
        f.dietary
          ? `
            <div class="field">
              <label>
                Restrição alimentar
              </label>

              <input name="dietary">
            </div>
          `
          : ''
      }

      ${
        f.notes
          ? `
            <div class="field">
              <label>Observação</label>

              <textarea name="notes"></textarea>
            </div>
          `
          : ''
      }

      <div id="turnstile"></div>

      <button
        class="btn"
        type="submit"
      >
        Enviar confirmação
      </button>

    </form>
  `;

  let turnstileToken = null;

  if (sitekey) {
    const s =
      document.createElement('script');

    s.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

    s.async = true;
    s.defer = true;

    s.onload = () =>
      window.turnstile.render(
        '#turnstile',
        {
          sitekey,
          callback:t =>
            turnstileToken = t
        }
      );

    document.head.append(s);
  }

  root
    .querySelectorAll('[data-choice]')
    .forEach(b => {

      b.onclick = () => {

        root
          .querySelectorAll('[data-choice]')
          .forEach(x =>
            x.classList.remove('active')
          );

        b.classList.add('active');

        root
          .querySelector(
            '[name=response_status]'
          )
          .value =
            b.dataset.choice;
      };
    });

  root.querySelector('form').onsubmit =
    async e => {

      e.preventDefault();

      const fd =
        new FormData(e.currentTarget);

      const btn =
        e.submitter;

      btn.disabled = true;

      try {
        await api(
          `/api/public/events/${encodeURIComponent(event.slug)}/rsvp`,
          {
            method:'POST',

            body:JSON.stringify({
              guest_id:guest?.id || null,
              primary_name:fd.get('primary_name'),
              response_status:fd.get('response_status'),
              phone:fd.get('phone'),
              adults:fd.get('adults') || 1,
              children:fd.get('children') || 0,

              companions:String(
                fd.get('companions') || ''
              )
                .split('\n')
                .map(x => x.trim())
                .filter(Boolean),

              dietary:fd.get('dietary'),
              notes:fd.get('notes'),
              turnstile_token:turnstileToken
            })
          }
        );

        root.innerHTML = `
          <div class="success">

            <div class="bubble">
              ✓
            </div>

            <h2>
              ${
                fd.get('response_status') === 'yes'
                  ? 'Presença confirmada!'
                  : 'Resposta registrada'
              }
            </h2>

            <p>
              ${
                fd.get('response_status') === 'yes'
                  ? 'Que bom ter você com a gente. 💛'
                  : 'Obrigada por avisar.'
              }
            </p>

          </div>
        `;

      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    };
}

async function copy(text) {
  if (!text) {
    return toast(
      'Link ainda não disponível.',
      true
    );
  }

  await navigator.clipboard.writeText(text);

  toast('Link copiado.');
}
