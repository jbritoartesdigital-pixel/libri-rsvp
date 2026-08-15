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

const fmtDateTime = (value) => {
  if (!value) {
    return "Data não informada";
  }

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

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

  const data =
    contentType.includes("json")
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
  }, 3500);
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

function statusLabel(status) {
  if (status === "yes") {
    return "Confirmado";
  }

  if (status === "no") {
    return "Não irá";
  }

  return "Pendente";
}

function sourceLabel(source) {
  const labels = {
    admin: "Libri",
    client: "Cliente",
    public: "Convidado",
    import: "Importação",
  };

  return labels[source] || source || "—";
}

function actorLabel(role) {
  const labels = {
    admin: "Libri",
    client: "Cliente",
    public: "Convidado",
    system: "Sistema",
  };

  return labels[role] || role;
}

function actionLabel(action) {
  const labels = {
    event_created: "Evento criado",
    event_updated: "Evento editado",
    event_paused: "Confirmações pausadas",
    event_reactivated: "Confirmações reativadas",
    event_archived: "Evento arquivado",
    event_unarchived: "Evento restaurado",
    client_link_reset: "Link da cliente substituído",
    guest_created: "Convidado adicionado",
    guest_updated: "Convidado editado",
    guest_deleted: "Convidado excluído",
    guest_restored: "Convidado restaurado",
    rsvp_submitted: "Confirmação enviada",
  };

  return labels[action] || action;
}

function closeModal(wrap) {
  wrap.remove();
}

