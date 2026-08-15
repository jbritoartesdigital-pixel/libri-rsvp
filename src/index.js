const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const RSVP_TIME_ZONE = "America/Sao_Paulo";

// =========================================================
// WORKER
// =========================================================

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
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

// =========================================================
// API
// =========================================================

async function handleApi(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // =======================================================
  // ADMIN LOGIN
  // =======================================================

  if (
    path === "/api/admin/login" &&
    method === "POST"
  ) {
    const body = await bodyJson(request);

    if (
      !env.ADMIN_PASSWORD ||
      !env.SESSION_SECRET
    ) {
      return json(
        {
          error:
            "ADMIN_PASSWORD e SESSION_SECRET não estão configurados.",
        },
        500
      );
    }

    if (
      String(body.password || "") !==
      String(env.ADMIN_PASSWORD)
    ) {
      return json(
        {
          error: "Senha incorreta.",
        },
        401
      );
    }

    const cookie =
      await createAdminSession(env);

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

  // =======================================================
  // ADMIN LOGOUT
  // =======================================================

  if (
    path === "/api/admin/logout" &&
    method === "POST"
  ) {
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

  // =======================================================
  // ADMIN ME
  // =======================================================

  if (
    path === "/api/admin/me" &&
    method === "GET"
  ) {
    if (
      !(await isAdmin(request, env))
    ) {
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

  // =======================================================
  // PROTEGER ROTAS ADMIN
  // =======================================================

  if (
    path.startsWith("/api/admin/")
  ) {
    if (
      !(await isAdmin(request, env))
    ) {
      return json(
        {
          error:
            "Sessão expirada. Entre novamente.",
        },
        401
      );
    }
  }

  // =======================================================
  // ADMIN
  // LISTAR EVENTOS
  // =======================================================

  if (
    path === "/api/admin/events" &&
    method === "GET"
  ) {
    const archived =
      url.searchParams.get(
        "archived"
      ) === "1";

    const events =
      await getEventsWithSummary(
        env,
        archived
      );

    return json({
      events,
    });
  }

  // =======================================================
  // ADMIN
  // CRIAR EVENTO
  // =======================================================

  if (
    path === "/api/admin/events" &&
    method === "POST"
  ) {
    const body =
      await bodyJson(request);

    if (
      !String(
        body.title || ""
      ).trim()
    ) {
      return json(
        {
          error:
            "Informe o nome do evento.",
        },
        400
      );
    }

    const event =
      await createEvent(
        env,
        body
      );

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

  // =======================================================
  // ADMIN
  // EVENTO
  // =======================================================

  let match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const summary =
      await getSummary(
        env,
        eventId
      );

    const origin =
      new URL(
        request.url
      ).origin;

    return json({
      event:
        serializeEvent(event),

      summary,

      client_url:
        event.client_token
          ? `${origin}/cliente/${encodeURIComponent(
              event.client_token
            )}`
          : null,

      public_url:
        `${origin}/e/${encodeURIComponent(
          event.slug
        )}`,
    });
  }

  // =======================================================
  // ADMIN
  // EDITAR EVENTO
  // =======================================================

  if (
    match &&
    method === "PATCH"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const current =
      await getEvent(
        env,
        eventId
      );

    if (!current) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const body =
      await bodyJson(request);

    const title =
      String(
        body.title ??
          current.title
      ).trim();

    if (!title) {
      return json(
        {
          error:
            "Informe o nome do evento.",
        },
        400
      );
    }

    const currentExtraFields =
      safeJson(
        current.extra_fields,
        {}
      );

    const extraFields =
      body.extra_fields !==
      undefined
        ? normalizeExtraFields(
            body.extra_fields
          )
        : normalizeExtraFields(
            currentExtraFields
          );

    const rsvpMode =
      body.rsvp_mode === "list"
        ? "list"
        : body.rsvp_mode ===
            "free"
          ? "free"
          : current.rsvp_mode;

    const maxPeople =
      normalizeOptionalInteger(
        body.max_people_per_rsvp !==
          undefined
          ? body.max_people_per_rsvp
          : current.max_people_per_rsvp,
        1,
        100
      );

    const backgroundImage =
      normalizeOptionalUrl(
        body.background_image_url !==
          undefined
          ? body.background_image_url
          : current.background_image_url
      );

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
        background_image_url = ?,
        extra_fields = ?,
        rsvp_deadline = ?,
        max_people_per_rsvp = ?,
        updated_at = ?

      WHERE id = ?
    `)
      .bind(
        title,

        cleanNullable(
          body.event_date !==
            undefined
            ? body.event_date
            : current.event_date
        ),

        cleanNullable(
          body.event_time !==
            undefined
            ? body.event_time
            : current.event_time
        ),

        rsvpMode,

        cleanNullable(
          body.welcome_message !==
            undefined
            ? body.welcome_message
            : current.welcome_message
        ),

        safeColor(
          body.primary_color,
          current.primary_color ||
            "#6f4f5f"
        ),

        safeColor(
          body.accent_color,
          current.accent_color ||
            "#f4e8ed"
        ),

        backgroundImage,

        JSON.stringify(
          extraFields
        ),

        cleanNullable(
          body.rsvp_deadline !==
            undefined
            ? body.rsvp_deadline
            : current.rsvp_deadline
        ),

        maxPeople,

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

    return json({
      event:
        serializeEvent(
          await getEvent(
            env,
            eventId
          )
        ),
    });
  }

  // =======================================================
  // ADMIN
  // PAUSAR / REATIVAR
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/status$/
    );

  if (
    match &&
    method === "POST"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    if (
      event.archived_at
    ) {
      return json(
        {
          error:
            "Restaure o evento antes de alterar o status.",
        },
        400
      );
    }

    const body =
      await bodyJson(request);

    const status =
      body.status ===
      "inactive"
        ? "inactive"
        : "active";

    await env.DB.prepare(`
      UPDATE events

      SET
        status = ?,
        updated_at = ?

      WHERE id = ?
    `)
      .bind(
        status,
        now(),
        eventId
      )
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",

      action:
        status === "active"
          ? "event_reactivated"
          : "event_paused",
    });

    return json({
      event:
        serializeEvent(
          await getEvent(
            env,
            eventId
          )
        ),
    });
  }

  // =======================================================
  // ADMIN
  // ARQUIVAR EVENTO
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/archive$/
    );

  if (
    match &&
    method === "POST"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    if (
      event.archived_at
    ) {
      return json({
        ok: true,
      });
    }

    const archivedAt =
      now();

    await env.DB.prepare(`
      UPDATE events

      SET
        archived_at = ?,
        status = 'inactive',
        updated_at = ?

      WHERE id = ?
    `)
      .bind(
        archivedAt,
        archivedAt,
        eventId
      )
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "event_archived",
    });

    return json({
      ok: true,
    });
  }

  // =======================================================
  // ADMIN
  // RESTAURAR EVENTO
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/unarchive$/
    );

  if (
    match &&
    method === "POST"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    await env.DB.prepare(`
      UPDATE events

      SET
        archived_at = NULL,
        status = 'active',
        updated_at = ?

      WHERE id = ?
    `)
      .bind(
        now(),
        eventId
      )
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action:
        "event_unarchived",
    });

    return json({
      ok: true,
    });
  }

  // =======================================================
  // ADMIN
  // TROCAR LINK DA CLIENTE
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/client-link\/reset$/
    );

  if (
    match &&
    method === "POST"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const token =
      randomToken();

    await env.DB.prepare(`
      UPDATE events

      SET
        client_token = ?,
        updated_at = ?

      WHERE id = ?
    `)
      .bind(
        token,
        now(),
        eventId
      )
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action:
        "client_link_reset",
    });

    return json({
      client_url:
        `${new URL(
          request.url
        ).origin}` +
        `/cliente/${encodeURIComponent(
          token
        )}`,
    });
  }

  // =======================================================
  // ADMIN
  // HISTÓRICO
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/audit$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const limit =
      integerBetween(
        url.searchParams.get(
          "limit"
        ) || 100,
        1,
        300
      );

    const result =
      await env.DB.prepare(`
        SELECT *

        FROM audit_logs

        WHERE event_id = ?

        ORDER BY
          created_at DESC

        LIMIT ?
      `)
        .bind(
          eventId,
          limit
        )
        .all();

    return json({
      logs:
        result.results.map(
          serializeAudit
        ),
    });
  }

  // =======================================================
  // ADMIN
  // LIXEIRA
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/trash$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const guests =
      await listDeletedGuests(
        env,
        eventId
      );

    return json({
      guests,
    });
  }

  // =======================================================
  // ADMIN
  // RESTAURAR CONVIDADO
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/guests\/([^/]+)\/restore$/
    );

  if (
    match &&
    method === "POST"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const guestId =
      decodeURIComponent(
        match[2]
      );

    const guest =
      await getDeletedGuestRow(
        env,
        eventId,
        guestId
      );

    if (!guest) {
      return json(
        {
          error:
            "Convidado excluído não encontrado.",
        },
        404
      );
    }

    await restoreGuest(
      env,
      eventId,
      guestId
    );

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action:
        "guest_restored",

      details: {
        name:
          guest.primary_name,
      },
    });

    return json({
      guest:
        await getGuest(
          env,
          eventId,
          guestId
        ),
    });
  }

  // =======================================================
  // ADMIN
  // LISTAR / ADICIONAR CONVIDADOS
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/guests$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const guests =
      await listGuests(
        env,
        eventId,
        url
      );

    return json({
      guests,
    });
  }

  if (
    match &&
    method === "POST"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const body =
      await bodyJson(request);

    const members =
      normalizeMembers(
        body.members
      );

    validateMemberLimit(
      event,
      members,
      allowedStatus(
        body.response_status
      )
    );

    const duplicateMatches =
      await findDuplicateMembers(
        env,
        eventId,
        members
      );

    const guest =
      await createGuest(
        env,
        eventId,
        body,
        "admin"
      );

    await audit(env, {
      eventId,
      guestId: guest.id,
      actorRole: "admin",
      action:
        "guest_created",

      details: {
        name:
          guest.primary_name,
      },
    });

    return json({
      guest,

      duplicate_matches:
        duplicateMatches,
    });
  }

  // =======================================================
  // ADMIN
  // EDITAR / EXCLUIR CONVIDADO
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/guests\/([^/]+)$/
    );

  if (
    match &&
    method === "PATCH"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const guestId =
      decodeURIComponent(
        match[2]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const body =
      await bodyJson(request);

    const existing =
      await getGuest(
        env,
        eventId,
        guestId
      );

    if (!existing) {
      return json(
        {
          error:
            "Convidado não encontrado.",
        },
        404
      );
    }

    const status =
      allowedStatus(
        body.response_status ??
          existing.response_status
      );

    const members =
      status === "no"
        ? []
        : body.members ===
            undefined
          ? existing.members
          : normalizeMembers(
              body.members
            );

    validateMemberLimit(
      event,
      members,
      status
    );

    const duplicateMatches =
      await findDuplicateMembers(
        env,
        eventId,
        members,
        guestId
      );

    const guest =
      await updateGuest(
        env,
        eventId,
        guestId,
        body
      );

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action:
        "guest_updated",

      details: {
        name:
          guest.primary_name,
      },
    });

    return json({
      guest,

      duplicate_matches:
        duplicateMatches,
    });
  }

  if (
    match &&
    method === "DELETE"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const guestId =
      decodeURIComponent(
        match[2]
      );

    const guest =
      await getGuest(
        env,
        eventId,
        guestId
      );

    if (!guest) {
      return json(
        {
          error:
            "Convidado não encontrado.",
        },
        404
      );
    }

    await softDeleteGuest(
      env,
      eventId,
      guestId
    );

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action:
        "guest_deleted",

      details: {
        name:
          guest.primary_name,
      },
    });

    return json({
      ok: true,
    });
  }

  // =======================================================
  // ADMIN
  // EXPORTAR CSV
  // =======================================================

  match =
    path.match(
      /^\/api\/admin\/events\/([^/]+)\/export\.csv$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const eventId =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEvent(
        env,
        eventId
      );

    if (!event) {
      return json(
        {
          error:
            "Evento não encontrado.",
        },
        404
      );
    }

    const guests =
      await listGuestsRaw(
        env,
        eventId
      );

    return csvResponse(
      guests,
      `convidados-${event.slug}.csv`
    );
  }

  // =======================================================
  // CLIENTE
  // EVENTO
  // =======================================================

  match =
    path.match(
      /^\/api\/client\/([^/]+)\/event$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const token =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEventByClientToken(
        env,
        token
      );

    if (!event) {
      return json(
        {
          error:
            "Este link não é válido ou foi substituído.",
        },
        404
      );
    }

    return json({
      event:
        serializeEvent(event),

      summary:
        await getSummary(
          env,
          event.id
        ),
    });
  }

  // =======================================================
  // CLIENTE
  // LISTAR / ADICIONAR
  // =======================================================

  match =
    path.match(
      /^\/api\/client\/([^/]+)\/guests$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const token =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEventByClientToken(
        env,
        token
      );

    if (!event) {
      return json(
        {
          error:
            "Acesso inválido.",
        },
        404
      );
    }

    return json({
      guests:
        await listGuests(
          env,
          event.id,
          url
        ),
    });
  }

  if (
    match &&
    method === "POST"
  ) {
    const token =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEventByClientToken(
        env,
        token
      );

    if (!event) {
      return json(
        {
          error:
            "Acesso inválido.",
        },
        404
      );
    }

    const body =
      await bodyJson(request);

    const status =
      allowedStatus(
        body.response_status
      );

    const members =
      status === "no"
        ? []
        : normalizeMembers(
            body.members
          );

    validateMemberLimit(
      event,
      members,
      status
    );

    const duplicateMatches =
      await findDuplicateMembers(
        env,
        event.id,
        members
      );

    const guest =
      await createGuest(
        env,
        event.id,
        body,
        "client"
      );

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "client",
      action:
        "guest_created",

      details: {
        name:
          guest.primary_name,
      },
    });

    return json({
      guest,

      duplicate_matches:
        duplicateMatches,
    });
  }

  // =======================================================
  // CLIENTE
  // EDITAR / EXCLUIR
  // =======================================================

  match =
    path.match(
      /^\/api\/client\/([^/]+)\/guests\/([^/]+)$/
    );

  if (
    match &&
    method === "PATCH"
  ) {
    const token =
      decodeURIComponent(
        match[1]
      );

    const guestId =
      decodeURIComponent(
        match[2]
      );

    const event =
      await getEventByClientToken(
        env,
        token
      );

    if (!event) {
      return json(
        {
          error:
            "Acesso inválido.",
        },
        404
      );
    }

    const body =
      await bodyJson(request);

    const existing =
      await getGuest(
        env,
        event.id,
        guestId
      );

    if (!existing) {
      return json(
        {
          error:
            "Convidado não encontrado.",
        },
        404
      );
    }

    const status =
      allowedStatus(
        body.response_status ??
          existing.response_status
      );

    const members =
      status === "no"
        ? []
        : body.members ===
            undefined
          ? existing.members
          : normalizeMembers(
              body.members
            );

    validateMemberLimit(
      event,
      members,
      status
    );

    const duplicateMatches =
      await findDuplicateMembers(
        env,
        event.id,
        members,
        guestId
      );

    const guest =
      await updateGuest(
        env,
        event.id,
        guestId,
        body
      );

    await audit(env, {
      eventId: event.id,
      guestId,
      actorRole: "client",
      action:
        "guest_updated",

      details: {
        name:
          guest.primary_name,
      },
    });

    return json({
      guest,

      duplicate_matches:
        duplicateMatches,
    });
  }

  if (
    match &&
    method === "DELETE"
  ) {
    const token =
      decodeURIComponent(
        match[1]
      );

    const guestId =
      decodeURIComponent(
        match[2]
      );

    const event =
      await getEventByClientToken(
        env,
        token
      );

    if (!event) {
      return json(
        {
          error:
            "Acesso inválido.",
        },
        404
      );
    }

    const guest =
      await getGuest(
        env,
        event.id,
        guestId
      );

    if (!guest) {
      return json(
        {
          error:
            "Convidado não encontrado.",
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
      action:
        "guest_deleted",

      details: {
        name:
          guest.primary_name,
      },
    });

    return json({
      ok: true,
    });
  }

  // =======================================================
  // CLIENTE
  // EXPORTAR
  // =======================================================

  match =
    path.match(
      /^\/api\/client\/([^/]+)\/export\.csv$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const token =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEventByClientToken(
        env,
        token
      );

    if (!event) {
      return json(
        {
          error:
            "Acesso inválido.",
        },
        404
      );
    }

    return csvResponse(
      await listGuestsRaw(
        env,
        event.id
      ),

      `convidados-${event.slug}.csv`
    );
  }

  // =======================================================
  // PÚBLICO
  // EVENTO
  // =======================================================

  match =
    path.match(
      /^\/api\/public\/events\/([^/]+)$/
    );

  if (
    match &&
    method === "GET"
  ) {
    const slug =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEventBySlug(
        env,
        slug
      );

    if (!event) {
      return json(
        {
          error:
            "Esta confirmação não está disponível.",
        },
        404
      );
    }

    const availability =
      getRsvpAvailability(
        event
      );

    return json({
      event: {
        ...publicEvent(
          event
        ),

        accepting_rsvp:
          availability.accepting,

        closed_reason:
          availability.reason,
      },
    });
  }

  // =======================================================
  // PÚBLICO
  // BUSCAR NOME
  // =======================================================

  match =
    path.match(
      /^\/api\/public\/events\/([^/]+)\/lookup$/
    );

  if (
    match &&
    method === "POST"
  ) {
    const slug =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEventBySlug(
        env,
        slug
      );

    if (!event) {
      return json(
        {
          error:
            "Evento indisponível.",
        },
        404
      );
    }

    const availability =
      getRsvpAvailability(
        event
      );

    if (
      !availability.accepting
    ) {
      return json(
        {
          error:
            availability.reason ||
            "As confirmações estão encerradas.",
        },
        403
      );
    }

    if (
      event.rsvp_mode !==
      "list"
    ) {
      return json(
        {
          error:
            "Este evento não utiliza lista pré-cadastrada.",
        },
        400
      );
    }

    const body =
      await bodyJson(request);

    const normalized =
      normalizeName(
        body.name || ""
      );

    if (!normalized) {
      return json(
        {
          error:
            "Digite seu nome.",
        },
        400
      );
    }

    const guestRow =
      await env.DB.prepare(`
        SELECT DISTINCT
          g.*

        FROM guests g

        LEFT JOIN guest_members gm
          ON gm.guest_id = g.id
          AND gm.deleted_at IS NULL

        WHERE
          g.event_id = ?
          AND g.deleted_at IS NULL

          AND (
            g.normalized_name = ?
            OR gm.normalized_name = ?
          )

        ORDER BY
          g.created_at ASC

        LIMIT 1
      `)
        .bind(
          event.id,
          normalized,
          normalized
        )
        .first();

    if (!guestRow) {
      return json(
        {
          error:
            "Não encontramos esse nome na lista. Confira a escrita ou fale com o anfitrião.",
        },
        404
      );
    }

    return json({
      guest:
        await hydrateGuest(
          env,
          guestRow
        ),
    });
  }

  // =======================================================
  // PÚBLICO
  // RSVP
  // =======================================================

  match =
    path.match(
      /^\/api\/public\/events\/([^/]+)\/rsvp$/
    );

  if (
    match &&
    method === "POST"
  ) {
    const slug =
      decodeURIComponent(
        match[1]
      );

    const event =
      await getEventBySlug(
        env,
        slug
      );

    if (!event) {
      return json(
        {
          error:
            "Evento indisponível.",
        },
        404
      );
    }

    const availability =
      getRsvpAvailability(
        event
      );

    if (
      !availability.accepting
    ) {
      return json(
        {
          error:
            availability.reason ||
            "As confirmações estão encerradas.",
        },
        403
      );
    }

    const body =
      await bodyJson(request);

    // =====================================================
    // HONEYPOT INVISÍVEL
    // =====================================================

    if (
      String(
        body.website || ""
      ).trim()
    ) {
      return json({
        ok: true,
      });
    }

    const responseStatus =
      allowedStatus(
        body.response_status
      );

    if (
      responseStatus !==
        "yes" &&
      responseStatus !==
        "no"
    ) {
      return json(
        {
          error:
            "Escolha se poderá comparecer.",
        },
        400
      );
    }

    const members =
      responseStatus === "yes"
        ? normalizeMembers(
            body.members
          )
        : [];

    validateMemberLimit(
      event,
      members,
      responseStatus
    );

    let guest;

    // =====================================================
    // LISTA PRÉ-CADASTRADA
    // =====================================================

    if (
      event.rsvp_mode ===
      "list"
    ) {
      if (!body.guest_id) {
        return json(
          {
            error:
              "Localize seu nome na lista antes de confirmar.",
          },
          400
        );
      }

      const existing =
        await getGuest(
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

      guest =
        await updateGuest(
          env,
          event.id,
          existing.id,
          {
            ...body,

            primary_name:
              existing.primary_name,

            response_status:
              responseStatus,

            members,
          }
        );
    }

    // =====================================================
    // CONFIRMAÇÃO LIVRE
    // =====================================================

    else {
      const primaryName =
        String(
          body.primary_name || ""
        ).trim();

      if (!primaryName) {
        return json(
          {
            error:
              "Informe seu nome.",
          },
          400
        );
      }

      const normalized =
        normalizeName(
          primaryName
        );

      const existingRow =
        await env.DB.prepare(`
          SELECT *

          FROM guests

          WHERE
            event_id = ?
            AND normalized_name = ?
            AND deleted_at IS NULL

          ORDER BY
            created_at ASC

          LIMIT 1
        `)
          .bind(
            event.id,
            normalized
          )
          .first();

      if (existingRow) {
        guest =
          await updateGuest(
            env,
            event.id,
            existingRow.id,
            {
              ...body,

              response_status:
                responseStatus,

              members,
            }
          );
      } else {
        guest =
          await createGuest(
            env,
            event.id,
            {
              ...body,

              response_status:
                responseStatus,

              members,
            },
            "public"
          );
      }
    }

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "public",
      action:
        "rsvp_submitted",

      details: {
        name:
          guest.primary_name,

        response_status:
          guest.response_status,

        people:
          guest.members.length,
      },
    });

    return json({
      ok: true,
      guest,
    });
  }

  // =======================================================
  // ROTA NÃO ENCONTRADA
  // =======================================================

  return json(
    {
      error:
        "Rota não encontrada.",
    },
    404
  );
}

// =========================================================
// EVENTOS
// =========================================================

async function createEvent(
  env,
  body
) {
  const id =
    crypto.randomUUID();

  const slug =
    await uniqueSlug(
      env,
      body.title
    );

  const clientToken =
    randomToken();

  const createdAt =
    now();

  const extraFields =
    normalizeExtraFields(
      body.extra_fields ||
        {}
    );

  const maxPeople =
    normalizeOptionalInteger(
      body.max_people_per_rsvp,
      1,
      100
    );

  const backgroundImage =
    normalizeOptionalUrl(
      body.background_image_url
    );

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
      rsvp_deadline,
      max_people_per_rsvp,
      archived_at,
      created_at,
      updated_at
    )

    VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      'active',
      ?,
      ?,
      NULL,
      ?,
      ?
    )
  `)
    .bind(
      id,

      String(
        body.title
      ).trim(),

      slug,

      cleanNullable(
        body.event_date
      ),

      cleanNullable(
        body.event_time
      ),

      body.rsvp_mode ===
      "list"
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

      backgroundImage,

      JSON.stringify(
        extraFields
      ),

      clientToken,

      cleanNullable(
        body.rsvp_deadline
      ),

      maxPeople,

      createdAt,

      createdAt
    )
    .run();

  return serializeEvent(
    await getEvent(
      env,
      id
    )
  );
}

// =========================================================
// LISTAR EVENTOS
// CORRIGIDO PARA NÃO DUPLICAR CONFIRMAÇÕES
// =========================================================

async function getEventsWithSummary(
  env,
  archived = false
) {
  const result =
    await env.DB.prepare(`
      SELECT
        e.*,

        (
          SELECT COUNT(*)

          FROM guests g

          WHERE
            g.event_id = e.id
            AND g.deleted_at IS NULL
            AND g.response_status = 'yes'
        )
        AS yes_responses,

        (
          SELECT COUNT(*)

          FROM guests g

          WHERE
            g.event_id = e.id
            AND g.deleted_at IS NULL
            AND g.response_status = 'no'
        )
        AS no_responses,

        (
          SELECT COUNT(*)

          FROM guests g

          WHERE
            g.event_id = e.id
            AND g.deleted_at IS NULL
            AND g.response_status = 'pending'
        )
        AS pending_responses,

        (
          SELECT COUNT(*)

          FROM guest_members gm

          INNER JOIN guests g
            ON g.id = gm.guest_id

          WHERE
            gm.event_id = e.id
            AND gm.deleted_at IS NULL
            AND g.deleted_at IS NULL
            AND g.response_status = 'yes'
        )
        AS people_confirmed,

        (
          SELECT COUNT(*)

          FROM guest_members gm

          INNER JOIN guests g
            ON g.id = gm.guest_id

          WHERE
            gm.event_id = e.id
            AND gm.deleted_at IS NULL
            AND g.deleted_at IS NULL
            AND g.response_status = 'yes'
            AND gm.person_type = 'adult'
        )
        AS adults_confirmed,

        (
          SELECT COUNT(*)

          FROM guest_members gm

          INNER JOIN guests g
            ON g.id = gm.guest_id

          WHERE
            gm.event_id = e.id
            AND gm.deleted_at IS NULL
            AND g.deleted_at IS NULL
            AND g.response_status = 'yes'
            AND gm.person_type = 'child'
        )
        AS children_confirmed

      FROM events e

      WHERE
        (
          ? = 1
          AND e.archived_at IS NOT NULL
        )

        OR

        (
          ? = 0
          AND e.archived_at IS NULL
        )

      ORDER BY

        CASE
          WHEN e.status = 'active'
          THEN 0
          ELSE 1
        END,

        COALESCE(
          e.event_date,
          '9999-12-31'
        ) ASC,

        e.created_at DESC
    `)
      .bind(
        archived ? 1 : 0,
        archived ? 1 : 0
      )
      .all();

  return result.results.map(
    (row) => ({
      ...serializeEvent(row),

      yes_responses:
        Number(
          row.yes_responses ||
            0
        ),

      no_responses:
        Number(
          row.no_responses ||
            0
        ),

      pending_responses:
        Number(
          row.pending_responses ||
            0
        ),

      people_confirmed:
        Number(
          row.people_confirmed ||
            0
        ),

      adults_confirmed:
        Number(
          row.adults_confirmed ||
            0
        ),

      children_confirmed:
        Number(
          row.children_confirmed ||
            0
        ),
    })
  );
}

// =========================================================
// BUSCAR EVENTO
// =========================================================

async function getEvent(
  env,
  id
) {
  return env.DB.prepare(`
    SELECT *

    FROM events

    WHERE id = ?

    LIMIT 1
  `)
    .bind(id)
    .first();
}

async function getEventBySlug(
  env,
  slug
) {
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

// =========================================================
// RESUMO
// =========================================================

async function getSummary(
  env,
  eventId
) {
  const guestRow =
    await env.DB.prepare(`
      SELECT

        SUM(
          CASE
            WHEN response_status = 'yes'
            THEN 1
            ELSE 0
          END
        )
        AS yes_responses,

        SUM(
          CASE
            WHEN response_status = 'no'
            THEN 1
            ELSE 0
          END
        )
        AS no_responses,

        SUM(
          CASE
            WHEN response_status = 'pending'
            THEN 1
            ELSE 0
          END
        )
        AS pending_responses

      FROM guests

      WHERE
        event_id = ?
        AND deleted_at IS NULL
    `)
      .bind(eventId)
      .first();

  const memberRow =
    await env.DB.prepare(`
      SELECT

        COUNT(*)
        AS people_confirmed,

        SUM(
          CASE
            WHEN gm.person_type = 'adult'
            THEN 1
            ELSE 0
          END
        )
        AS adults_confirmed,

        SUM(
          CASE
            WHEN gm.person_type = 'child'
            THEN 1
            ELSE 0
          END
        )
        AS children_confirmed

      FROM guest_members gm

      INNER JOIN guests g
        ON g.id = gm.guest_id

      WHERE
        gm.event_id = ?
        AND gm.deleted_at IS NULL
        AND g.deleted_at IS NULL
        AND g.response_status = 'yes'
    `)
      .bind(eventId)
      .first();

  return {
    yes_responses:
      Number(
        guestRow?.yes_responses ||
          0
      ),

    no_responses:
      Number(
        guestRow?.no_responses ||
          0
      ),

    pending_responses:
      Number(
        guestRow?.pending_responses ||
          0
      ),

    people_confirmed:
      Number(
        memberRow?.people_confirmed ||
          0
      ),

    adults_confirmed:
      Number(
        memberRow?.adults_confirmed ||
          0
      ),

    children_confirmed:
      Number(
        memberRow?.children_confirmed ||
          0
      ),
  };
}

// =========================================================
// DISPONIBILIDADE DO RSVP
// =========================================================

function getRsvpAvailability(
  event
) {
  if (
    event.archived_at
  ) {
    return {
      accepting: false,

      reason:
        "As confirmações deste evento estão encerradas.",
    };
  }

  if (
    event.status !==
    "active"
  ) {
    return {
      accepting: false,

      reason:
        "As confirmações estão temporariamente pausadas.",
    };
  }

  if (
    event.rsvp_deadline &&
    hasDeadlinePassed(
      event.rsvp_deadline
    )
  ) {
    return {
      accepting: false,

      reason:
        "O prazo para confirmação de presença foi encerrado.",
    };
  }

  return {
    accepting: true,
    reason: null,
  };
}

// =========================================================
// CONVIDADOS
// =========================================================

async function listGuests(
  env,
  eventId,
  url
) {
  const q =
    normalizeName(
      url.searchParams.get(
        "q"
      ) || ""
    );

  const status =
    url.searchParams.get(
      "status"
    ) || "";

  let sql = `
    SELECT DISTINCT
      g.*

    FROM guests g

    LEFT JOIN guest_members gm
      ON gm.guest_id = g.id
      AND gm.deleted_at IS NULL

    WHERE
      g.event_id = ?
      AND g.deleted_at IS NULL
  `;

  const bindings = [
    eventId,
  ];

  if (q) {
    sql += `
      AND (
        g.normalized_name LIKE ?
        OR gm.normalized_name LIKE ?
      )
    `;

    bindings.push(
      `%${q}%`,
      `%${q}%`
    );
  }

  if (
    [
      "yes",
      "no",
      "pending",
    ].includes(status)
  ) {
    sql += `
      AND g.response_status = ?
    `;

    bindings.push(
      status
    );
  }

  sql += `
    ORDER BY

      CASE
        g.response_status

        WHEN 'yes'
        THEN 0

        WHEN 'pending'
        THEN 1

        ELSE 2
      END,

      g.primary_name
        COLLATE NOCASE ASC
  `;

  const result =
    await env.DB.prepare(
      sql
    )
      .bind(
        ...bindings
      )
      .all();

  return hydrateGuests(
    env,
    result.results
  );
}

// =========================================================
// LISTA BRUTA
// =========================================================

async function listGuestsRaw(
  env,
  eventId
) {
  const result =
    await env.DB.prepare(`
      SELECT *

      FROM guests

      WHERE
        event_id = ?
        AND deleted_at IS NULL

      ORDER BY
        primary_name
        COLLATE NOCASE ASC
    `)
      .bind(eventId)
      .all();

  return hydrateGuests(
    env,
    result.results
  );
}

// =========================================================
// LIXEIRA
// =========================================================

async function listDeletedGuests(
  env,
  eventId
) {
  const result =
    await env.DB.prepare(`
      SELECT *

      FROM guests

      WHERE
        event_id = ?
        AND deleted_at IS NOT NULL

      ORDER BY
        deleted_at DESC
    `)
      .bind(eventId)
      .all();

  return hydrateGuests(
    env,
    result.results,
    true
  );
}

async function getDeletedGuestRow(
  env,
  eventId,
  guestId
) {
  return env.DB.prepare(`
    SELECT *

    FROM guests

    WHERE
      id = ?
      AND event_id = ?
      AND deleted_at IS NOT NULL

    LIMIT 1
  `)
    .bind(
      guestId,
      eventId
    )
    .first();
}

// =========================================================
// BUSCAR CONVIDADO
// =========================================================

async function getGuest(
  env,
  eventId,
  guestId
) {
  const row =
    await env.DB.prepare(`
      SELECT *

      FROM guests

      WHERE
        id = ?
        AND event_id = ?
        AND deleted_at IS NULL

      LIMIT 1
    `)
      .bind(
        guestId,
        eventId
      )
      .first();

  if (!row) {
    return null;
  }

  return hydrateGuest(
    env,
    row
  );
}

// =========================================================
// CRIAR CONVIDADO
// =========================================================

async function createGuest(
  env,
  eventId,
  body,
  source
) {
  const event =
    await getEvent(
      env,
      eventId
    );

  if (!event) {
    throw new HttpError(
      404,
      "Evento não encontrado."
    );
  }

  const primaryName =
    String(
      body.primary_name ||
        ""
    ).trim();

  if (!primaryName) {
    throw new HttpError(
      400,
      "Informe o nome do responsável pela confirmação."
    );
  }

  if (
    primaryName.length >
    150
  ) {
    throw new HttpError(
      400,
      "O nome informado é muito longo."
    );
  }

  const id =
    crypto.randomUUID();

  const status =
    allowedStatus(
      body.response_status
    );

  const members =
    status === "no"
      ? []
      : normalizeMembers(
          body.members
        );

  validateMemberLimit(
    event,
    members,
    status
  );

  const createdAt =
    now();

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
      love_message,
      source,
      created_at,
      updated_at,
      deleted_at
    )

    VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      NULL
    )
  `)
    .bind(
      id,

      eventId,

      primaryName,

      normalizeName(
        primaryName
      ),

      status,

      cleanOptionalText(
        body.phone,
        80
      ),

      countMembers(
        members,
        "adult"
      ),

      countMembers(
        members,
        "child"
      ),

      JSON.stringify(
        members.map(
          (member) =>
            member.name
        )
      ),

      cleanOptionalText(
        body.dietary,
        500
      ),

      cleanOptionalText(
        body.notes,
        2000
      ),

      cleanOptionalText(
        body.love_message,
        3000
      ),

      source,

      createdAt,

      createdAt
    )
    .run();

  await replaceGuestMembers(
    env,
    eventId,
    id,
    members
  );

  return getGuest(
    env,
    eventId,
    id
  );
}

// =========================================================
// EDITAR CONVIDADO
// =========================================================

async function updateGuest(
  env,
  eventId,
  guestId,
  body
) {
  const event =
    await getEvent(
      env,
      eventId
    );

  if (!event) {
    throw new HttpError(
      404,
      "Evento não encontrado."
    );
  }

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
      "Informe o nome do responsável pela confirmação."
    );
  }

  if (
    primaryName.length >
    150
  ) {
    throw new HttpError(
      400,
      "O nome informado é muito longo."
    );
  }

  const status =
    allowedStatus(
      body.response_status ??
        existing.response_status
    );

  const members =
    status === "no"
      ? []
      : body.members ===
          undefined
        ? existing.members
        : normalizeMembers(
            body.members
          );

  validateMemberLimit(
    event,
    members,
    status
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
      love_message = ?,
      updated_at = ?

    WHERE
      id = ?
      AND event_id = ?
      AND deleted_at IS NULL
  `)
    .bind(
      primaryName,

      normalizeName(
        primaryName
      ),

      status,

      cleanOptionalText(
        body.phone !==
          undefined
          ? body.phone
          : existing.phone,
        80
      ),

      countMembers(
        members,
        "adult"
      ),

      countMembers(
        members,
        "child"
      ),

      JSON.stringify(
        members.map(
          (member) =>
            member.name
        )
      ),

      cleanOptionalText(
        body.dietary !==
          undefined
          ? body.dietary
          : existing.dietary,
        500
      ),

      cleanOptionalText(
        body.notes !==
          undefined
          ? body.notes
          : existing.notes,
        2000
      ),

      cleanOptionalText(
        body.love_message !==
          undefined
          ? body.love_message
          : existing.love_message,
        3000
      ),

      now(),

      guestId,

      eventId
    )
    .run();

  await replaceGuestMembers(
    env,
    eventId,
    guestId,
    members
  );

  return getGuest(
    env,
    eventId,
    guestId
  );
}

// =========================================================
// SUBSTITUIR MEMBROS
// =========================================================

async function replaceGuestMembers(
  env,
  eventId,
  guestId,
  members
) {
  await env.DB.prepare(`
    DELETE FROM guest_members

    WHERE guest_id = ?
  `)
    .bind(
      guestId
    )
    .run();

  if (!members.length) {
    return;
  }

  const createdAt =
    now();

  const statements =
    members.map(
      (
        member,
        index
      ) =>
        env.DB.prepare(`
          INSERT INTO guest_members (
            id,
            guest_id,
            event_id,
            name,
            normalized_name,
            person_type,
            is_primary,
            sort_order,
            created_at,
            updated_at,
            deleted_at
          )

          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            NULL
          )
        `)
          .bind(
            crypto.randomUUID(),

            guestId,

            eventId,

            member.name,

            normalizeName(
              member.name
            ),

            member.person_type,

            index === 0
              ? 1
              : 0,

            index,

            createdAt,

            createdAt
          )
    );

  await env.DB.batch(
    statements
  );
}

// =========================================================
// EXCLUIR CONVIDADO
// =========================================================

async function softDeleteGuest(
  env,
  eventId,
  guestId
) {
  const currentTime =
    now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE guests

      SET
        deleted_at = ?,
        updated_at = ?

      WHERE
        id = ?
        AND event_id = ?
        AND deleted_at IS NULL
    `)
      .bind(
        currentTime,
        currentTime,
        guestId,
        eventId
      ),

    env.DB.prepare(`
      UPDATE guest_members

      SET
        deleted_at = ?,
        updated_at = ?

      WHERE
        guest_id = ?
        AND event_id = ?
        AND deleted_at IS NULL
    `)
      .bind(
        currentTime,
        currentTime,
        guestId,
        eventId
      ),
  ]);
}

// =========================================================
// RESTAURAR CONVIDADO
// =========================================================

async function restoreGuest(
  env,
  eventId,
  guestId
) {
  const currentTime =
    now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE guests

      SET
        deleted_at = NULL,
        updated_at = ?

      WHERE
        id = ?
        AND event_id = ?
    `)
      .bind(
        currentTime,
        guestId,
        eventId
      ),

    env.DB.prepare(`
      UPDATE guest_members

      SET
        deleted_at = NULL,
        updated_at = ?

      WHERE
        guest_id = ?
        AND event_id = ?
    `)
      .bind(
        currentTime,
        guestId,
        eventId
      ),
  ]);
}

