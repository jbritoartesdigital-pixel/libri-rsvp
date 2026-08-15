const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");
const path = location.pathname;

let toastTimer;

// =========================================================
// HELPERS
// =========================================================

const esc = (value = "") =>
  String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char]));

const fmtDate = (date) =>
  date
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "medium",
      }).format(new Date(`${date}T12:00:00`))
    : "Data não informada";

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const contentType =
    response.headers.get("content-type") || "";

  const data = contentType.includes("json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw Object.assign(
      new Error(
        data?.error ||
          "Não foi possível concluir."
      ),
      {
        status: response.status,
        data,
      }
    );
  }

  return data;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);

  toastEl.textContent = message;

  toastEl.className =
    `toast show${error ? " error" : ""}`;

  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
  }, 3200);
}

function topbar(extra = "") {
  return `
    <div class="topbar">

      <div class="brand">

        <div class="mark">
          L
        </div>

        <div>
          <h1>Libri RSVP</h1>
          <small>
            Confirmação de presença
          </small>
        </div>

      </div>

      ${extra}

    </div>
  `;
}

// =========================================================
// ROTAS
// =========================================================

if (
  path === "/admin" ||
  path === "/admin/"
) {
  adminApp();
} else if (
  path.startsWith("/cliente/")
) {
  clientApp(
    decodeURIComponent(
      path.split("/")[2] || ""
    )
  );
} else if (
  path.startsWith("/e/")
) {
  publicApp(
    path.split("/")[2] || ""
  );
} else {
  home();
}

// =========================================================
// HOME
// =========================================================

function home() {
  app.innerHTML = `
    <main class="shell">

      ${topbar()}

      <section class="card panel">

        <h1>
          Libri RSVP
        </h1>

        <p class="meta">
          Ferramenta de confirmação de presença.
        </p>

        <div class="actions">

          <a
            class="btn"
            href="/admin"
          >
            Área Libri
          </a>

        </div>

      </section>

    </main>
  `;
}

// =========================================================
// LOGIN ADMIN
// =========================================================

async function adminApp() {
  app.innerHTML = `
    <main class="shell">

      ${topbar()}

      <div class="card panel">

        <h1>
          Entrar na área Libri
        </h1>

        <p class="meta">
          Use sua senha administrativa.
        </p>

        <form id="login">

          <div class="field">

            <label>
              Senha
            </label>

            <input
              name="password"
              type="password"
              autocomplete="current-password"
              required
            >

          </div>

          <button
            class="btn"
            type="submit"
          >
            Entrar
          </button>

        </form>

      </div>

    </main>
  `;

  try {
    await api("/api/admin/me");

    await renderAdminDashboard();

    return;
  } catch {}

  document
    .querySelector("#login")
    ?.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const button =
          event.submitter;

        button.disabled = true;

        try {
          await api(
            "/api/admin/login",
            {
              method: "POST",

              body: JSON.stringify({
                password:
                  new FormData(
                    event.currentTarget
                  ).get("password"),
              }),
            }
          );

          await renderAdminDashboard();
        } catch (error) {
          toast(
            error.message,
            true
          );
        } finally {
          button.disabled = false;
        }
      }
    );
}

// =========================================================
// DASHBOARD ADMIN
// =========================================================

async function renderAdminDashboard() {
  const data =
    await api(
      "/api/admin/events"
    );

  app.innerHTML = `
    <main class="shell">

      ${topbar(`
        <button
          class="btn secondary small"
          id="logout"
        >
          Sair
        </button>
      `)}

      <section class="grid">

        <div class="card hero">

          <div>

            <span class="chip">
              PAINEL LIBRI
            </span>

            <h2>
              Seus eventos em um só lugar.
            </h2>

            <p>
              Crie eventos, acompanhe confirmações
              e entregue à cliente um painel privado.
            </p>

          </div>

          <button
            class="btn"
            id="newEvent"
          >
            + Criar evento
          </button>

        </div>

      </section>

      <div class="section-title">

        <h2>
          Eventos
        </h2>

        <span class="meta">
          ${data.events.length}
          cadastrado(s)
        </span>

      </div>

      <div
        class="events"
        id="events"
      >

        ${
          data.events.length
            ? data.events
                .map(eventCard)
                .join("")
            : `
              <div class="empty">
                Nenhum evento ainda.
                Crie o primeiro evento.
              </div>
            `
        }

      </div>

    </main>
  `;

  document
    .querySelector("#logout")
    .onclick = async () => {
      await api(
        "/api/admin/logout",
        {
          method: "POST",
          body: "{}",
        }
      );

      adminApp();
    };

  document
    .querySelector("#newEvent")
    .onclick = () => {
      createEventModal();
    };

  document
    .querySelectorAll(
      "[data-event]"
    )
    .forEach((button) => {
      button.onclick = () =>
        renderAdminEvent(
          button.dataset.event
        );
    });
}

