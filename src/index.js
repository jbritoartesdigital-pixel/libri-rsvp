const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      return serveApp(request, env);
    } catch (error) {
      console.error(error);

      if (error instanceof HttpError) {
        return json(
          {
            error: error.message,
          },
          error.status
        );
      }

      return json(
        {
          error: "Ocorreu um erro interno.",
        },
        500
      );
    }
  },
};

async function handleApi(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // =========================================================
  // ADMIN
  // =========================================================

  if (path === "/api/admin/login" && method === "POST") {
    const body = await bodyJson(request);

    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json(
        {
          error:
            "ADMIN_PASSWORD e SESSION_SECRET ainda não foram configurados no Cloudflare.",
        },
        500
      );
    }

    if (String(body.password || "") !== String(env.ADMIN_PASSWORD)) {
      return json(
        {
          error: "Senha incorreta.",
        },
        401
      );
    }

    const cookie = await createAdminSession(env);

    return json(
      {
        ok: true,
      },
      200,
      {
        "set-cookie": cookie,
      }
    );
  }

  if (path === "/api/admin/logout" && method === "POST") {
    return json(
      {
        ok: true,
      },
      200,
      {
        "set-cookie":
          "libri_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      }
    );
  }

  if (path === "/api/admin/me" && method === "GET") {
    if (!(await isAdmin(request, env))) {
      return json(
        {
          error: "Não autorizado.",
        },
        401
      );
    }

    return json({
      ok: true,
    });
  }

  if (path.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) {
      return json(
        {
          error: "Sessão expirada. Entre novamente.",
        },
        401
      );
    }
  }

  // =========================================================
  // ADMIN - EVENTOS
  // =========================================================

  if (path === "/api/admin/events" && method === "GET") {
    const events = await getEventsWithSummary(env);

    return json({
      events,
    });
  }

  if (path === "/api/admin/events" && method === "POST") {
    const body = await bodyJson(request);

    if (!body.title?.trim()) {
      return json(
        {
          error: "Informe o nome do evento.",
        },
        400
      );
    }

    const event = await createEvent(env, body);

    await audit(env, {
      eventId: event.id,
      actorRole: "admin",
      action: "event_created",
      details: {
        title: event.title,
      },
    });

    return json({
      event,
    });
  }

  let match = path.match(/^\/api\/admin\/events\/([^/]+)$/);

  // =========================================================
  // ADMIN - ABRIR EVENTO
  // =========================================================

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);

    const event = await getEvent(env, eventId);

    if (!event) {
      return json(
        {
          error: "Evento não encontrado.",
        },
        404
      );
    }

    const summary = await getSummary(env, event.id);

    const origin = new URL(request.url).origin;

    return json({
      event: serializeEvent(event),
      summary,
      client_url: event.client_token
        ? `${origin}/cliente/${encodeURIComponent(event.client_token)}`
        : null,
    });
  }

  // =========================================================
  // ADMIN - EDITAR EVENTO
  // =========================================================

  if (match && method === "PATCH") {
    const eventId = decodeURIComponent(match[1]);

    const current = await getEvent(env, eventId);

    if (!current) {
      return json(
        {
          error: "Evento não encontrado.",
        },
        404
      );
    }

    const body = await bodyJson(request);

    const title = String(body.title ?? current.title).trim();

    if (!title) {
      return json(
        {
          error: "Informe o nome do evento.",
        },
        400
      );
    }

    const currentExtraFields = safeJson(
      current.extra_fields,
      {}
    );

    const extraFields =
      body.extra_fields !== undefined
        ? {
            phone: Boolean(body.extra_fields?.phone),

            adults_children:
              body.extra_fields?.adults_children !== false,

            companions:
              body.extra_fields?.companions !== false,

            dietary: Boolean(body.extra_fields?.dietary),

            notes: Boolean(body.extra_fields?.notes),
          }
        : currentExtraFields;

    const rsvpMode =
      body.rsvp_mode === "list"
        ? "list"
        : body.rsvp_mode === "free"
          ? "free"
          : current.rsvp_mode;

    await env.DB.prepare(`
      UPDATE events
      SET
        title = ?,
        event_date = ?,
        event_time = ?,
        rsvp_mode = ?,
        welcome_message = ?,
        primary_color = ?,
        accent_color = ?,
        extra_fields = ?,
        updated_at = ?
      WHERE id = ?
    `)
      .bind(
        title,

        cleanNullable(
          body.event_date !== undefined
            ? body.event_date
            : current.event_date
        ),

        cleanNullable(
          body.event_time !== undefined
            ? body.event_time
            : current.event_time
        ),

        rsvpMode,

        cleanNullable(
          body.welcome_message !== undefined
            ? body.welcome_message
            : current.welcome_message
        ),

        safeColor(
          body.primary_color,
          current.primary_color || "#6f4f5f"
        ),

        safeColor(
          body.accent_color,
          current.accent_color || "#f4e8ed"
        ),

        JSON.stringify(extraFields),

        now(),

        eventId
      )
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "event_updated",
      details: {
        title,
      },
    });

    const updated = await getEvent(env, eventId);

    return json({
      event: serializeEvent(updated),
    });
  }

  // =========================================================
  // ADMIN - TROCAR LINK DA CLIENTE
  // =========================================================

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/client-link\/reset$/
  );

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);

    const event = await getEvent(env, eventId);

    if (!event) {
      return json(
        {
          error: "Evento não encontrado.",
        },
        404
      );
    }

    const token = randomToken();

    await env.DB.prepare(`
      UPDATE events
      SET client_token = ?,
          updated_at = ?
      WHERE id = ?
    `)
      .bind(token, now(), eventId)
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "client_link_reset",
    });

    return json({
      client_url: `${new URL(request.url).origin}/cliente/${encodeURIComponent(
        token
      )}`,
    });
  }

  // =========================================================
  // ADMIN - LISTAR / ADICIONAR CONVIDADOS
  // =========================================================

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/guests$/
  );

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);

    const event = await getEvent(env, eventId);

    if (!event) {
      return json(
        {
          error: "Evento não encontrado.",
        },
        404
      );
    }

    const guests = await listGuests(env, eventId, url);

    return json({
      guests,
    });
  }

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);

    const event = await getEvent(env, eventId);

    if (!event) {
      return json(
        {
          error: "Evento não encontrado.",
        },
        404
      );
    }

    const body = await bodyJson(request);

    const guest = await createGuest(env, eventId, body, "admin");

    await audit(env, {
      eventId,
      guestId: guest.id,
      actorRole: "admin",
      action: "guest_created",
      details: {
        name: guest.primary_name,
      },
    });

    return json({
      guest,
    });
  }

  // =========================================================
  // ADMIN - EDITAR / EXCLUIR CONVIDADO
  // =========================================================

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/guests\/([^/]+)$/
  );

  if (match && method === "PATCH") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);

    const body = await bodyJson(request);

    const guest = await updateGuest(
      env,
      eventId,
      guestId,
      body
    );

    if (!guest) {
      return json(
        {
          error: "Convidado não encontrado.",
        },
        404
      );
    }

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_updated",
      details: {
        name: guest.primary_name,
      },
    });

    return json({
      guest,
    });
  }

  if (match && method === "DELETE") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);

    const guest = await getGuest(env, eventId, guestId);

    if (!guest) {
      return json(
        {
          error: "Convidado não encontrado.",
        },
        404
      );
    }

    await softDeleteGuest(env, eventId, guestId);

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_deleted",
      details: {
        name: guest.primary_name,
      },
    });

    return json({
      ok: true,
    });
  }

  // =========================================================
  // ADMIN - EXPORTAR CSV
  // =========================================================

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/export\.csv$/
  );

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);

    const event = await getEvent(env, eventId);

    if (!event) {
      return json(
        {
          error: "Evento não encontrado.",
        },
        404
      );
    }

    const guests = await listGuestsRaw(env, eventId);

    return csvResponse(
      guests,
      `convidados-${event.slug}.csv`
    );
  }

  // =========================================================
  // CLIENTE
  // =========================================================

  match = path.match(
    /^\/api\/client\/([^/]+)\/event$/
  );

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);

    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json(
        {
          error: "Este link não é válido ou foi substituído.",
        },
        404
      );
    }

    const summary = await getSummary(env, event.id);

    return json({
      event: serializeEvent(event),
      summary,
    });
  }

  // =========================================================
  // CLIENTE - LISTAR / ADICIONAR CONVIDADOS
  // =========================================================

  match = path.match(
    /^\/api\/client\/([^/]+)\/guests$/
  );

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);

    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json(
        {
          error: "Acesso inválido.",
        },
        404
      );
    }

    const guests = await listGuests(env, event.id, url);

    return json({
      guests,
    });
  }

  if (match && method === "POST") {
    const token = decodeURIComponent(match[1]);

    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json(
        {
          error: "Acesso inválido.",
        },
        404
      );
    }

    const body = await bodyJson(request);

    const guest = await createGuest(
      env,
      event.id,
      body,
      "client"
    );

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "client",
      action: "guest_created",
      details: {
        name: guest.primary_name,
      },
    });

    return json({
      guest,
    });
  }

  // =========================================================
  // CLIENTE - EDITAR / EXCLUIR CONVIDADO
  // =========================================================

  match = path.match(
    /^\/api\/client\/([^/]+)\/guests\/([^/]+)$/
  );

  if (match && method === "PATCH") {
    const token = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);

    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json(
        {
          error: "Acesso inválido.",
        },
        404
      );
    }

    const body = await bodyJson(request);

    const guest = await updateGuest(
      env,
      event.id,
      guestId,
      body
    );

    if (!guest) {
      return json(
        {
          error: "Convidado não encontrado.",
        },
        404
      );
    }

    await audit(env, {
      eventId: event.id,
      guestId,
      actorRole: "client",
      action: "guest_updated",
      details: {
        name: guest.primary_name,
      },
    });

    return json({
      guest,
    });
  }

  if (match && method === "DELETE") {
    const token = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);

    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json(
        {
          error: "Acesso inválido.",
        },
        404
      );
    }

    const guest = await getGuest(
      env,
      event.id,
      guestId
    );

    if (!guest) {
      return json(
        {
          error: "Convidado não encontrado.",
        },
        404
      );
    }

    await softDeleteGuest(
      env,
      event.id,
      guestId
    );

    await audit(env, {
      eventId: event.id,
      guestId,
      actorRole: "client",
      action: "guest_deleted",
      details: {
        name: guest.primary_name,
      },
    });

    return json({
      ok: true,
    });
  }

  // =========================================================
  // CLIENTE - EXPORTAR
  // =========================================================

  match = path.match(
    /^\/api\/client\/([^/]+)\/export\.csv$/
  );

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);

    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json(
        {
          error: "Acesso inválido.",
        },
        404
      );
    }

    const guests = await listGuestsRaw(
      env,
      event.id
    );

    return csvResponse(
      guests,
      `convidados-${event.slug}.csv`
    );
  }

  // =========================================================
  // PÚBLICO - EVENTO
  // =========================================================

  match = path.match(
    /^\/api\/public\/events\/([^/]+)$/
  );

  if (match && method === "GET") {
    const slug = decodeURIComponent(match[1]);

    const event = await getEventBySlug(env, slug);

    if (!event || event.status !== "active") {
      return json(
        {
          error:
            "Esta confirmação não está disponível.",
        },
        404
      );
    }

    return json({
      event: publicEvent(event),
      turnstile_sitekey:
        env.TURNSTILE_SITE_KEY || null,
    });
  }

  // =========================================================
  // PÚBLICO - BUSCAR NOME NA LISTA
  // =========================================================

  match = path.match(
    /^\/api\/public\/events\/([^/]+)\/lookup$/
  );

  if (match && method === "POST") {
    const slug = decodeURIComponent(match[1]);

    const event = await getEventBySlug(env, slug);

    if (!event || event.status !== "active") {
      return json(
        {
          error: "Evento indisponível.",
        },
        404
      );
    }

    if (event.rsvp_mode !== "list") {
      return json(
        {
          error:
            "Este evento não utiliza lista pré-cadastrada.",
        },
        400
      );
    }

    const body = await bodyJson(request);

    const normalized = normalizeName(body.name || "");

    if (!normalized) {
      return json(
        {
          error: "Digite seu nome.",
        },
        400
      );
    }

    const guest = await env.DB.prepare(`
      SELECT *
      FROM guests
      WHERE event_id = ?
        AND normalized_name = ?
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
    `)
      .bind(event.id, normalized)
      .first();

    if (!guest) {
      return json(
        {
          error:
            "Não encontramos esse nome na lista. Confira a escrita ou fale com o anfitrião.",
        },
        404
      );
    }

    return json({
      guest: serializeGuest(guest),
    });
  }

  // =========================================================
  // PÚBLICO - CONFIRMAR PRESENÇA
  // =========================================================

  match = path.match(
    /^\/api\/public\/events\/([^/]+)\/rsvp$/
  );

  if (match && method === "POST") {
    const slug = decodeURIComponent(match[1]);

    const event = await getEventBySlug(env, slug);

    if (!event || event.status !== "active") {
      return json(
        {
          error:
            "Esta confirmação está encerrada.",
        },
        404
      );
    }

    const body = await bodyJson(request);

    const turnstileOk =
      await verifyTurnstile(
        request,
        env,
        body.turnstile_token
      );

    if (!turnstileOk) {
      return json(
        {
          error:
            "Não foi possível validar a confirmação. Tente novamente.",
        },
        400
      );
    }

    const responseStatus =
      allowedStatus(body.response_status);

    if (
      responseStatus !== "yes" &&
      responseStatus !== "no"
    ) {
      return json(
        {
          error:
            "Escolha se poderá comparecer.",
        },
        400
      );
    }

    let guest;

    if (event.rsvp_mode === "list") {
      if (!body.guest_id) {
        return json(
          {
            error:
              "Localize seu nome na lista antes de confirmar.",
          },
          400
        );
      }

      const existing = await getGuest(
        env,
        event.id,
        body.guest_id
      );

      if (!existing) {
        return json(
          {
            error:
              "Convidado não encontrado neste evento.",
          },
          404
        );
      }

      guest = await updateGuest(
        env,
        event.id,
        existing.id,
        {
          ...body,
          primary_name:
            existing.primary_name,
        }
      );
    } else {
      const name =
        String(body.primary_name || "").trim();

      if (!name) {
        return json(
          {
            error: "Informe seu nome.",
          },
          400
        );
      }

      const normalized =
        normalizeName(name);

      const existing =
        await env.DB.prepare(`
          SELECT *
          FROM guests
          WHERE event_id = ?
            AND normalized_name = ?
            AND deleted_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1
        `)
          .bind(event.id, normalized)
          .first();

      if (existing) {
        guest = await updateGuest(
          env,
          event.id,
          existing.id,
          body
        );
      } else {
        guest = await createGuest(
          env,
          event.id,
          body,
          "public"
        );
      }
    }

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "public",
      action: "rsvp_submitted",
      details: {
        name: guest.primary_name,
        response_status:
          guest.response_status,
      },
    });

    return json({
      ok: true,
      guest,
    });
  }

  return json(
    {
      error: "Rota não encontrada.",
    },
    404
  );
}