// =========================================================
// HIDRATAR CONVIDADOS
// =========================================================

async function hydrateGuests(
  env,
  rows,
  includeDeleted = false
) {
  if (!rows.length) {
    return [];
  }

  const eventIds = [
    ...new Set(
      rows.map(
        (row) =>
          row.event_id
      )
    ),
  ];

  const placeholders =
    eventIds
      .map(() => "?")
      .join(",");

  const result =
    await env.DB.prepare(`
      SELECT *

      FROM guest_members

      WHERE
        event_id IN (
          ${placeholders}
        )

        ${
          includeDeleted
            ? ""
            : "AND deleted_at IS NULL"
        }

      ORDER BY
        sort_order ASC,
        name COLLATE NOCASE ASC
    `)
      .bind(
        ...eventIds
      )
      .all();

  const map =
    new Map();

  for (
    const member
    of result.results
  ) {
    if (
      !map.has(
        member.guest_id
      )
    ) {
      map.set(
        member.guest_id,
        []
      );
    }

    map
      .get(
        member.guest_id
      )
      .push(
        serializeMember(
          member
        )
      );
  }

  return rows.map(
    (row) =>
      serializeGuestRow(
        row,
        map.get(
          row.id
        ) || []
      )
  );
}

// =========================================================
// HIDRATAR UM CONVIDADO
// =========================================================