function eventCard(event) {
  return `
    <article class="event-card">

      <div class="meta">

        ${fmtDate(event.event_date)}

        ${
          event.event_time
            ? ` • ${esc(event.event_time)}`
            : ""
        }

      </div>

      <h3>
        ${esc(event.title)}
      </h3>

      <div class="chips">

        <span class="chip">

          ${
            event.rsvp_mode === "list"
              ? "Lista controlada"
              : "Confirmação livre"
          }

        </span>

        <span class="chip">

          ${
            event.status === "active"
              ? "Ativo"
              : "Inativo"
          }

        </span>

      </div>

      <div class="stats">

        <div class="stat good">

          <strong>
            ${event.yes_responses}
          </strong>

          <span>
            sim
          </span>

        </div>

        <div class="stat bad">

          <strong>
            ${event.no_responses}
          </strong>

          <span>
            não
          </span>

        </div>

        <div class="stat pending">

          <strong>
            ${event.pending_responses}
          </strong>

          <span>
            pend.
          </span>

        </div>

        <div class="stat">

          <strong>
            ${event.people_confirmed}
          </strong>

          <span>
            pessoas
          </span>

        </div>

      </div>

      <button
        class="btn secondary"
        data-event="${esc(event.id)}"
      >
        Abrir painel
      </button>

    </article>
  `;
}

// =========================================================
// CRIAR EVENTO
// =========================================================