function modalShell(
  title,
  content,
  subtitle = ""
) {
  const wrap =
    document.createElement("div");

  wrap.className =
    "modal-backdrop";

  wrap.innerHTML = `
    <div class="modal">

      <button
        class="close"
        type="button"
        aria-label="Fechar"
      >
        ×
      </button>

      <h2>
        ${esc(title)}
      </h2>

      ${
        subtitle
          ? `
            <p class="subtle">
              ${esc(subtitle)}
            </p>
          `
          : ""
      }

      ${content}

    </div>
  `;

  document.body.append(wrap);

  wrap
    .querySelector(".close")
    .onclick = () =>
      closeModal(wrap);

  wrap.onclick = (event) => {
    if (event.target === wrap) {
      closeModal(wrap);
    }
  };

  return wrap;
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
          Plataforma de confirmação de presença.
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
          Acesso administrativo.
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

async function renderAdminDashboard(
  showArchived = false
) {
  const data =
    await api(
      `/api/admin/events${
        showArchived
          ? "?archived=1"
          : ""
      }`
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
              Acompanhe confirmações, clientes,
              listas, mensagens e histórico.
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

        <div>

          <h2>
            ${
              showArchived
                ? "Eventos arquivados"
                : "Eventos ativos"
            }
          </h2>

          <span class="meta">
            ${data.events.length}
            cadastrado(s)
          </span>

        </div>

        <button
          class="btn secondary small"
          id="toggleArchived"
        >
          ${
            showArchived
              ? "← Voltar aos ativos"
              : "Ver arquivados"
          }
        </button>

      </div>

      <div
        class="events"
        id="events"
      >

        ${
          data.events.length
            ? data.events
                .map(
                  (event) =>
                    eventCard(
                      event,
                      showArchived
                    )
                )
                .join("")
            : `
              <div class="empty">

                ${
                  showArchived
                    ? "Nenhum evento arquivado."
                    : "Nenhum evento ativo ainda."
                }

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
    .querySelector(
      "#toggleArchived"
    )
    .onclick = () => {
      renderAdminDashboard(
        !showArchived
      );
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

  document
    .querySelectorAll(
      "[data-unarchive]"
    )
    .forEach((button) => {
      button.onclick =
        async () => {
          try {
            await api(
              `/api/admin/events/${button.dataset.unarchive}/unarchive`,
              {
                method: "POST",
                body: "{}",
              }
            );

            toast(
              "Evento restaurado."
            );

            renderAdminDashboard(
              true
            );
          } catch (error) {
            toast(
              error.message,
              true
            );
          }
        };
    });
}

function eventCard(
  event,
  archivedView = false
) {
  return `
    <article class="event-card">

      <div class="meta">

        ${fmtDate(event.event_date)}

        ${
          event.event_time
            ? ` • ${esc(
                event.event_time
              )}`
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
            event.archived_at
              ? "Arquivado"
              : event.accepting_rsvp
                ? "Recebendo confirmações"
                : "Fechado"
          }

        </span>

      </div>

      <div class="stats">

        <div class="stat good">

          <strong>
            ${event.yes_responses}
          </strong>

          <span>
            confirmações
          </span>

        </div>

        <div class="stat bad">

          <strong>
            ${event.no_responses}
          </strong>

          <span>
            recusas
          </span>

        </div>

        <div class="stat">

          <strong>
            ${event.adults_confirmed || 0}
          </strong>

          <span>
            adultos
          </span>

        </div>

        <div class="stat">

          <strong>
            ${event.children_confirmed || 0}
          </strong>

          <span>
            crianças
          </span>

        </div>

      </div>

      <div class="subtle">
        ${
          event.people_confirmed || 0
        }
        pessoa(s) confirmada(s)
      </div>

      <div
        class="actions"
        style="margin-top:14px"
      >

        <button
          class="btn secondary"
          data-event="${esc(event.id)}"
        >
          Abrir painel
        </button>

        ${
          archivedView
            ? `
              <button
                class="btn secondary"
                data-unarchive="${esc(
                  event.id
                )}"
              >
                Restaurar
              </button>
            `
            : ""
        }

      </div>

    </article>
  `;
}

// =========================================================
// FORMULÁRIO DE EVENTO
// =========================================================

function eventFormHtml(
  eventData = null
) {
  const fields =
    eventData?.extra_fields ||
    {};

  return `
    <form id="eventForm">

      <div class="field">

        <label>
          Nome do evento
        </label>

        <input
          name="title"
          required
          placeholder="Helena • 1 aninho"
          value="${esc(
            eventData?.title || ""
          )}"
        >

      </div>

      <div class="row">

        <div class="field">

          <label>
            Data do evento
          </label>

          <input
            type="date"
            name="event_date"
            value="${esc(
              eventData?.event_date ||
                ""
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
              eventData?.event_time ||
                ""
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
              !eventData ||
              eventData.rsvp_mode ===
                "free"
                ? "selected"
                : ""
            }
          >
            Confirmação livre
          </option>

          <option
            value="list"
            ${
              eventData?.rsvp_mode ===
              "list"
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
          placeholder="Ficaremos muito felizes em celebrar com você!"
        >${esc(
          eventData?.welcome_message ||
            ""
        )}</textarea>

      </div>

      <div class="field">

        <label>
          URL da imagem de fundo
        </label>

        <input
          type="url"
          name="background_image_url"
          placeholder="https://..."
          value="${esc(
            eventData?.background_image_url ||
              ""
          )}"
        >

        <span class="subtle">
          Opcional.
        </span>

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
              eventData?.primary_color ||
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
              eventData?.accent_color ||
                "#f4e8ed"
            )}"
          >

        </div>

      </div>

      <div class="divider"></div>

      <h3>
        Regras da confirmação
      </h3>

      <div class="row">

        <div class="field">

          <label>
            Prazo para confirmar
          </label>

          <input
            type="date"
            name="rsvp_deadline"
            value="${esc(
              eventData?.rsvp_deadline ||
                ""
            )}"
          >

          <span class="subtle">
            Deixe vazio para não ter prazo.
          </span>

        </div>

        <div class="field">

          <label>
            Máximo de pessoas por confirmação
          </label>

          <input
            type="number"
            min="1"
            max="100"
            name="max_people_per_rsvp"
            placeholder="Sem limite"
            value="${esc(
              eventData?.max_people_per_rsvp ??
                ""
            )}"
          >

        </div>

      </div>

      <div class="divider"></div>

      <h3>
        Campos opcionais
      </h3>

      <div class="checks">

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

        <label class="check">

          <input
            type="checkbox"
            name="love_message"
            ${
              eventData
                ? fields.love_message !==
                  false
                  ? "checked"
                  : ""
                : "checked"
            }
          >

          Mensagem carinhosa 💌

        </label>

      </div>

      <div class="divider"></div>

      <button
        class="btn"
        type="submit"
      >
        ${
          eventData
            ? "Salvar alterações"
            : "Criar evento"
        }
      </button>

    </form>
  `;
}

function eventPayloadFromForm(
  formElement
) {
  const form =
    new FormData(
      formElement
    );

  return {
    title:
      form.get("title"),

    event_date:
      form.get(
        "event_date"
      ),

    event_time:
      form.get(
        "event_time"
      ),

    rsvp_mode:
      form.get(
        "rsvp_mode"
      ),

    welcome_message:
      form.get(
        "welcome_message"
      ),

    background_image_url:
      form.get(
        "background_image_url"
      ),

    primary_color:
      form.get(
        "primary_color"
      ),

    accent_color:
      form.get(
        "accent_color"
      ),

    rsvp_deadline:
      form.get(
        "rsvp_deadline"
      ),

    max_people_per_rsvp:
      form.get(
        "max_people_per_rsvp"
      ),

    extra_fields: {
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

      love_message:
        form.has(
          "love_message"
        ),
    },
  };
}

function createEventModal() {
  const wrap =
    modalShell(
      "Novo evento",
      eventFormHtml()
    );

  wrap
    .querySelector(
      "#eventForm"
    )
    .onsubmit =
      async (event) => {
        event.preventDefault();

        const button =
          event.submitter;

        button.disabled = true;

        try {
          const data =
            await api(
              "/api/admin/events",
              {
                method: "POST",

                body:
                  JSON.stringify(
                    eventPayloadFromForm(
                      event.currentTarget
                    )
                  ),
              }
            );

          closeModal(wrap);

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

          button.disabled = false;
        }
      };
}

function editEventModal(
  eventData
) {
  const wrap =
    modalShell(
      "Editar evento",
      eventFormHtml(
        eventData
      ),
      "O link público não muda quando você altera o nome."
    );

  wrap
    .querySelector(
      "#eventForm"
    )
    .onsubmit =
      async (event) => {
        event.preventDefault();

        const button =
          event.submitter;

        button.disabled = true;

        try {
          await api(
            `/api/admin/events/${eventData.id}`,
            {
              method: "PATCH",

              body:
                JSON.stringify(
                  eventPayloadFromForm(
                    event.currentTarget
                  )
                ),
            }
          );

          closeModal(wrap);

          toast(
            "Evento atualizado."
          );

          renderAdminEvent(
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
// PAINEL ADMIN DO EVENTO
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
        style="
          background:
            linear-gradient(
              135deg,
              ${esc(
                event.primary_color
              )},
              ${esc(
                event.accent_color
              )}
            );
        "
      >

        <div
          class="meta"
          style="
            color:#fff;
            opacity:.82
          "
        >

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

        <h1>
          ${esc(event.title)}
        </h1>

        <p>

          ${
            event.rsvp_mode ===
            "list"
              ? "Lista pré-cadastrada"
              : "Confirmação livre"
          }

          •

          ${
            event.archived_at
              ? "Arquivado"
              : event.accepting_rsvp
                ? "Recebendo confirmações"
                : "Confirmações fechadas"
          }

        </p>

        ${
          event.closed_reason
            ? `
              <p
                style="
                  margin-top:8px;
                  opacity:.88
                "
              >
                ${esc(
                  event.closed_reason
                )}
              </p>
            `
            : ""
        }

      </section>

      ${summaryHtml(summary)}

      <section
        class="card"
        style="margin-top:18px"
      >

        <div class="section-title">

          <h3>
            Links do evento
          </h3>

        </div>

        <div class="field">

          <label>
            Confirmação pública
          </label>

          <div
            class="codebox"
            id="publicUrl"
          >
            ${esc(
              info.public_url
            )}
          </div>

        </div>

        <div class="field">

          <label>
            Painel da cliente
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
            class="btn secondary small"
            id="openPublic"
          >
            Abrir confirmação
          </button>

          <button
            class="btn danger small"
            id="resetClient"
          >
            Trocar link da cliente
          </button>

        </div>

      </section>

      <section
        class="card"
        style="margin-top:18px"
      >

        <div class="section-title">

          <h3>
            Controle do evento
          </h3>

        </div>

        <div class="actions">

          ${
            !event.archived_at
              ? `
                <button
                  class="btn secondary"
                  id="toggleStatus"
                >

                  ${
                    event.status ===
                    "active"
                      ? "Pausar confirmações"
                      : "Reativar confirmações"
                  }

                </button>

                <button
                  class="btn danger"
                  id="archiveEvent"
                >
                  Arquivar evento
                </button>
              `
              : `
                <button
                  class="btn"
                  id="unarchiveEvent"
                >
                  Restaurar evento
                </button>
              `
          }

          <button
            class="btn secondary"
            id="history"
          >
            Histórico
          </button>

          <button
            class="btn secondary"
            id="trash"
          >
            Lixeira
          </button>

        </div>

      </section>

      <div class="section-title">

        <div>

          <h2>
            Convidados
          </h2>

          <span class="meta">
            Busque também pelo nome de qualquer adulto ou criança.
          </span>

        </div>

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
          placeholder="Buscar nome..."
        >

        <select
          id="filter"
          class="search"
          style="
            flex:0 0 190px
          "
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
    .onclick = () =>
      renderAdminDashboard();

  document
    .querySelector("#editEvent")
    .onclick = () =>
      editEventModal(
        event
      );

  document
    .querySelector("#copyPublic")
    .onclick = () =>
      copy(
        info.public_url
      );

  document
    .querySelector("#copyClient")
    .onclick = () =>
      copy(
        info.client_url
      );

  document
    .querySelector("#openPublic")
    .onclick = () => {
      window.open(
        info.public_url,
        "_blank",
        "noopener"
      );
    };

  document
    .querySelector("#resetClient")
    .onclick =
      async () => {
        if (
          !confirm(
            "O link atual da cliente deixará de funcionar. Deseja continuar?"
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
            "Novo link da cliente gerado."
          );
        } catch (error) {
          toast(
            error.message,
            true
          );
        }
      };

  const toggleStatus =
    document.querySelector(
      "#toggleStatus"
    );

  if (toggleStatus) {
    toggleStatus.onclick =
      async () => {
        const newStatus =
          event.status ===
          "active"
            ? "inactive"
            : "active";

        try {
          await api(
            `/api/admin/events/${id}/status`,
            {
              method: "POST",

              body:
                JSON.stringify({
                  status:
                    newStatus,
                }),
            }
          );

          toast(
            newStatus === "active"
              ? "Confirmações reativadas."
              : "Confirmações pausadas."
          );

          renderAdminEvent(id);
        } catch (error) {
          toast(
            error.message,
            true
          );
        }
      };
  }

  const archiveButton =
    document.querySelector(
      "#archiveEvent"
    );

  if (archiveButton) {
    archiveButton.onclick =
      async () => {
        if (
          !confirm(
            "Arquivar este evento? O link público deixará de receber confirmações, mas os dados serão preservados."
          )
        ) {
          return;
        }

        try {
          await api(
            `/api/admin/events/${id}/archive`,
            {
              method: "POST",
              body: "{}",
            }
          );

          toast(
            "Evento arquivado."
          );

          renderAdminDashboard();
        } catch (error) {
          toast(
            error.message,
            true
          );
        }
      };
  }

  const unarchiveButton =
    document.querySelector(
      "#unarchiveEvent"
    );

  if (unarchiveButton) {
    unarchiveButton.onclick =
      async () => {
        try {
          await api(
            `/api/admin/events/${id}/unarchive`,
            {
              method: "POST",
              body: "{}",
            }
          );

          toast(
            "Evento restaurado."
          );

          renderAdminEvent(id);
        } catch (error) {
          toast(
            error.message,
            true
          );
        }
      };
  }

  document
    .querySelector("#history")
    .onclick = () =>
      historyModal(id);

  document
    .querySelector("#trash")
    .onclick = () =>
      trashModal(id);

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

        maxPeople:
          event.max_people_per_rsvp,
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
        "admin",
        null,
        event.max_people_per_rsvp
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
    "admin",
    null,
    event.max_people_per_rsvp
  );
}

function summaryHtml(summary) {
  return `
    <div class="stats">

      <div class="stat good">

        <strong>
          ${
            summary.people_confirmed ||
            0
          }
        </strong>

        <span>
          pessoas
        </span>

      </div>

      <div class="stat">

        <strong>
          ${
            summary.adults_confirmed ||
            0
          }
        </strong>

        <span>
          adultos
        </span>

      </div>

      <div class="stat">

        <strong>
          ${
            summary.children_confirmed ||
            0
          }
        </strong>

        <span>
          crianças
        </span>

      </div>

      <div class="stat bad">

        <strong>
          ${
            summary.no_responses ||
            0
          }
        </strong>

        <span>
          não irão
        </span>

      </div>

    </div>
  `;
}

// =========================================================
// HISTÓRICO
// =========================================================

async function historyModal(
  eventId
) {
  try {
    const data =
      await api(
        `/api/admin/events/${eventId}/audit?limit=200`
      );

    const content =
      data.logs.length
        ? `
          <div class="history-list">

            ${data.logs
              .map(
                (log) => `
              <div
                class="card"
                style="
                  box-shadow:none;
                  margin-bottom:10px;
                  padding:14px;
                "
              >

                <strong>
                  ${esc(
                    actionLabel(
                      log.action
                    )
                  )}
                </strong>

                <div class="subtle">
                  ${esc(
                    actorLabel(
                      log.actor_role
                    )
                  )}
                  •
                  ${esc(
                    fmtDateTime(
                      log.created_at
                    )
                  )}
                </div>

                ${
                  log.details?.name
                    ? `
                      <div
                        style="
                          margin-top:6px
                        "
                      >
                        ${esc(
                          log.details.name
                        )}
                      </div>
                    `
                    : ""
                }

              </div>
            `
              )
              .join("")}

          </div>
        `
        : `
          <div class="empty">
            Ainda não há alterações registradas.
          </div>
        `;

    modalShell(
      "Histórico do evento",
      content
    );
  } catch (error) {
    toast(
      error.message,
      true
    );
  }
}

// =========================================================
// LIXEIRA
// =========================================================

async function trashModal(
  eventId
) {
  try {
    const data =
      await api(
        `/api/admin/events/${eventId}/trash`
      );

    const content =
      data.guests.length
        ? `
          <div>

            ${data.guests
              .map(
                (guest) => `
              <div
                class="card"
                style="
                  box-shadow:none;
                  margin-bottom:10px;
                  padding:14px;
                "
              >

                <strong>
                  ${esc(
                    guest.primary_name
                  )}
                </strong>

                <div class="subtle">
                  Excluído em
                  ${esc(
                    fmtDateTime(
                      guest.deleted_at
                    )
                  )}
                </div>

                <div
                  class="actions"
                  style="
                    margin-top:10px
                  "
                >

                  <button
                    class="btn secondary small"
                    data-restore="${
                      guest.id
                    }"
                  >
                    Restaurar
                  </button>

                </div>

              </div>
            `
              )
              .join("")}

          </div>
        `
        : `
          <div class="empty">
            A lixeira está vazia.
          </div>
        `;

    const wrap =
      modalShell(
        "Lixeira de convidados",
        content,
        "Exclusões não são definitivas. Você pode restaurar os registros daqui."
      );

    wrap
      .querySelectorAll(
        "[data-restore]"
      )
      .forEach((button) => {
        button.onclick =
          async () => {
            try {
              await api(
                `/api/admin/events/${eventId}/guests/${button.dataset.restore}/restore`,
                {
                  method:
                    "POST",

                  body: "{}",
                }
              );

              closeModal(
                wrap
              );

              toast(
                "Convidado restaurado."
              );

              renderAdminEvent(
                eventId
              );
            } catch (error) {
              toast(
                error.message,
                true
              );
            }
          };
      });
  } catch (error) {
    toast(
      error.message,
      true
    );
  }
}

// =========================================================
// TABELA DE CONVIDADOS
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
              Confirmação
            </th>

            <th>
              Pessoas
            </th>

            <th>
              Status
            </th>

            <th>
              Contato
            </th>

            <th>
              Mensagem
            </th>

            ${
              editable
                ? "<th>Ações</th>"
                : ""
            }

          </tr>

        </thead>

        <tbody>

          ${guests
            .map(
              (guest) => `
            <tr>

              <td>

                <strong>
                  ${esc(
                    guest.primary_name
                  )}
                </strong>

                <div class="subtle">

                  ${esc(
                    sourceLabel(
                      guest.source
                    )
                  )}

                </div>

              </td>

              <td>

                ${
                  guest.members.length
                    ? guest.members
                        .map(
                          (member) => `
                      <div
                        class="member-line"
                      >

                        <span>
                          ${
                            member.person_type ===
                            "child"
                              ? "🧒"
                              : "👤"
                          }
                        </span>

                        <span>
                          ${esc(
                            member.name
                          )}
                        </span>

                        <small>
                          ${
                            member.person_type ===
                            "child"
                              ? "criança"
                              : "adulto"
                          }
                        </small>

                      </div>
                    `
                        )
                        .join("")
                    : `
                      <span class="subtle">
                        Nenhuma pessoa confirmada
                      </span>
                    `
                }

              </td>

              <td>

                <span
                  class="status ${
                    guest.response_status
                  }"
                >
                  ${esc(
                    statusLabel(
                      guest.response_status
                    )
                  )}
                </span>

              </td>

              <td>

                ${esc(
                  guest.phone ||
                    "—"
                )}

              </td>

              <td>

                ${
                  guest.love_message
                    ? `
                      <div
                        class="love-note"
                        title="${esc(
                          guest.love_message
                        )}"
                      >
                        💌
                        ${esc(
                          guest.love_message
                        )}
                      </div>
                    `
                    : "—"
                }

              </td>

              ${
                editable
                  ? `
                    <td>

                      <div class="actions">

                        <button
                          class="btn secondary small"
                          data-edit="${
                            guest.id
                          }"
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
                          data-delete="${
                            guest.id
                          }"
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
            .join("")}

        </tbody>

      </table>

    </div>
  `;
}