async function hydrateGuest(
  env,
  row
) {
  const result =
    await env.DB.prepare(`
      SELECT *

      FROM guest_members

      WHERE
        guest_id = ?
        AND deleted_at IS NULL

      ORDER BY
        sort_order ASC,
        name COLLATE NOCASE ASC
    `)
      .bind(
        row.id
      )
      .all();

  return serializeGuestRow(
    row,
    result.results.map(
      serializeMember
    )
  );
}

// =========================================================
// DUPLICIDADES
// =========================================================

async function findDuplicateMembers(
  env,
  eventId,
  members,
  excludeGuestId = null
) {
  if (!members.length) {
    return [];
  }

  const normalizedNames = [
    ...new Set(
      members
        .map(
          (member) =>
            normalizeName(
              member.name
            )
        )
        .filter(Boolean)
    ),
  ];

  if (
    !normalizedNames.length
  ) {
    return [];
  }

  const placeholders =
    normalizedNames
      .map(() => "?")
      .join(",");

  let sql = `
    SELECT
      gm.name,
      gm.normalized_name,
      gm.guest_id,
      g.primary_name

    FROM guest_members gm

    INNER JOIN guests g
      ON g.id = gm.guest_id

    WHERE
      gm.event_id = ?
      AND gm.deleted_at IS NULL
      AND g.deleted_at IS NULL
      AND gm.normalized_name
        IN (${placeholders})
  `;

  const bindings = [
    eventId,
    ...normalizedNames,
  ];

  if (
    excludeGuestId
  ) {
    sql += `
      AND gm.guest_id != ?
    `;

    bindings.push(
      excludeGuestId
    );
  }

  const result =
    await env.DB.prepare(
      sql
    )
      .bind(
        ...bindings
      )
      .all();

  return result.results.map(
    (row) => ({
      name:
        row.name,

      guest_id:
        row.guest_id,

      confirmation_name:
        row.primary_name,
    })
  );
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

      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `)
      .bind(
        crypto.randomUUID(),

        eventId,

        guestId,

        actorRole,

        action,

        details
          ? JSON.stringify(
              details
            )
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
// SESSÃO ADMIN
// =========================================================

async function createAdminSession(
  env
) {
  const expires =
    Math.floor(
      Date.now() /
      1000
    ) +
    60 *
      60 *
      24;

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
  if (
    !env.SESSION_SECRET
  ) {
    return false;
  }

  const cookies =
    parseCookies(
      request.headers.get(
        "cookie"
      ) || ""
    );

  const token =
    cookies.libri_admin;

  if (!token) {
    return false;
  }

  const parts =
    token.split(".");

  if (
    parts.length !== 3
  ) {
    return false;
  }

  const role =
    parts[0];

  const expires =
    Number(
      parts[1]
    );

  const signature =
    parts[2];

  if (
    role !== "admin" ||
    !Number.isFinite(
      expires
    ) ||
    expires <
      Math.floor(
        Date.now() /
        1000
      )
  ) {
    return false;
  }

  const expected =
    await sign(
      `${role}.${expires}`,
      env.SESSION_SECRET
    );

  return safeEqual(
    signature,
    expected
  );
}

// =========================================================
// ASSINATURA
// =========================================================

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
    new Uint8Array(
      signature
    )
  );
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
      "Responsável pela confirmação",
      "Status",
      "Adultos",
      "Crianças",
      "Total de pessoas",
      "Telefone",
      "Restrição alimentar",
      "Observações",
      "Mensagem carinhosa",
      "Origem",
    ],
  ];

  for (
    const guest
    of guests
  ) {
    const adults =
      guest.members
        .filter(
          (member) =>
            member.person_type ===
            "adult"
        )
        .map(
          (member) =>
            member.name
        )
        .join(" | ");

    const children =
      guest.members
        .filter(
          (member) =>
            member.person_type ===
            "child"
        )
        .map(
          (member) =>
            member.name
        )
        .join(" | ");

    rows.push([
      guest.primary_name,

      guest.response_status ===
      "yes"
        ? "Confirmado"
        : guest.response_status ===
            "no"
          ? "Não irá"
          : "Pendente",

      adults,

      children,

      guest.members.length,

      guest.phone || "",

      guest.dietary || "",

      guest.notes || "",

      guest.love_message || "",

      guest.source || "",
    ]);
  }

  const csv =
    "\uFEFF" +
    rows
      .map(
        (row) =>
          row
            .map(
              csvCell
            )
            .join(";")
      )
      .join("\r\n");

  return new Response(
    csv,
    {
      headers: {
        "content-type":
          "text/csv; charset=utf-8",

        "content-disposition":
          `attachment; filename="${filename}"`,

        "cache-control":
          "no-store",
      },
    }
  );
}

function csvCell(value) {
  const text =
    String(
      value ??
        ""
    );

  return `"${text.replace(
    /"/g,
    '""'
  )}"`;
}