function createEventModal() {
  const wrap =
    document.createElement("div");

  wrap.className =
    "modal-backdrop";

  wrap.innerHTML = `
    <div class="modal">

      <button
        class="close"
        type="button"
      >
        ×
      </button>

      <h2>
        Novo evento
      </h2>

      <form>

        <div class="field">

          <label>
            Nome do evento
          </label>

          <input
            name="title"
            placeholder="Helena • 1 aninho"
            required
          >

        </div>

        <div class="row">

          <div class="field">

            <label>
              Data
            </label>

            <input
              type="date"
              name="event_date"
            >

          </div>

          <div class="field">

            <label>
              Horário
            </label>

            <input
              type="time"
              name="event_time"
            >

          </div>

        </div>

        <div class="field">

          <label>
            Tipo de confirmação
          </label>

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

          <label>
            Mensagem para os convidados
          </label>

          <textarea
            name="welcome_message"
            rows="3"
            placeholder="Ficaremos muito felizes em celebrar com você!"
          ></textarea>

        </div>

        <div class="row">

          <div class="field">

            <label>
              Cor principal
            </label>

            <input
              type="color"
              name="primary_color"
              value="#6f4f5f"
            >

          </div>

          <div class="field">

            <label>
              Cor suave
            </label>

            <input
              type="color"
              name="accent_color"
              value="#f4e8ed"
            >

          </div>

        </div>

        <div class="divider"></div>

        <strong>
          Campos da confirmação
        </strong>

        <p class="subtle">
          Escolha o que o convidado deverá preencher.
        </p>

        <div class="checks">

          <label class="check">

            <input
              type="checkbox"
              name="adults_children"
              checked
            >

            Adultos e crianças

          </label>

          <label class="check">

            <input
              type="checkbox"
              name="companions"
              checked
            >

            Nome dos acompanhantes

          </label>

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

  wrap
    .querySelector(".close")
    .onclick = () => {
      wrap.remove();
    };

  wrap.onclick = (event) => {
    if (event.target === wrap) {
      wrap.remove();
    }
  };

  wrap
    .querySelector("form")
    .onsubmit = async (event) => {
      event.preventDefault();

      const form =
        new FormData(
          event.currentTarget
        );

      const button =
        event.submitter;

      button.disabled = true;

      try {
        const data = await api(
          "/api/admin/events",
          {
            method: "POST",

            body: JSON.stringify({
              title:
                form.get("title"),

              event_date:
                form.get("event_date"),

              event_time:
                form.get("event_time"),

              rsvp_mode:
                form.get("rsvp_mode"),

              welcome_message:
                form.get(
                  "welcome_message"
                ),

              primary_color:
                form.get(
                  "primary_color"
                ),

              accent_color:
                form.get(
                  "accent_color"
                ),

              extra_fields: {
                adults_children:
                  form.has(
                    "adults_children"
                  ),

                companions:
                  form.has(
                    "companions"
                  ),

                phone:
                  form.has(
                    "phone"
                  ),

                dietary:
                  form.has(
                    "dietary"
                  ),

                notes:
                  form.has(
                    "notes"
                  ),
              },
            }),
          }
        );

        wrap.remove();

        toast(
          "Evento criado. ✨"
        );

        renderAdminEvent(
          data.event.id
        );
      } catch (error) {
        toast(
          error.message,
          true
        );
      } finally {
        button.disabled = false;
      }
    };
}

// =========================================================
// EDITAR EVENTO
// =========================================================

function editEventModal(eventData) {
  const fields =
    eventData.extra_fields || {};

  const wrap =
    document.createElement("div");

  wrap.className =
    "modal-backdrop";

  wrap.innerHTML = `
    <div class="modal">

      <button
        class="close"
        type="button"
      >
        ×
      </button>

      <h2>
        Editar evento
      </h2>

      <p class="subtle">
        Alterar o nome não muda o link público já criado.
      </p>

      <form>

        <div class="field">

          <label>
            Nome do evento
          </label>

          <input
            name="title"
            required
            value="${esc(
              eventData.title
            )}"
          >

        </div>

        <div class="row">

          <div class="field">

            <label>
              Data
            </label>

            <input
              type="date"
              name="event_date"
              value="${esc(
                eventData.event_date || ""
              )}"
            >

          </div>

          <div class="field">

            <label>
              Horário
            </label>

            <input
              type="time"
              name="event_time"
              value="${esc(
                eventData.event_time || ""
              )}"
            >

          </div>

        </div>

        <div class="field">

          <label>
            Tipo de confirmação
          </label>

          <select name="rsvp_mode">

            <option
              value="free"
              ${
                eventData.rsvp_mode === "free"
                  ? "selected"
                  : ""
              }
            >
              Confirmação livre
            </option>

            <option
              value="list"
              ${
                eventData.rsvp_mode === "list"
                  ? "selected"
                  : ""
              }
            >
              Lista pré-cadastrada
            </option>

          </select>

        </div>

        <div class="field">

          <label>
            Mensagem para os convidados
          </label>

          <textarea
            name="welcome_message"
            rows="3"
          >${esc(
            eventData.welcome_message || ""
          )}</textarea>

        </div>

        <div class="row">

          <div class="field">

            <label>
              Cor principal
            </label>

            <input
              type="color"
              name="primary_color"
              value="${esc(
                eventData.primary_color ||
                  "#6f4f5f"
              )}"
            >

          </div>

          <div class="field">

            <label>
              Cor suave
            </label>

            <input
              type="color"
              name="accent_color"
              value="${esc(
                eventData.accent_color ||
                  "#f4e8ed"
              )}"
            >

          </div>

        </div>

        <div class="divider"></div>

        <strong>
          Campos da confirmação
        </strong>

        <p class="subtle">
          Você pode ativar ou retirar perguntas sem alterar o link.
        </p>

        <div class="checks">

          <label class="check">

            <input
              type="checkbox"
              name="adults_children"
              ${
                fields.adults_children !== false
                  ? "checked"
                  : ""
              }
            >

            Adultos e crianças

          </label>

          <label class="check">

            <input
              type="checkbox"
              name="companions"
              ${
                fields.companions !== false
                  ? "checked"
                  : ""
              }
            >

            Nome dos acompanhantes

          </label>

          <label class="check">

            <input
              type="checkbox"
              name="phone"
              ${
                fields.phone
                  ? "checked"
                  : ""
              }
            >

            Telefone

          </label>

          <label class="check">

            <input
              type="checkbox"
              name="dietary"
              ${
                fields.dietary
                  ? "checked"
                  : ""
              }
            >

            Restrição alimentar

          </label>

          <label class="check">

            <input
              type="checkbox"
              name="notes"
              ${
                fields.notes
                  ? "checked"
                  : ""
              }
            >

            Observações

          </label>

        </div>

        <div class="divider"></div>

        <button
          class="btn"
          type="submit"
        >
          Salvar alterações
        </button>

      </form>

    </div>
  `;

  document.body.append(wrap);

  wrap
    .querySelector(".close")
    .onclick = () => {
      wrap.remove();
    };

  wrap.onclick = (event) => {
    if (event.target === wrap) {
      wrap.remove();
    }
  };

  wrap
    .querySelector("form")
    .onsubmit = async (event) => {
      event.preventDefault();

      const form =
        new FormData(
          event.currentTarget
        );

      const button =
        event.submitter;

      button.disabled = true;

      try {
        await api(
          `/api/admin/events/${eventData.id}`,
          {
            method: "PATCH",

            body: JSON.stringify({
              title:
                form.get("title"),

              event_date:
                form.get("event_date"),

              event_time:
                form.get("event_time"),

              rsvp_mode:
                form.get("rsvp_mode"),

              welcome_message:
                form.get(
                  "welcome_message"
                ),

              primary_color:
                form.get(
                  "primary_color"
                ),

              accent_color:
                form.get(
                  "accent_color"
                ),

              extra_fields: {
                adults_children:
                  form.has(
                    "adults_children"
                  ),

                companions:
                  form.has(
                    "companions"
                  ),

                phone:
                  form.has(
                    "phone"
                  ),

                dietary:
                  form.has(
                    "dietary"
                  ),

                notes:
                  form.has(
                    "notes"
                  ),
              },
            }),
          }
        );

        wrap.remove();

        toast(
          "Evento atualizado."
        );

        await renderAdminEvent(
          eventData.id
        );
      } catch (error) {
        toast(
          error.message,
          true
        );

        button.disabled = false;
      }
    };
}

// =========================================================
// PAINEL DO EVENTO
// =========================================================

async function renderAdminEvent(id) {
  const [info, list] =
    await Promise.all([
      api(
        `/api/admin/events/${id}`
      ),

      api(
        `/api/admin/events/${id}/guests`
      ),
    ]);

  const event =
    info.event;

  const summary =
    info.summary;

  app.innerHTML = `
    <main class="shell">

      ${topbar(`
        <div class="actions">

          <button
            class="btn secondary small"
            id="back"
          >
            ← Eventos
          </button>

          <button
            class="btn small"
            id="editEvent"
          >
            Editar evento
          </button>

        </div>
      `)}

      <section
        class="client-head"
        style="--brand:${esc(
          event.primary_color
        )}"
      >

        <div
          class="meta"
          style="color:#fff;opacity:.8"
        >
          ${fmtDate(event.event_date)}

          ${
            event.event_time
              ? ` • ${esc(
                  event.event_time
                )}`
              : ""
          }
        </div>

        <h1>
          ${esc(event.title)}
        </h1>

        <p>

          ${
            event.rsvp_mode === "list"
              ? "Lista pré-cadastrada"
              : "Confirmação livre"
          }

          •

          ${
            event.status === "active"
              ? "Ativo"
              : "Inativo"
          }

        </p>

      </section>

      ${summaryHtml(summary)}

      <div
        class="grid"
        style="margin-top:18px"
      >

        <section
          class="card"
          style="grid-column:span 12"
        >

          <div class="section-title">

            <h3>
              Links
            </h3>

          </div>

          <div class="field">

            <label>
              Convidados
            </label>

            <div
              class="codebox"
              id="publicUrl"
            >
              ${esc(
                location.origin +
                  "/e/" +
                  event.slug
              )}
            </div>

          </div>

          <div class="field">

            <label>
              Cliente
            </label>

            <div
              class="codebox"
              id="clientUrl"
            >
              ${esc(
                info.client_url ||
                  "Link não disponível."
              )}
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

        <h2>
          Convidados
        </h2>

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

        ${guestTable(
          list.guests,
          true
        )}

      </div>

    </main>
  `;

  document
    .querySelector("#back")
    .onclick =
      renderAdminDashboard;

  document
    .querySelector("#editEvent")
    .onclick = () => {
      editEventModal(event);
    };

  document
    .querySelector("#copyPublic")
    .onclick = () =>
      copy(
        location.origin +
          "/e/" +
          event.slug
      );

  document
    .querySelector("#copyClient")
    .onclick = () =>
      copy(
        info.client_url
      );

  document
    .querySelector("#resetClient")
    .onclick =
      async () => {
        if (
          !confirm(
            "O link atual da cliente deixará de funcionar. Continuar?"
          )
        ) {
          return;
        }

        try {
          const data =
            await api(
              `/api/admin/events/${id}/client-link/reset`,
              {
                method: "POST",
                body: "{}",
              }
            );

          document
            .querySelector(
              "#clientUrl"
            )
            .textContent =
              data.client_url;

          toast(
            "Novo link gerado."
          );
        } catch (error) {
          toast(
            error.message,
            true
          );
        }
      };

  document
    .querySelector("#export")
    .onclick = () => {
      location.href =
        `/api/admin/events/${id}/export.csv`;
    };

  document
    .querySelector("#addGuest")
    .onclick = () =>
      guestModal({
        eventId: id,
        role: "admin",
      });

  let timer;

  const refresh =
    async () => {
      const query =
        encodeURIComponent(
          document
            .querySelector(
              "#search"
            )
            .value
        );

      const status =
        document
          .querySelector(
            "#filter"
          )
          .value;

      const data =
        await api(
          `/api/admin/events/${id}/guests?q=${query}&status=${status}`
        );

      document
        .querySelector(
          "#guestTable"
        )
        .innerHTML =
          guestTable(
            data.guests,
            true
          );

      bindGuestActions(
        id,
        "admin"
      );
    };

  document
    .querySelector("#search")
    .oninput = () => {
      clearTimeout(timer);

      timer =
        setTimeout(
          refresh,
          250
        );
    };

  document
    .querySelector("#filter")
    .onchange =
      refresh;

  bindGuestActions(
    id,
    "admin"
  );
}

function summaryHtml(summary) {
  return `
    <div class="stats">

      <div class="stat good">

        <strong>
          ${summary.yes_responses}
        </strong>

        <span>
          Confirmações positivas
        </span>

      </div>

      <div class="stat bad">

        <strong>
          ${summary.no_responses}
        </strong>

        <span>
          Não irão
        </span>

      </div>

      <div class="stat pending">

        <strong>
          ${summary.pending_responses}
        </strong>

        <span>
          Pendentes
        </span>

      </div>

      <div class="stat">

        <strong>
          ${summary.people_confirmed}
        </strong>

        <span>
          Pessoas confirmadas
        </span>

      </div>

    </div>
  `;
}

// =========================================================
// TABELA CONVIDADOS
// =========================================================

function guestTable(
  guests,
  editable
) {
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

            <th>
              Nome
            </th>

            <th>
              Status
            </th>

            <th>
              Pessoas
            </th>

            <th>
              Telefone
            </th>

            <th>
              Origem
            </th>

            ${
              editable
                ? "<th>Ações</th>"
                : ""
            }

          </tr>

        </thead>

        <tbody>

          ${
            guests
              .map(
                (guest) => `
              <tr>

                <td>

                  <strong>
                    ${esc(
                      guest.primary_name
                    )}
                  </strong>

                  ${
                    guest.companions
                      .length
                      ? `
                        <div class="subtle">
                          + ${esc(
                            guest.companions.join(
                              ", "
                            )
                          )}
                        </div>
                      `
                      : ""
                  }

                </td>

                <td>

                  <span
                    class="status ${guest.response_status}"
                  >

                    ${
                      guest.response_status ===
                      "yes"
                        ? "Confirmado"
                        : guest.response_status ===
                            "no"
                          ? "Não irá"
                          : "Pendente"
                    }

                  </span>

                </td>

                <td>

                  ${
                    guest.response_status ===
                    "no"
                      ? 0
                      : guest.adults +
                        guest.children
                  }

                </td>

                <td>
                  ${esc(
                    guest.phone ||
                      "—"
                  )}
                </td>

                <td>
                  ${esc(
                    guest.source ||
                      "—"
                  )}
                </td>

                ${
                  editable
                    ? `
                      <td>

                        <div class="actions">

                          <button
                            class="btn secondary small"
                            data-edit="${guest.id}"
                            data-guest='${esc(
                              JSON.stringify(
                                guest
                              )
                            )}'
                          >
                            Editar
                          </button>

                          <button
                            class="btn danger small"
                            data-delete="${guest.id}"
                            data-name="${esc(
                              guest.primary_name
                            )}"
                          >
                            Excluir
                          </button>

                        </div>

                      </td>
                    `
                    : ""
                }

              </tr>
            `
              )
              .join("")
          }

        </tbody>

      </table>

    </div>
  `;
}