function bindGuestActions(
  eventId,
  role,
  token = null,
  maxPeople = null
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
          maxPeople,

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
// EDITOR DE PESSOAS
// =========================================================

function membersEditorHtml(
  members = [],
  maxPeople = null
) {
  return `
    <div class="members-editor">

      <div
        class="section-title"
        style="
          margin-top:0
        "
      >

        <div>

          <h3>
            Pessoas
          </h3>

          <span class="subtle">

            ${
              maxPeople
                ? `Máximo de ${maxPeople} pessoa(s) por confirmação.`
                : "Informe o nome de cada pessoa."
            }

          </span>

        </div>

      </div>

      <div id="membersList"></div>

      <div
        id="membersLimitState"
        class="subtle"
        style="
          display:none;
          margin:8px 0 12px;
        "
      ></div>

      <div class="actions">

        <button
          type="button"
          class="btn secondary small"
          id="addAdult"
        >
          + Adulto
        </button>

        <button
          type="button"
          class="btn secondary small"
          id="addChild"
        >
          + Criança
        </button>

      </div>

    </div>
  `;
}

function createMemberRow(
  member = {
    name: "",
    person_type: "adult",
  }
) {
  const row =
    document.createElement(
      "div"
    );

  row.className =
    "member-editor-row";

  row.innerHTML = `
    <div class="member-type-badge">

      ${
        member.person_type ===
        "child"
          ? "🧒 Criança"
          : "👤 Adulto"
      }

    </div>

    <input
      type="text"
      class="member-name"
      placeholder="${
        member.person_type ===
        "child"
          ? "Nome da criança"
          : "Nome do adulto"
      }"
      value="${esc(
        member.name || ""
      )}"
      data-person-type="${
        member.person_type ===
        "child"
          ? "child"
          : "adult"
      }"
    >

    <button
      type="button"
      class="btn danger small remove-member"
      aria-label="Remover pessoa"
    >
      ×
    </button>
  `;

  return row;
}

function setupMembersEditor({
  root,
  initialMembers = [],
  maxPeople = null,
  primaryInput = null,
  startWithPrimary = false,
}) {
  const list =
    root.querySelector(
      "#membersList"
    );

  const addAdultButton =
    root.querySelector(
      "#addAdult"
    );

  const addChildButton =
    root.querySelector(
      "#addChild"
    );

  const limitState =
    root.querySelector(
      "#membersLimitState"
    );

  let touchedFirst =
    false;

  function currentCount() {
    return list.querySelectorAll(
      ".member-editor-row"
    ).length;
  }

  function numericLimit() {
    if (
      maxPeople === null ||
      maxPeople === undefined ||
      String(maxPeople).trim() === ""
    ) {
      return null;
    }

    const number =
      Number(maxPeople);

    return Number.isFinite(number)
      ? number
      : null;
  }

  function updateLimitState() {
    const count =
      currentCount();

    const limit =
      numericLimit();

    if (!limit) {
      addAdultButton.disabled =
        false;

      addChildButton.disabled =
        false;

      limitState.style.display =
        "none";

      limitState.textContent =
        "";

      return;
    }

    const reached =
      count >= limit;

    addAdultButton.disabled =
      reached;

    addChildButton.disabled =
      reached;

    if (count > limit) {
      limitState.style.display =
        "block";

      limitState.style.color =
        "var(--bad)";

      limitState.style.fontWeight =
        "700";

      limitState.textContent =
        `Esta confirmação possui ${count} pessoas, mas o limite atual é ${limit}. Remova ${count - limit} pessoa(s) antes de salvar.`;

      return;
    }

    if (count === limit) {
      limitState.style.display =
        "block";

      limitState.style.color =
        "var(--muted)";

      limitState.style.fontWeight =
        "600";

      limitState.textContent =
        `Limite atingido: ${count} de ${limit} pessoa(s).`;

      return;
    }

    limitState.style.display =
      "block";

    limitState.style.color =
      "var(--muted)";

    limitState.style.fontWeight =
      "400";

    limitState.textContent =
      `${count} de ${limit} pessoa(s) adicionada(s).`;
  }

  function canAdd() {
    const limit =
      numericLimit();

    if (
      limit &&
      currentCount() >= limit
    ) {
      toast(
        `O limite desta confirmação é de ${limit} pessoa(s).`,
        true
      );

      return false;
    }

    return true;
  }

  function add(
    personType,
    name = "",
    ignoreLimit = false
  ) {
    if (
      !ignoreLimit &&
      !canAdd()
    ) {
      return null;
    }

    const row =
      createMemberRow({
        name,

        person_type:
          personType,
      });

    const input =
      row.querySelector(
        ".member-name"
      );

    input.addEventListener(
      "input",
      () => {
        if (
          list.firstElementChild ===
          row
        ) {
          touchedFirst = true;
        }
      }
    );

    row
      .querySelector(
        ".remove-member"
      )
      .onclick = () => {
        row.remove();

        updateLimitState();
      };

    list.append(row);

    updateLimitState();

    return row;
  }

  if (initialMembers.length) {
    initialMembers.forEach(
      (member) => {
        /*
          Registros que já existiam são sempre exibidos,
          mesmo se estiverem acima de um limite definido
          posteriormente.
        */
        add(
          member.person_type,
          member.name,
          true
        );
      }
    );
  } else if (
    startWithPrimary
  ) {
    add(
      "adult",
      primaryInput?.value || ""
    );
  }

  addAdultButton.onclick =
    () => {
      add("adult");
    };

  addChildButton.onclick =
    () => {
      add("child");
    };

  if (primaryInput) {
    primaryInput.addEventListener(
      "input",
      () => {
        const first =
          list.querySelector(
            ".member-editor-row"
          );

        if (!first) {
          return;
        }

        const firstInput =
          first.querySelector(
            ".member-name"
          );

        if (
          !touchedFirst ||
          !firstInput.value.trim()
        ) {
          firstInput.value =
            primaryInput.value;
        }
      }
    );
  }

  updateLimitState();

  return {
    getMembers() {
      return [
        ...list.querySelectorAll(
          ".member-name"
        ),
      ]
        .map((input) => ({
          name:
            input.value.trim(),

          person_type:
            input.dataset
              .personType ===
            "child"
              ? "child"
              : "adult",
        }))
        .filter(
          (member) =>
            member.name
        );
    },

    clear() {
      list.innerHTML = "";

      updateLimitState();
    },

    ensurePrimary() {
      if (
        !list.querySelector(
          ".member-editor-row"
        )
      ) {
        add(
          "adult",
          primaryInput?.value ||
            ""
        );
      }
    },

    isOverLimit() {
      const limit =
        numericLimit();

      return Boolean(
        limit &&
        currentCount() >
          limit
      );
    },
  };
}

// =========================================================
// MODAL CONVIDADO
// =========================================================

function guestModal({
  eventId,
  role,
  token,
  maxPeople,
  guest = null,
}) {
  const content = `
    <form id="guestForm">

      <div class="field">

        <label>
          Responsável pela confirmação
        </label>

        <input
          name="primary_name"
          id="guestPrimaryName"
          required
          value="${esc(
            guest?.primary_name ||
              ""
          )}"
        >

      </div>

      <div class="field">

        <label>
          Status
        </label>

        <select
          name="response_status"
          id="guestStatus"
        >

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

      <div id="guestMembersSection">

        ${membersEditorHtml(
          guest?.members || [],
          maxPeople
        )}

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

      <div class="field">

        <label>
          Restrição alimentar
        </label>

        <input
          name="dietary"
          value="${esc(
            guest?.dietary || ""
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
          guest?.notes || ""
        )}</textarea>

      </div>

      <div class="field">

        <label>
          Mensagem carinhosa 💌
        </label>

        <textarea
          name="love_message"
          rows="3"
        >${esc(
          guest?.love_message ||
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
  `;

  const wrap =
    modalShell(
      guest
        ? "Editar confirmação"
        : "Adicionar confirmação",
      content
    );

  const form =
    wrap.querySelector(
      "#guestForm"
    );

  const primaryInput =
    wrap.querySelector(
      "#guestPrimaryName"
    );

  const statusInput =
    wrap.querySelector(
      "#guestStatus"
    );

  const membersSection =
    wrap.querySelector(
      "#guestMembersSection"
    );

  const editor =
    setupMembersEditor({
      root:
        membersSection,

      initialMembers:
        guest?.members ||
        [],

      maxPeople,

      primaryInput,

      startWithPrimary:
        !guest,
    });

  function syncStatus() {
    const showing =
      statusInput.value !==
      "no";

    membersSection.style.display =
      showing
        ? ""
        : "none";

    if (
      showing &&
      statusInput.value ===
        "yes"
    ) {
      editor.ensurePrimary();
    }
  }

  statusInput.onchange =
    syncStatus;

  syncStatus();

  form.onsubmit =
    async (event) => {
      event.preventDefault();

      const data =
        new FormData(form);

      const status =
        data.get(
          "response_status"
        );

      const members =
        status === "no"
          ? []
          : editor.getMembers();

      if (
        status === "yes" &&
        members.length === 0
      ) {
        toast(
          "Informe pelo menos uma pessoa confirmada.",
          true
        );

        return;
      }

      if (
        maxPeople &&
        members.length >
          Number(maxPeople)
      ) {
        toast(
          `Esta confirmação possui ${members.length} pessoas, mas o limite atual é ${maxPeople}. Remova ${members.length - Number(maxPeople)} pessoa(s) antes de salvar.`,
          true
        );

        return;
      }

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

      const button =
        event.submitter;

      button.disabled = true;

      try {
        const response =
          await api(
            url,
            {
              method:
                guest
                  ? "PATCH"
                  : "POST",

              body:
                JSON.stringify({
                  primary_name:
                    data.get(
                      "primary_name"
                    ),

                  response_status:
                    status,

                  members,

                  phone:
                    data.get(
                      "phone"
                    ),

                  dietary:
                    data.get(
                      "dietary"
                    ),

                  notes:
                    data.get(
                      "notes"
                    ),

                  love_message:
                    data.get(
                      "love_message"
                    ),
                }),
            }
          );

        closeModal(wrap);

        if (
          response
            .duplicate_matches
            ?.length
        ) {
          const names = [
            ...new Set(
              response
                .duplicate_matches
                .map(
                  (item) =>
                    item.name
                )
            ),
          ].join(", ");

          toast(
            `Salvo. Atenção: possível duplicidade em ${names}.`
          );
        } else {
          toast(
            "Salvo."
          );
        }

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

        button.disabled =
          false;
      }
    };
}

// =========================================================
// ÁREA DO CLIENTE
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

        <section
          class="client-head"
          style="
            background:
              linear-gradient(
                135deg,
                ${esc(
                  event.primary_color
                )},
                ${esc(
                  event.accent_color
                )}
              );
          "
        >

          <div
            class="meta"
            style="
              color:#fff;
              opacity:.82
            "
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

          <div>

            <h2>
              Lista de convidados
            </h2>

            <span class="meta">
              Você pode adicionar, editar e excluir registros deste evento.
            </span>

          </div>

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
            placeholder="Buscar convidado..."
          >

          <select
            id="filter"
            class="search"
            style="
              flex:0 0 190px
            "
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

          maxPeople:
            event.max_people_per_rsvp,
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
          token,
          event.max_people_per_rsvp
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
      token,
      event.max_people_per_rsvp
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
        ? `background-image:url('${String(
            event.background_image_url
          ).replace(
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

          ${
            event.rsvp_deadline
              ? `
                <div class="chip">
                  Confirme até
                  ${esc(
                    fmtDate(
                      event.rsvp_deadline
                    )
                  )}
                </div>
              `
              : ""
          }

          <div id="publicFlow"></div>

        </section>

      </main>
    `;

    if (
      !event.accepting_rsvp
    ) {
      renderClosedRsvp(
        event
      );

      return;
    }

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

function renderClosedRsvp(
  event
) {
  const root =
    document.querySelector(
      "#publicFlow"
    );

  root.innerHTML = `
    <div
      class="success"
      style="
        margin-top:18px
      "
    >

      <div class="bubble">
        ♡
      </div>

      <h2>
        Confirmações encerradas
      </h2>

      <p>
        ${esc(
          event.closed_reason ||
            "O período de confirmação de presença foi encerrado."
        )}
      </p>

    </div>
  `;
}

// =========================================================
// BUSCA EM LISTA CONTROLADA
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
          Digite seu nome
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
        Encontrar minha confirmação
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
// RSVP PÚBLICO
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
    event.extra_fields || {};

  root.innerHTML = `
    <form id="rsvp">

      <div
        style="
          position:absolute;
          left:-9999px;
          width:1px;
          height:1px;
          overflow:hidden;
        "
        aria-hidden="true"
      >

        <label>
          Website
        </label>

        <input
          name="website"
          tabindex="-1"
          autocomplete="off"
        >

      </div>

      <div class="field">

        <label>
          Seu nome
        </label>

        <input
          name="primary_name"
          id="publicPrimaryName"
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
          class="${
            !guest ||
            guest.response_status !==
              "no"
              ? "active"
              : ""
          }"
        >
          ✓ Estarei presente
        </button>

        <button
          type="button"
          data-choice="no"
          class="${
            guest?.response_status ===
            "no"
              ? "active"
              : ""
          }"
        >
          Não poderei ir
        </button>

      </div>

      <input
        type="hidden"
        name="response_status"
        value="${
          guest?.response_status ===
          "no"
            ? "no"
            : "yes"
        }"
      >

      <div id="publicMembersSection">

        ${membersEditorHtml(
          guest?.members || [],
          event.max_people_per_rsvp
        )}

      </div>

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
                value="${esc(
                  guest?.phone ||
                    ""
                )}"
              >

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

      ${
        fields.love_message !==
        false
          ? `
            <div class="field">

              <label>
                Deixe uma mensagem carinhosa 💌
              </label>

              <textarea
                name="love_message"
                rows="3"
                placeholder="Uma mensagem especial para quem está celebrando..."
              >${esc(
                guest?.love_message ||
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

  const form =
    root.querySelector(
      "#rsvp"
    );

  const primaryInput =
    root.querySelector(
      "#publicPrimaryName"
    );

  const membersSection =
    root.querySelector(
      "#publicMembersSection"
    );

  const editor =
    setupMembersEditor({
      root:
        membersSection,

      initialMembers:
        guest?.members ||
        [],

      maxPeople:
        event.max_people_per_rsvp,

      primaryInput,

      startWithPrimary:
        !guest,
    });

  const statusInput =
    form.querySelector(
      '[name="response_status"]'
    );

  function syncChoice() {
    const yes =
      statusInput.value ===
      "yes";

    membersSection.style.display =
      yes
        ? ""
        : "none";

    if (yes) {
      editor.ensurePrimary();
    }
  }

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

        statusInput.value =
          button.dataset.choice;

        syncChoice();
      };
    });

  syncChoice();

  form.onsubmit =
    async (formEvent) => {
      formEvent.preventDefault();

      const data =
        new FormData(form);

      const status =
        data.get(
          "response_status"
        );

      const members =
        status === "yes"
          ? editor.getMembers()
          : [];

      if (
        status === "yes" &&
        members.length === 0
      ) {
        toast(
          "Informe o nome de pelo menos uma pessoa que irá à festa.",
          true
        );

        return;
      }

      if (
        event.max_people_per_rsvp &&
        members.length >
          Number(
            event.max_people_per_rsvp
          )
      ) {
        toast(
          `Esta confirmação possui ${members.length} pessoas, mas o limite atual é ${event.max_people_per_rsvp}. Remova ${members.length - Number(event.max_people_per_rsvp)} pessoa(s) antes de enviar.`,
          true
        );

        return;
      }

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
                website:
                  data.get(
                    "website"
                  ),

                guest_id:
                  guest?.id ||
                  null,

                primary_name:
                  data.get(
                    "primary_name"
                  ),

                response_status:
                  status,

                members,

                phone:
                  data.get(
                    "phone"
                  ),

                dietary:
                  data.get(
                    "dietary"
                  ),

                notes:
                  data.get(
                    "notes"
                  ),

                love_message:
                  data.get(
                    "love_message"
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
                status === "yes"
                  ? "Presença confirmada!"
                  : "Resposta registrada"
              }

            </h2>

            <p>

              ${
                status === "yes"
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

        button.disabled =
          false;
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