// =========================================================
// SERIALIZAR EVENTO
// =========================================================

function serializeEvent(
  row
) {
  if (!row) {
    return null;
  }

  const availability =
    getRsvpAvailability(
      row
    );

  return {
    id:
      row.id,

    title:
      row.title,

    slug:
      row.slug,

    event_date:
      row.event_date ||
      null,

    event_time:
      row.event_time ||
      null,

    rsvp_mode:
      row.rsvp_mode ||
      "free",

    welcome_message:
      row.welcome_message ||
      "",

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
      row.status ||
      "active",

    rsvp_deadline:
      row.rsvp_deadline ||
      null,

    max_people_per_rsvp:
      row.max_people_per_rsvp ===
        null ||
      row.max_people_per_rsvp ===
        undefined
        ? null
        : Number(
            row.max_people_per_rsvp
          ),

    archived_at:
      row.archived_at ||
      null,

    accepting_rsvp:
      availability.accepting,

    closed_reason:
      availability.reason,

    created_at:
      row.created_at,

    updated_at:
      row.updated_at,
  };
}

// =========================================================
// EVENTO PÚBLICO
// =========================================================

function publicEvent(
  row
) {
  const event =
    serializeEvent(
      row
    );

  return {
    id:
      event.id,

    title:
      event.title,

    slug:
      event.slug,

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

    rsvp_deadline:
      event.rsvp_deadline,

    max_people_per_rsvp:
      event.max_people_per_rsvp,

    accepting_rsvp:
      event.accepting_rsvp,

    closed_reason:
      event.closed_reason,
  };
}