// =========================================================
// EVENTOS
// =========================================================

async function createEvent(env, body) {
  const id = crypto.randomUUID();

  const slug = await uniqueSlug(
    env,
    body.title
  );

  const clientToken = randomToken();

  const createdAt = now();

  const extraFields = {
    phone: Boolean(body.extra_fields?.phone),

    adults_children:
      body.extra_fields?.adults_children !== false,

    companions:
      body.extra_fields?.companions !== false,

    dietary:
      Boolean(body.extra_fields?.dietary),

    notes:
      Boolean(body.extra_fields?.notes),
  };

  await env.DB.prepare(`
    INSERT INTO events (
      id,
      title,
      slug,
      event_date,
      event_time,
      rsvp_mode,
      welcome_message,
      primary_color,
      accent_color,
      background_image_url,
      extra_fields,
      client_token,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `)
    .bind(
      id,
      String(body.title).trim(),
      slug,

      cleanNullable(body.event_date),

      cleanNullable(body.event_time),

      body.rsvp_mode === "list"
        ? "list"
        : "free",

      cleanNullable(
        body.welcome_message
      ),

      safeColor(
        body.primary_color,
        "#6f4f5f"
      ),

      safeColor(
        body.accent_color,
        "#f4e8ed"
      ),

      cleanNullable(
        body.background_image_url
      ),

      JSON.stringify(extraFields),

      clientToken,

      createdAt,

      createdAt
    )
    .run();

  return serializeEvent(
    await getEvent(env, id)
  );
}