function bindGuestActions(
  eventId,
  role,
  token
) {
  document
    .querySelectorAll(
      "[data-edit]"
    )
    .forEach((button) => {
      button.onclick = () =>
        guestModal({
          eventId,
          role,
          token,

          guest:
            JSON.parse(
              button.dataset.guest
            ),
        });
    });

  document
    .querySelectorAll(
      "[data-delete]"
    )
    .forEach((button) => {
      button.onclick =
        async () => {
          if (
            !confirm(
              `Excluir ${button.dataset.name}?`
            )
          ) {
            return;
          }

          try {
            const base =
              role === "client"
                ? `/api/client/${encodeURIComponent(
                    token
                  )}`
                : `/api/admin/events/${eventId}`;

            await api(
              `${base}/guests/${button.dataset.delete}`,
              {
                method:
                  "DELETE",

                body:
                  "{}",
              }
            );

            toast(
              "Convidado excluído."
            );

            if (
              role === "client"
            ) {
              clientApp(token);
            } else {
              renderAdminEvent(
                eventId
              );
            }
          } catch (error) {
            toast(
              error.message,
              true
            );
          }
        };
    });
}

// =========================================================
// MODAL CONVIDADO
// =========================================================

function guestModal({
  eventId,
  role,
  token,
  guest = null,
}) {
  const wrap =
    document.createElement("div");

  wrap.className =
    "modal-backdrop";

  wrap.innerHTML = `
    <div class="modal">

      <button
        class="close"
        type="button"
      >
        ×
      </button>

      <h2>

        ${
          guest
            ? "Editar"
            : "Adicionar"
        }

        convidado

      </h2>

      <form>

        <div class="field">

          <label>
            Nome
          </label>

          <input
            name="primary_name"
            required
            value="${esc(
              guest?.primary_name ||
                ""
            )}"
          >

        </div>

        <div class="row">

          <div class="field">

            <label>
              Status
            </label>

            <select name="response_status">

              <option
                value="pending"
                ${
                  guest?.response_status ===
                  "pending"
                    ? "selected"
                    : ""
                }
              >
                Pendente
              </option>

              <option
                value="yes"
                ${
                  guest?.response_status ===
                  "yes"
                    ? "selected"
                    : ""
                }
              >
                Confirmado
              </option>

              <option
                value="no"
                ${
                  guest?.response_status ===
                  "no"
                    ? "selected"
                    : ""
                }
              >
                Não irá
              </option>

            </select>

          </div>

          <div class="field">

            <label>
              Telefone
            </label>

            <input
              name="phone"
              value="${esc(
                guest?.phone || ""
              )}"
            >

          </div>

        </div>

        <div class="row">

          <div class="field">

            <label>
              Adultos
            </label>

            <input
              type="number"
              min="0"
              name="adults"
              value="${
                guest?.adults ??
                1
              }"
            >

          </div>

          <div class="field">

            <label>
              Crianças
            </label>

            <input
              type="number"
              min="0"
              name="children"
              value="${
                guest?.children ??
                0
              }"
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
          >${esc(
            (
              guest?.companions ||
              []
            ).join("\n")
          )}</textarea>

        </div>

        <div class="field">

          <label>
            Restrição alimentar
          </label>

          <input
            name="dietary"
            value="${esc(
              guest?.dietary ||
                ""
            )}"
          >

        </div>

        <div class="field">

          <label>
            Observações
          </label>

          <textarea
            name="notes"
          >${esc(
            guest?.notes ||
              ""
          )}</textarea>

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

  wrap
    .querySelector(".close")
    .onclick = () => {
      wrap.remove();
    };

  wrap.onclick = (event) => {
    if (event.target === wrap) {
      wrap.remove();
    }
  };

  wrap
    .querySelector("form")
    .onsubmit =
      async (event) => {
        event.preventDefault();

        const form =
          new FormData(
            event.currentTarget
          );

        const button =
          event.submitter;

        button.disabled = true;

        const base =
          role === "client"
            ? `/api/client/${encodeURIComponent(
                token
              )}`
            : `/api/admin/events/${eventId}`;

        const url =
          guest
            ? `${base}/guests/${guest.id}`
            : `${base}/guests`;

        try {
          await api(url, {
            method:
              guest
                ? "PATCH"
                : "POST",

            body:
              JSON.stringify({
                primary_name:
                  form.get(
                    "primary_name"
                  ),

                response_status:
                  form.get(
                    "response_status"
                  ),

                phone:
                  form.get(
                    "phone"
                  ),

                adults:
                  form.get(
                    "adults"
                  ),

                children:
                  form.get(
                    "children"
                  ),

                companions:
                  String(
                    form.get(
                      "companions"
                    ) || ""
                  )
                    .split("\n")
                    .map((item) =>
                      item.trim()
                    )
                    .filter(Boolean),

                dietary:
                  form.get(
                    "dietary"
                  ),

                notes:
                  form.get(
                    "notes"
                  ),
              }),
          });

          wrap.remove();

          toast(
            "Salvo."
          );

          if (
            role === "client"
          ) {
            clientApp(token);
          } else {
            renderAdminEvent(
              eventId
            );
          }
        } catch (error) {
          toast(
            error.message,
            true
          );

          button.disabled = false;
        }
      };
}

// =========================================================
// PAINEL CLIENTE
// =========================================================

async function clientApp(token) {
  try {
    const [info, list] =
      await Promise.all([
        api(
          `/api/client/${encodeURIComponent(
            token
          )}/event`
        ),

        api(
          `/api/client/${encodeURIComponent(
            token
          )}/guests`
        ),
      ]);

    const event =
      info.event;

    const summary =
      info.summary;

    document.documentElement
      .style
      .setProperty(
        "--brand",
        event.primary_color
      );

    document.documentElement
      .style
      .setProperty(
        "--soft",
        event.accent_color
      );

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

          <h1>
            ${esc(event.title)}
          </h1>

          <p>

            ${fmtDate(
              event.event_date
            )}

            ${
              event.event_time
                ? ` • ${esc(
                    event.event_time
                  )}`
                : ""
            }

          </p>

        </section>

        ${summaryHtml(summary)}

        <div class="section-title">

          <h2>
            Lista de convidados
          </h2>

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

          ${guestTable(
            list.guests,
            true
          )}

        </div>

        <p
          class="subtle"
          style="margin-top:18px"
        >
          Alterações feitas aqui ficam restritas a este evento.
        </p>

      </main>
    `;

    document
      .querySelector(
        "#export"
      )
      .onclick = () => {
        location.href =
          `/api/client/${encodeURIComponent(
            token
          )}/export.csv`;
      };

    document
      .querySelector(
        "#addGuest"
      )
      .onclick = () =>
        guestModal({
          eventId:
            event.id,

          role:
            "client",

          token,
        });

    let timer;

    const refresh =
      async () => {
        const query =
          encodeURIComponent(
            document
              .querySelector(
                "#search"
              )
              .value
          );

        const status =
          document
            .querySelector(
              "#filter"
            )
            .value;

        const data =
          await api(
            `/api/client/${encodeURIComponent(
              token
            )}/guests?q=${query}&status=${status}`
          );

        document
          .querySelector(
            "#guestTable"
          )
          .innerHTML =
            guestTable(
              data.guests,
              true
            );

        bindGuestActions(
          event.id,
          "client",
          token
        );
      };

    document
      .querySelector(
        "#search"
      )
      .oninput = () => {
        clearTimeout(timer);

        timer =
          setTimeout(
            refresh,
            250
          );
      };

    document
      .querySelector(
        "#filter"
      )
      .onchange =
        refresh;

    bindGuestActions(
      event.id,
      "client",
      token
    );
  } catch (error) {
    app.innerHTML = `
      <main class="shell">

        ${topbar()}

        <div class="card panel">

          <h1>
            Acesso indisponível
          </h1>

          <p>
            ${esc(error.message)}
          </p>

        </div>

      </main>
    `;
  }
}