// =========================================================
// SERIALIZAR CONVIDADO
// =========================================================

function serializeGuestRow(
  row,
  members
) {
  return {
    id:
      row.id,

    event_id:
      row.event_id,

    primary_name:
      row.primary_name,

    response_status:
      row.response_status ||
      "pending",

    phone:
      row.phone ||
      "",

    members,

    adults:
      members.filter(
        (member) =>
          member.person_type ===
          "adult"
      ).length,

    children:
      members.filter(
        (member) =>
          member.person_type ===
          "child"
      ).length,

    people_count:
      members.length,

    dietary:
      row.dietary ||
      "",

    notes:
      row.notes ||
      "",

    love_message:
      row.love_message ||
      "",

    source:
      row.source ||
      "",

    created_at:
      row.created_at,

    updated_at:
      row.updated_at,

    deleted_at:
      row.deleted_at ||
      null,
  };
}

// =========================================================
// SERIALIZAR MEMBRO
// =========================================================

function serializeMember(
  row
) {
  return {
    id:
      row.id,

    name:
      row.name,

    person_type:
      row.person_type ===
      "child"
        ? "child"
        : "adult",

    is_primary:
      Boolean(
        row.is_primary
      ),

    sort_order:
      Number(
        row.sort_order ||
        0
      ),
  };
}