async function getEventsWithSummary(env) {
  const result =
    await env.DB.prepare(`
      SELECT
        e.*,

        SUM(
          CASE
            WHEN g.response_status = 'yes'
            THEN 1
            ELSE 0
          END
        ) AS yes_responses,

        SUM(
          CASE
            WHEN g.response_status = 'no'
            THEN 1
            ELSE 0
          END
        ) AS no_responses,

        SUM(
          CASE
            WHEN g.response_status = 'pending'
            THEN 1
            ELSE 0
          END
        ) AS pending_responses,

        SUM(
          CASE
            WHEN g.response_status = 'yes'
            THEN
              CASE
                WHEN COALESCE(g.adults, 0) + COALESCE(g.children, 0) < 1
                THEN 1
                ELSE COALESCE(g.adults, 0) + COALESCE(g.children, 0)
              END
            ELSE 0
          END
        ) AS people_confirmed

      FROM events e

      LEFT JOIN guests g
        ON g.event_id = e.id
        AND g.deleted_at IS NULL

      GROUP BY e.id

      ORDER BY
        CASE
          WHEN e.status = 'active' THEN 0
          ELSE 1
        END,

        COALESCE(
          e.event_date,
          '9999-12-31'
        ) ASC,

        e.created_at DESC
    `).all();

  return result.results.map(
    (row) => ({
      ...serializeEvent(row),

      yes_responses:
        Number(row.yes_responses || 0),

      no_responses:
        Number(row.no_responses || 0),

      pending_responses:
        Number(
          row.pending_responses || 0
        ),

      people_confirmed:
        Number(
          row.people_confirmed || 0
        ),
    })
  );
}