// =========================================================
// PÁGINA PÚBLICA
// =========================================================

async function publicApp(slug) {
  try {
    const data =
      await api(
        `/api/public/events/${encodeURIComponent(
          slug
        )}`
      );

    const event =
      data.event;

    document.documentElement
      .style
      .setProperty(
        "--brand",
        event.primary_color
      );

    document.documentElement
      .style
      .setProperty(
        "--soft",
        event.accent_color
      );

    const background =
      event.background_image_url
        ? `background-image:url('${event.background_image_url.replace(
            /'/g,
            "%27"
          )}')`
        : "";

    app.innerHTML = `
      <main
        class="public-page"
        style="${background}"
      >

        <section class="public-card">

          <div class="eyebrow">
            Confirmação de presença
          </div>

          <h1>
            ${esc(event.title)}
          </h1>

          <div class="date">

            ${fmtDate(
              event.event_date
            )}

            ${
              event.event_time
                ? ` • ${esc(
                    event.event_time
                  )}`
                : ""
            }

          </div>

          <p>

            ${esc(
              event.welcome_message ||
                "Confirme sua presença para que tudo seja preparado com carinho."
            )}

          </p>

          <div id="publicFlow"></div>

        </section>

      </main>
    `;

    if (
      event.rsvp_mode ===
      "list"
    ) {
      renderLookup(event);
    } else {
      renderRsvp(event);
    }
  } catch (error) {
    app.innerHTML = `
      <main class="public-page">

        <section class="public-card">

          <h1>
            Convite indisponível
          </h1>

          <p>
            ${esc(error.message)}
          </p>

        </section>

      </main>
    `;
  }
}