// =========================================================
// SERIALIZAR AUDITORIA
// =========================================================

function serializeAudit(
  row
) {
  return {
    id:
      row.id,

    event_id:
      row.event_id,

    guest_id:
      row.guest_id ||
      null,

    actor_role:
      row.actor_role,

    action:
      row.action,

    details:
      safeJson(
        row.details,
        {}
      ),

    created_at:
      row.created_at,
  };
}

// =========================================================
// CAMPOS EXTRAS
// =========================================================

function normalizeExtraFields(
  fields
) {
  return {
    phone:
      Boolean(
        fields?.phone
      ),

    dietary:
      Boolean(
        fields?.dietary
      ),

    notes:
      Boolean(
        fields?.notes
      ),

    love_message:
      fields?.love_message !==
      false,
  };
}

// =========================================================
// NORMALIZAR MEMBROS
// =========================================================

function normalizeMembers(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  const members = [];

  for (
    const item
    of value
  ) {
    const name =
      String(
        item?.name ||
          ""
      )
        .trim()
        .slice(
          0,
          150
        );

    if (!name) {
      continue;
    }

    members.push({
      name,

      person_type:
        item?.person_type ===
        "child"
          ? "child"
          : "adult",
    });
  }

  return members.slice(
    0,
    100
  );
}