async function getEvent(env, id) {
  return env.DB.prepare(`
    SELECT *
    FROM events
    WHERE id = ?
    LIMIT 1
  `)
    .bind(id)
    .first();
}

async function getEventBySlug(env, slug) {
  return env.DB.prepare(`
    SELECT *
    FROM events
    WHERE slug = ?
    LIMIT 1
  `)
    .bind(slug)
    .first();
}

async function getEventByClientToken(
  env,
  token
) {
  if (!token) {
    return null;
  }

  return env.DB.prepare(`
    SELECT *
    FROM events
    WHERE client_token = ?
    LIMIT 1
  `)
    .bind(token)
    .first();
}

async function getSummary(env, eventId) {
  const row =
    await env.DB.prepare(`
      SELECT

        SUM(
          CASE
            WHEN response_status = 'yes'
            THEN 1
            ELSE 0
          END
        ) AS yes_responses,

        SUM(
          CASE
            WHEN response_status = 'no'
            THEN 1
            ELSE 0
          END
        ) AS no_responses,

        SUM(
          CASE
            WHEN response_status = 'pending'
            THEN 1
            ELSE 0
          END
        ) AS pending_responses,

        SUM(
          CASE
            WHEN response_status = 'yes'
            THEN
              CASE
                WHEN COALESCE(adults, 0) + COALESCE(children, 0) < 1
                THEN 1
                ELSE COALESCE(adults, 0) + COALESCE(children, 0)
              END
            ELSE 0
          END
        ) AS people_confirmed

      FROM guests

      WHERE event_id = ?
        AND deleted_at IS NULL
    `)
      .bind(eventId)
      .first();

  return {
    yes_responses:
      Number(row?.yes_responses || 0),

    no_responses:
      Number(row?.no_responses || 0),

    pending_responses:
      Number(row?.pending_responses || 0),

    people_confirmed:
      Number(row?.people_confirmed || 0),
  };
}