// =========================================================
// BUSCAR CONVIDADO
// =========================================================

function renderLookup(event) {
  const root =
    document.querySelector(
      "#publicFlow"
    );

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

  root
    .querySelector("form")
    .onsubmit =
      async (formEvent) => {
        formEvent.preventDefault();

        const button =
          formEvent.submitter;

        button.disabled = true;

        try {
          const data =
            await api(
              `/api/public/events/${encodeURIComponent(
                event.slug
              )}/lookup`,
              {
                method:
                  "POST",

                body:
                  JSON.stringify({
                    name:
                      new FormData(
                        formEvent.currentTarget
                      ).get(
                        "name"
                      ),
                  }),
              }
            );

          renderRsvp(
            event,
            data.guest
          );
        } catch (error) {
          toast(
            error.message,
            true
          );

          button.disabled =
            false;
        }
      };
}

// =========================================================
// RSVP
// =========================================================

function renderRsvp(
  event,
  guest = null
) {
  const root =
    document.querySelector(
      "#publicFlow"
    );

  const fields =
    event.extra_fields ||
    {};

  root.innerHTML = `
    <form id="rsvp">

      <div class="field">

        <label>
          Nome
        </label>

        <input
          name="primary_name"
          autocomplete="name"
          required
          ${
            guest
              ? "readonly"
              : ""
          }
          value="${esc(
            guest?.primary_name ||
              ""
          )}"
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
        fields.phone
          ? `
            <div class="field">

              <label>
                Telefone
              </label>

              <input
                name="phone"
                inputmode="tel"
              >

            </div>
          `
          : ""
      }

      ${
        fields.adults_children !==
        false
          ? `
            <div class="row">

              <div class="field">

                <label>
                  Adultos
                </label>

                <input
                  type="number"
                  name="adults"
                  min="0"
                  value="${
                    guest?.adults ??
                    1
                  }"
                >

              </div>

              <div class="field">

                <label>
                  Crianças
                </label>

                <input
                  type="number"
                  name="children"
                  min="0"
                  value="${
                    guest?.children ??
                    0
                  }"
                >

              </div>

            </div>
          `
          : ""
      }

      ${
        fields.companions !==
        false
          ? `
            <div class="field">

              <label>
                Nome dos acompanhantes
              </label>

              <textarea
                name="companions"
                rows="3"
                placeholder="Um nome por linha"
              >${esc(
                (
                  guest?.companions ||
                  []
                ).join("\n")
              )}</textarea>

            </div>
          `
          : ""
      }

      ${
        fields.dietary
          ? `
            <div class="field">

              <label>
                Restrição alimentar
              </label>

              <input
                name="dietary"
                value="${esc(
                  guest?.dietary ||
                    ""
                )}"
              >

            </div>
          `
          : ""
      }

      ${
        fields.notes
          ? `
            <div class="field">

              <label>
                Observação
              </label>

              <textarea
                name="notes"
              >${esc(
                guest?.notes ||
                  ""
              )}</textarea>

            </div>
          `
          : ""
      }

      <button
        class="btn"
        type="submit"
      >
        Enviar confirmação
      </button>

    </form>
  `;

  root
    .querySelectorAll(
      "[data-choice]"
    )
    .forEach((button) => {
      button.onclick = () => {
        root
          .querySelectorAll(
            "[data-choice]"
          )
          .forEach(
            (item) =>
              item.classList.remove(
                "active"
              )
          );

        button.classList.add(
          "active"
        );

        root
          .querySelector(
            '[name="response_status"]'
          )
          .value =
            button.dataset.choice;
      };
    });

  root
    .querySelector("form")
    .onsubmit =
      async (formEvent) => {
        formEvent.preventDefault();

        const form =
          new FormData(
            formEvent.currentTarget
          );

        const button =
          formEvent.submitter;

        button.disabled = true;

        try {
          await api(
            `/api/public/events/${encodeURIComponent(
              event.slug
            )}/rsvp`,
            {
              method:
                "POST",

              body:
                JSON.stringify({
                  guest_id:
                    guest?.id ||
                    null,

                  primary_name:
                    form.get(
                      "primary_name"
                    ),

                  response_status:
                    form.get(
                      "response_status"
                    ),

                  phone:
                    form.get(
                      "phone"
                    ),

                  adults:
                    form.get(
                      "adults"
                    ) || 1,

                  children:
                    form.get(
                      "children"
                    ) || 0,

                  companions:
                    String(
                      form.get(
                        "companions"
                      ) || ""
                    )
                      .split("\n")
                      .map((item) =>
                        item.trim()
                      )
                      .filter(Boolean),

                  dietary:
                    form.get(
                      "dietary"
                    ),

                  notes:
                    form.get(
                      "notes"
                    ),
                }),
            }
          );

          root.innerHTML = `
            <div class="success">

              <div class="bubble">
                ✓
              </div>

              <h2>

                ${
                  form.get(
                    "response_status"
                  ) === "yes"
                    ? "Presença confirmada!"
                    : "Resposta registrada"
                }

              </h2>

              <p>

                ${
                  form.get(
                    "response_status"
                  ) === "yes"
                    ? "Que bom ter você com a gente. 💛"
                    : "Obrigada por avisar."
                }

              </p>

            </div>
          `;
        } catch (error) {
          toast(
            error.message,
            true
          );

          button.disabled = false;
        }
      };
}

// =========================================================
// COPIAR
// =========================================================

async function copy(text) {
  if (!text) {
    return toast(
      "Link ainda não disponível.",
      true
    );
  }

  try {
    await navigator.clipboard.writeText(
      text
    );

    toast(
      "Link copiado."
    );
  } catch {
    toast(
      "Não foi possível copiar o link.",
      true
    );
  }
}