// =========================================================
// VALIDAR LIMITE DE PESSOAS
// =========================================================

function validateMemberLimit(
  event,
  members,
  status
) {
  if (
    status === "yes" &&
    members.length === 0
  ) {
    throw new HttpError(
      400,
      "Informe pelo menos uma pessoa que irá à festa."
    );
  }

  const max =
    event.max_people_per_rsvp ===
      null ||
    event.max_people_per_rsvp ===
      undefined
      ? null
      : Number(
          event.max_people_per_rsvp
        );

  if (
    max &&
    members.length >
      max
  ) {
    throw new HttpError(
      400,
      `Esta confirmação permite no máximo ${max} pessoa(s).`
    );
  }
}

// =========================================================
// CONTAR MEMBROS
// =========================================================

function countMembers(
  members,
  type
) {
  return members.filter(
    (member) =>
      member.person_type ===
      type
  ).length;
}

// =========================================================
// SLUG ÚNICO
// =========================================================

async function uniqueSlug(
  env,
  title
) {
  const base =
    slugify(
      title
    ) ||
    "evento";

  let slug =
    base;

  let number =
    1;

  while (true) {
    const exists =
      await env.DB.prepare(`
        SELECT id

        FROM events

        WHERE slug = ?

        LIMIT 1
      `)
        .bind(
          slug
        )
        .first();

    if (!exists) {
      return slug;
    }

    number += 1;

    slug =
      `${base}-${number}`;
  }
}