// =========================================================
// CONVIDADOS
// =========================================================

async function listGuests(env, eventId, url) {
  const q =
    normalizeName(
      url.searchParams.get("q") || ""
    );

  const status =
    url.searchParams.get("status") || "";

  let sql = `
    SELECT *
    FROM guests
    WHERE event_id = ?
      AND deleted_at IS NULL
  `;

  const bindings = [eventId];

  if (q) {
    sql += `
      AND normalized_name LIKE ?
    `;

    bindings.push(`%${q}%`);
  }

  if (
    ["yes", "no", "pending"].includes(
      status
    )
  ) {
    sql += `
      AND response_status = ?
    `;

    bindings.push(status);
  }

  sql += `
    ORDER BY
      CASE response_status
        WHEN 'yes' THEN 0
        WHEN 'pending' THEN 1
        ELSE 2
      END,

      primary_name COLLATE NOCASE ASC
  `;

  const stmt =
    env.DB.prepare(sql).bind(
      ...bindings
    );

  const result =
    await stmt.all();

  return result.results.map(
    serializeGuest
  );
}

async function listGuestsRaw(
  env,
  eventId
) {
  const result =
    await env.DB.prepare(`
      SELECT *
      FROM guests
      WHERE event_id = ?
        AND deleted_at IS NULL
      ORDER BY primary_name COLLATE NOCASE ASC
    `)
      .bind(eventId)
      .all();

  return result.results.map(
    serializeGuest
  );
}

async function getGuest(
  env,
  eventId,
  guestId
) {
  const row =
    await env.DB.prepare(`
      SELECT *
      FROM guests
      WHERE id = ?
        AND event_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `)
      .bind(
        guestId,
        eventId
      )
      .first();

  return row
    ? serializeGuest(row)
    : null;
}

async function createGuest(
  env,
  eventId,
  body,
  source
) {
  const primaryName =
    String(
      body.primary_name || ""
    ).trim();

  if (!primaryName) {
    throw new HttpError(
      400,
      "Informe o nome do convidado."
    );
  }

  const id =
    crypto.randomUUID();

  const status =
    allowedStatus(
      body.response_status
    );

  const createdAt =
    now();

  const attendance =
    normalizeAttendance(
      status,
      body.adults,
      body.children
    );

  await env.DB.prepare(`
    INSERT INTO guests (
      id,
      event_id,
      primary_name,
      normalized_name,
      response_status,
      phone,
      adults,
      children,
      companions,
      dietary,
      notes,
      source,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
    )
  `)
    .bind(
      id,

      eventId,

      primaryName,

      normalizeName(primaryName),

      status,

      cleanNullable(body.phone),

      attendance.adults,

      attendance.children,

      JSON.stringify(
        normalizeCompanions(
          body.companions
        )
      ),

      cleanNullable(body.dietary),

      cleanNullable(body.notes),

      source,

      createdAt,

      createdAt
    )
    .run();

  return getGuest(
    env,
    eventId,
    id
  );
}

async function updateGuest(
  env,
  eventId,
  guestId,
  body
) {
  const existing =
    await getGuest(
      env,
      eventId,
      guestId
    );

  if (!existing) {
    return null;
  }

  const primaryName =
    String(
      body.primary_name ??
        existing.primary_name
    ).trim();

  if (!primaryName) {
    throw new HttpError(
      400,
      "Informe o nome do convidado."
    );
  }

  const status =
    allowedStatus(
      body.response_status ??
        existing.response_status
    );

  const attendance =
    normalizeAttendance(
      status,

      body.adults ??
        existing.adults,

      body.children ??
        existing.children
    );

  const companions =
    body.companions === undefined
      ? existing.companions
      : normalizeCompanions(
          body.companions
        );

  await env.DB.prepare(`
    UPDATE guests
    SET
      primary_name = ?,
      normalized_name = ?,
      response_status = ?,
      phone = ?,
      adults = ?,
      children = ?,
      companions = ?,
      dietary = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ?
      AND event_id = ?
      AND deleted_at IS NULL
  `)
    .bind(
      primaryName,

      normalizeName(primaryName),

      status,

      cleanNullable(
        body.phone ??
          existing.phone
      ),

      attendance.adults,

      attendance.children,

      JSON.stringify(companions),

      cleanNullable(
        body.dietary ??
          existing.dietary
      ),

      cleanNullable(
        body.notes ??
          existing.notes
      ),

      now(),

      guestId,

      eventId
    )
    .run();

  return getGuest(
    env,
    eventId,
    guestId
  );
}

async function softDeleteGuest(
  env,
  eventId,
  guestId
) {
  const currentTime = now();

  await env.DB.prepare(`
    UPDATE guests
    SET
      deleted_at = ?,
      updated_at = ?
    WHERE id = ?
      AND event_id = ?
      AND deleted_at IS NULL
  `)
    .bind(
      currentTime,
      currentTime,
      guestId,
      eventId
    )
    .run();
}

// =========================================================
// AUDITORIA
// =========================================================

async function audit(
  env,
  {
    eventId,
    guestId = null,
    actorRole,
    action,
    details = null,
  }
) {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_logs (
        id,
        event_id,
        guest_id,
        actor_role,
        action,
        details,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),

        eventId,

        guestId,

        actorRole,

        action,

        details
          ? JSON.stringify(details)
          : null,

        now()
      )
      .run();
  } catch (error) {
    console.error(
      "Falha ao registrar auditoria:",
      error
    );
  }
}