// =========================================================
// SLUG
// =========================================================

function slugify(value) {
  return String(
    value || ""
  )
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
    .slice(
      0,
      70
    );
}

// =========================================================
// NORMALIZAR NOME
// =========================================================

function normalizeName(
  value
) {
  return String(
    value || ""
  )
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

// =========================================================
// STATUS
// =========================================================

function allowedStatus(
  value
) {
  const status =
    String(
      value ||
      "pending"
    ).toLowerCase();

  return [
    "yes",
    "no",
    "pending",
  ].includes(
    status
  )
    ? status
    : "pending";
}

// =========================================================
// INTEIRO OPCIONAL
// =========================================================

function normalizeOptionalInteger(
  value,
  min,
  max
) {
  if (
    value === null ||
    value === undefined ||
    String(
      value
    ).trim() === ""
  ) {
    return null;
  }

  return integerBetween(
    value,
    min,
    max
  );
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
    !Number.isFinite(
      number
    )
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

// =========================================================
// COR
// =========================================================

function safeColor(
  value,
  fallback
) {
  const color =
    String(
      value || ""
    );

  return /^#[0-9a-fA-F]{6}$/.test(
    color
  )
    ? color
    : fallback;
}

// =========================================================
// URL OPCIONAL
// =========================================================

function normalizeOptionalUrl(
  value
) {
  if (
    value === undefined ||
    value === null ||
    String(
      value
    ).trim() === ""
  ) {
    return null;
  }

  const text =
    String(
      value
    ).trim();

  let url;

  try {
    url =
      new URL(
        text
      );
  } catch {
    throw new HttpError(
      400,
      "A URL da imagem de fundo não é válida."
    );
  }

  if (
    url.protocol !==
      "https:" &&
    url.protocol !==
      "http:"
  ) {
    throw new HttpError(
      400,
      "A imagem de fundo precisa usar um endereço http ou https."
    );
  }

  return url.toString();
}

// =========================================================
// TEXTO OPCIONAL
// =========================================================

function cleanOptionalText(
  value,
  maxLength
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text =
    String(
      value
    ).trim();

  if (!text) {
    return null;
  }

  return text.slice(
    0,
    maxLength
  );
}

// =========================================================
// NULLABLE
// =========================================================

function cleanNullable(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text =
    String(
      value
    ).trim();

  return text
    ? text
    : null;
}

// =========================================================
// JSON SEGURO
// =========================================================

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
    typeof value ===
    "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(
      value
    );
  } catch {
    return fallback;
  }
}

// =========================================================
// TOKEN
// =========================================================

function randomToken() {
  const bytes =
    new Uint8Array(
      32
    );

  crypto.getRandomValues(
    bytes
  );

  return base64Url(
    bytes
  );
}

function base64Url(
  bytes
) {
  let binary = "";

  for (
    const byte
    of bytes
  ) {
    binary +=
      String.fromCharCode(
        byte
      );
  }

  return btoa(
    binary
  )
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

// =========================================================
// COMPARAÇÃO SEGURA
// =========================================================

function safeEqual(
  a,
  b
) {
  if (
    typeof a !==
      "string" ||
    typeof b !==
      "string" ||
    a.length !==
      b.length
  ) {
    return false;
  }

  let diff = 0;

  for (
    let index = 0;
    index <
    a.length;
    index++
  ) {
    diff |=
      a.charCodeAt(
        index
      ) ^
      b.charCodeAt(
        index
      );
  }

  return diff === 0;
}

// =========================================================
// COOKIES
// =========================================================

function parseCookies(
  header
) {
  const result = {};

  for (
    const part
    of header.split(";")
  ) {
    const index =
      part.indexOf("=");

    if (
      index === -1
    ) {
      continue;
    }

    const key =
      part
        .slice(
          0,
          index
        )
        .trim();

    const value =
      part
        .slice(
          index + 1
        )
        .trim();

    result[key] =
      value;
  }

  return result;
}

// =========================================================
// PRAZO RSVP
// HORÁRIO DO BRASIL
// =========================================================

function hasDeadlinePassed(
  deadline
) {
  if (!deadline) {
    return false;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      String(
        deadline
      )
    )
  ) {
    return false;
  }

  const today =
    dateInTimeZone(
      RSVP_TIME_ZONE
    );

  /*
    Se hoje for exatamente a data limite,
    ainda pode confirmar.

    Exemplo:
    prazo 20/09
    durante todo o dia 20/09 continua aberto.
  */

  return today >
    deadline;
}

function dateInTimeZone(
  timeZone
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    ).formatToParts(
      new Date()
    );

  const values = {};

  for (
    const part
    of parts
  ) {
    if (
      part.type !==
      "literal"
    ) {
      values[
        part.type
      ] =
        part.value;
    }
  }

  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );
}

// =========================================================
// DATA/HORA ATUAL
// =========================================================

function now() {
  return new Date()
    .toISOString();
}

// =========================================================
// BODY JSON
// =========================================================

async function bodyJson(
  request
) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// =========================================================
// RESPONSE JSON
// =========================================================

function json(
  data,
  status = 200,
  headers = {}
) {
  return new Response(
    JSON.stringify(
      data
    ),
    {
      status,

      headers: {
        ...JSON_HEADERS,
        ...headers,
      },
    }
  );
}

// =========================================================
// ERRO HTTP
// =========================================================

class HttpError extends Error {
  constructor(
    status,
    message
  ) {
    super(
      message
    );

    this.status =
      status;
  }
}

// =========================================================
// STATIC ASSETS
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

  if (
    response.status !==
    404
  ) {
    return response;
  }

  const url =
    new URL(
      request.url
    );

  url.pathname =
    "/index.html";

  return env.ASSETS.fetch(
    new Request(
      url.toString(),
      request
    )
  );
}