// =========================================================
// ADMIN SESSION
// =========================================================

async function createAdminSession(env) {
  const expires =
    Math.floor(Date.now() / 1000) +
    60 * 60 * 24;

  const payload =
    `admin.${expires}`;

  const signature =
    await sign(
      payload,
      env.SESSION_SECRET
    );

  const token =
    `${payload}.${signature}`;

  return [
    `libri_admin=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=86400",
  ].join("; ");
}

async function isAdmin(
  request,
  env
) {
  if (!env.SESSION_SECRET) {
    return false;
  }

  const cookies =
    parseCookies(
      request.headers.get("cookie") || ""
    );

  const token =
    cookies.libri_admin;

  if (!token) {
    return false;
  }

  const parts =
    token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const role =
    parts[0];

  const expires =
    Number(parts[1]);

  const signature =
    parts[2];

  if (
    role !== "admin" ||
    !Number.isFinite(expires) ||
    expires <
      Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const payload =
    `${role}.${expires}`;

  const expected =
    await sign(
      payload,
      env.SESSION_SECRET
    );

  return safeEqual(
    signature,
    expected
  );
}

async function sign(
  value,
  secret
) {
  const key =
    await crypto.subtle.importKey(
      "raw",

      new TextEncoder().encode(
        secret
      ),

      {
        name: "HMAC",
        hash: "SHA-256",
      },

      false,

      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",

      key,

      new TextEncoder().encode(
        value
      )
    );

  return base64Url(
    new Uint8Array(signature)
  );
}

// =========================================================
// TURNSTILE
// Se as variáveis não existirem, fica desativado.
// =========================================================

async function verifyTurnstile(
  request,
  env,
  token
) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return true;
  }

  if (!token) {
    return false;
  }

  const form =
    new FormData();

  form.set(
    "secret",
    env.TURNSTILE_SECRET_KEY
  );

  form.set(
    "response",
    token
  );

  const ip =
    request.headers.get(
      "CF-Connecting-IP"
    );

  if (ip) {
    form.set(
      "remoteip",
      ip
    );
  }

  const response =
    await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
      }
    );

  const result =
    await response.json();

  return Boolean(result.success);
}

// =========================================================
// CSV
// =========================================================

function csvResponse(
  guests,
  filename
) {
  const rows = [
    [
      "Nome",
      "Status",
      "Adultos",
      "Crianças",
      "Acompanhantes",
      "Telefone",
      "Restrição alimentar",
      "Observações",
      "Origem",
    ],
  ];

  for (const guest of guests) {
    rows.push([
      guest.primary_name,

      guest.response_status === "yes"
        ? "Confirmado"
        : guest.response_status === "no"
          ? "Não irá"
          : "Pendente",

      guest.adults,

      guest.children,

      guest.companions.join(" | "),

      guest.phone || "",

      guest.dietary || "",

      guest.notes || "",

      guest.source || "",
    ]);
  }

  const csv =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(csvCell)
          .join(";")
      )
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "content-type":
        "text/csv; charset=utf-8",

      "content-disposition":
        `attachment; filename="${filename}"`,

      "cache-control":
        "no-store",
    },
  });
}

function csvCell(value) {
  const text =
    String(value ?? "");

  return `"${text.replace(
    /"/g,
    '""'
  )}"`;
}

// =========================================================
// SERIALIZAÇÃO
// =========================================================

function serializeEvent(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,

    title: row.title,

    slug: row.slug,

    event_date:
      row.event_date || null,

    event_time:
      row.event_time || null,

    rsvp_mode:
      row.rsvp_mode || "free",

    welcome_message:
      row.welcome_message || "",

    primary_color:
      row.primary_color ||
      "#6f4f5f",

    accent_color:
      row.accent_color ||
      "#f4e8ed",

    background_image_url:
      row.background_image_url ||
      "",

    extra_fields:
      safeJson(
        row.extra_fields,
        {}
      ),

    status:
      row.status || "active",

    created_at:
      row.created_at,

    updated_at:
      row.updated_at,
  };
}

function publicEvent(row) {
  const event =
    serializeEvent(row);

  return {
    id: event.id,

    title: event.title,

    slug: event.slug,

    event_date:
      event.event_date,

    event_time:
      event.event_time,

    rsvp_mode:
      event.rsvp_mode,

    welcome_message:
      event.welcome_message,

    primary_color:
      event.primary_color,

    accent_color:
      event.accent_color,

    background_image_url:
      event.background_image_url,

    extra_fields:
      event.extra_fields,

    status:
      event.status,
  };
}

function serializeGuest(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,

    event_id:
      row.event_id,

    primary_name:
      row.primary_name,

    response_status:
      row.response_status ||
      "pending",

    phone:
      row.phone || "",

    adults:
      Number(row.adults || 0),

    children:
      Number(row.children || 0),

    companions:
      safeJson(
        row.companions,
        []
      ),

    dietary:
      row.dietary || "",

    notes:
      row.notes || "",

    source:
      row.source || "",

    created_at:
      row.created_at,

    updated_at:
      row.updated_at,
  };
}

// =========================================================
// HELPERS
// =========================================================

async function uniqueSlug(
  env,
  title
) {
  const base =
    slugify(title) ||
    "evento";

  let slug = base;

  let number = 1;

  while (true) {
    const exists =
      await env.DB.prepare(`
        SELECT id
        FROM events
        WHERE slug = ?
        LIMIT 1
      `)
        .bind(slug)
        .first();

    if (!exists) {
      return slug;
    }

    number += 1;

    slug =
      `${base}-${number}`;
  }
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .slice(0, 70);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function normalizeCompanions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      String(item || "").trim()
    )
    .filter(Boolean)
    .slice(0, 30);
}

function allowedStatus(value) {
  const status =
    String(
      value || "pending"
    ).toLowerCase();

  return [
    "yes",
    "no",
    "pending",
  ].includes(status)
    ? status
    : "pending";
}

function normalizeAttendance(
  status,
  adults,
  children
) {
  if (status === "no") {
    return {
      adults: 0,
      children: 0,
    };
  }

  let adultCount =
    integerBetween(
      adults,
      0,
      100
    );

  const childCount =
    integerBetween(
      children,
      0,
      100
    );

  if (
    status === "yes" &&
    adultCount +
      childCount <
      1
  ) {
    adultCount = 1;
  }

  return {
    adults: adultCount,
    children: childCount,
  };
}

function integerBetween(
  value,
  min,
  max
) {
  const number =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(number)
  ) {
    return min;
  }

  return Math.min(
    max,
    Math.max(
      min,
      number
    )
  );
}

function safeColor(
  value,
  fallback
) {
  const color =
    String(value || "");

  return /^#[0-9a-fA-F]{6}$/.test(
    color
  )
    ? color
    : fallback;
}

function cleanNullable(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text
    ? text
    : null;
}

function safeJson(
  value,
  fallback
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  if (
    typeof value === "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function randomToken() {
  const bytes =
    new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(
      /\+/g,
      "-"
    )
    .replace(
      /\//g,
      "_"
    )
    .replace(
      /=+$/g,
      ""
    );
}

function safeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    a.length !== b.length
  ) {
    return false;
  }

  let diff = 0;

  for (
    let index = 0;
    index < a.length;
    index++
  ) {
    diff |=
      a.charCodeAt(index) ^
      b.charCodeAt(index);
  }

  return diff === 0;
}

function parseCookies(header) {
  const result = {};

  for (
    const part of header.split(";")
  ) {
    const index =
      part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      part
        .slice(0, index)
        .trim();

    const value =
      part
        .slice(index + 1)
        .trim();

    result[key] = value;
  }

  return result;
}

function now() {
  return new Date().toISOString();
}

async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(
  data,
  status = 200,
  headers = {}
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...JSON_HEADERS,
        ...headers,
      },
    }
  );
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);

    this.status = status;
  }
}

// =========================================================
// FRONTEND / STATIC ASSETS
// =========================================================

async function serveApp(
  request,
  env
) {
  if (!env.ASSETS) {
    return new Response(
      "Static Assets não configurado.",
      {
        status: 500,
      }
    );
  }

  const response =
    await env.ASSETS.fetch(
      request
    );

  if (response.status !== 404) {
    return response;
  }

  const url =
    new URL(request.url);

  url.pathname =
    "/index.html";

  return env.ASSETS.fetch(
    new Request(
      url.toString(),
      request
    )
  );
}
