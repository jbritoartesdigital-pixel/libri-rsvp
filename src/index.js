const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const RSVP_TIME_ZONE = "America/Sao_Paulo";
const MEDIA_PUBLIC_BASE = "https://midia.libriconvites.com.br";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_BULK_GUESTS = 300;

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
]);

const MEDIA_KINDS = new Set([
  "background_image",
  "background_video",
  "cover",
  "logo",
  "other",
]);

const DEFAULT_APPEARANCE = {
  background_color: "#f8efec",
  card_color: "#fffaf7",
  text_color: "#4f2d2a",
  muted_color: "#866e68",
  button_color: "#b8735f",
  button_text_color: "#ffffff",
  overlay_color: "#3a1f1b",
  overlay_opacity: 0.18,
  card_opacity: 0.94,
  card_blur: 12,
  card_radius: 28,
  font_style: "elegant",
  card_style: "glass",
  background_position: "center",
  background_x: "center",
  card_width: "medium",
  interface_language: "pt-BR",
  invitation_url: "",
  calendar_location: "",
  calendar_end_time: "",
  cover_url: "",
  logo_url: "",
};

const DEFAULT_PUBLIC_TEXTS = {
  eyebrow: "Confirmação de presença",
  intro: "Confirme sua presença para que tudo seja preparado com carinho.",
  lookup_label: "Digite seu nome",
  lookup_placeholder: "Comece a digitar seu nome",
  yes_button: "Sim, estarei presente!",
  no_button: "Não poderei comparecer",
  message_label: "Deixe uma mensagem carinhosa 💌",
  message_placeholder: "Uma mensagem especial para quem está celebrando...",
  success_title: "Presença confirmada!",
  success_message: "Que bom ter você com a gente. 💛",
  decline_title: "Resposta registrada",
  decline_message: "Obrigada por avisar.",
  decline_hint:
    "Tudo bem 💛 Se quiser, você ainda pode deixar uma mensagem carinhosa abaixo.",
  name_label: "Seu nome",
  calendar_button: "Adicionar à agenda",
  back_button: "Voltar ao convite",
  closed_title: "Confirmações encerradas",
};

const DEFAULT_PUBLIC_TEXTS_EN = {
  eyebrow: "RSVP",
  intro:
    "Please confirm your attendance so everything can be prepared with care.",
  lookup_label: "Enter your name",
  lookup_placeholder: "Start typing your name",
  yes_button: "Yes, I'll be there!",
  no_button: "I won't be able to attend",
  message_label: "Leave a sweet message 💌",
  message_placeholder: "A special message for the celebration...",
  success_title: "Attendance confirmed!",
  success_message: "We're so happy you'll be there. 💛",
  decline_title: "Response received",
  decline_message: "Thank you for letting us know.",
  decline_hint:
    "That's okay 💛 If you'd like, you can still leave a message below.",
  name_label: "Your name",
  calendar_button: "Add to calendar",
  back_button: "Back to invitation",
  closed_title: "RSVP closed",
};

const DEFAULT_CLIENT_PERMISSIONS = {
  manage_guests: true,
  manage_appearance: true,
  manage_texts: true,
  view_messages: true,
  export_guests: true,
  manage_event_details: false,
};

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
        return json({ error: error.message }, error.status);
      }

      return json({ error: "Ocorreu um erro interno." }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // =======================================================
  // ADMIN AUTH
  // =======================================================

  if (path === "/api/admin/login" && method === "POST") {
    const body = await bodyJson(request);

    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json(
        { error: "ADMIN_PASSWORD e SESSION_SECRET não estão configurados." },
        500
      );
    }

    if (String(body.password || "") !== String(env.ADMIN_PASSWORD)) {
      return json({ error: "Senha incorreta." }, 401);
    }

    const cookie = await createAdminSession(env);

    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  if (path === "/api/admin/logout" && method === "POST") {
    return json(
      { ok: true },
      200,
      {
        "set-cookie":
          "libri_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      }
    );
  }

  if (path === "/api/admin/me" && method === "GET") {
    if (!(await isAdmin(request, env))) {
      return json({ error: "Não autorizado." }, 401);
    }

    return json({ ok: true });
  }

  if (path.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) {
      return json({ error: "Sessão expirada. Entre novamente." }, 401);
    }
  }

  // =======================================================
  // ADMIN EVENTS
  // =======================================================

  if (path === "/api/admin/events" && method === "GET") {
    const archived = url.searchParams.get("archived") === "1";
    const events = await getEventsWithSummary(env, archived);
    return json({ events });
  }

  if (path === "/api/admin/events" && method === "POST") {
    const body = await bodyJson(request);

    if (!String(body.title || "").trim()) {
      return json({ error: "Informe o nome do evento." }, 400);
    }

    const event = await createEvent(env, body);

    await audit(env, {
      eventId: event.id,
      actorRole: "admin",
      action: "event_created",
      details: { title: event.title },
    });

    return json({ event });
  }

  let match = path.match(/^\/api\/admin\/events\/([^/]+)$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const origin = new URL(request.url).origin;

    return json({
      event: serializeEvent(event),
      summary: await getSummary(env, eventId),
      client_url: event.client_token
        ? `${origin}/cliente/${encodeURIComponent(event.client_token)}`
        : null,
      public_url: `${origin}/e/${encodeURIComponent(event.slug)}`,
    });
  }

  if (match && method === "PATCH") {
    const eventId = decodeURIComponent(match[1]);
    const current = await getEvent(env, eventId);

    if (!current) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const event = await updateEvent(env, current, body, "admin");

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "event_updated",
      details: { title: event.title },
    });

    return json({ event });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/status$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    if (event.archived_at) {
      return json(
        { error: "Restaure o evento antes de alterar o status." },
        400
      );
    }

    const body = await bodyJson(request);
    const status = body.status === "inactive" ? "inactive" : "active";

    await env.DB.prepare(`
      UPDATE events
      SET status = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(status, now(), eventId)
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: status === "active" ? "event_reactivated" : "event_paused",
    });

    return json({ event: serializeEvent(await getEvent(env, eventId)) });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/archive$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    if (!event.archived_at) {
      const archivedAt = now();

      await env.DB.prepare(`
        UPDATE events
        SET archived_at = ?, status = 'inactive', updated_at = ?
        WHERE id = ?
      `)
        .bind(archivedAt, archivedAt, eventId)
        .run();

      await audit(env, {
        eventId,
        actorRole: "admin",
        action: "event_archived",
      });
    }

    return json({ ok: true });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/unarchive$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    await env.DB.prepare(`
      UPDATE events
      SET archived_at = NULL, status = 'active', updated_at = ?
      WHERE id = ?
    `)
      .bind(now(), eventId)
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "event_unarchived",
    });

    return json({ ok: true });
  }

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/client-link\/reset$/
  );

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const token = randomToken();

    await env.DB.prepare(`
      UPDATE events
      SET client_token = ?, updated_at = ?
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

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/duplicate$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const current = await getEvent(env, eventId);

    if (!current) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const duplicated = await duplicateEvent(env, current);

    await audit(env, {
      eventId: duplicated.id,
      actorRole: "admin",
      action: "event_duplicated",
      details: {
        source_event_id: current.id,
        source_title: current.title,
      },
    });

    return json({ event: duplicated });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/audit$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const limit = integerBetween(url.searchParams.get("limit") || 100, 1, 300);

    const result = await env.DB.prepare(`
      SELECT *
      FROM audit_logs
      WHERE event_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
      .bind(eventId, limit)
      .all();

    return json({ logs: result.results.map(serializeAudit) });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/trash$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    return json({ guests: await listDeletedGuests(env, eventId) });
  }

  // =======================================================
  // ADMIN MEDIA
  // =======================================================

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/media$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    return json({ media: await listEventMedia(env, eventId) });
  }

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const media = await uploadEventMedia(request, env, event);

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "media_uploaded",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({
      media,
      event: serializeEvent(await getEvent(env, eventId)),
    });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/media\/([^/]+)$/);

  if (match && method === "DELETE") {
    const eventId = decodeURIComponent(match[1]);
    const mediaId = decodeURIComponent(match[2]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const media = await deleteEventMedia(env, event, mediaId);

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "media_deleted",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({
      ok: true,
      event: serializeEvent(await getEvent(env, eventId)),
    });
  }

  // =======================================================
  // ADMIN GUESTS
  // =======================================================

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/guests\/([^/]+)\/restore$/
  );

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const guest = await getDeletedGuestRow(env, eventId, guestId);

    if (!guest) {
      return json(
        { error: "Convidado excluído não encontrado." },
        404
      );
    }

    await restoreGuest(env, eventId, guestId);

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_restored",
      details: { name: guest.primary_name },
    });

    return json({ guest: await getGuest(env, eventId, guestId) });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/guests\/bulk$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const result = await bulkCreateGuests(env, event, body.rows, "admin");

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "guest_bulk_imported",
      details: {
        created: result.created.length,
        failed: result.failed.length,
      },
    });

    return json(result);
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/guests$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const [guests, counts] = await Promise.all([
      listGuests(env, eventId, url),
      guestStatusCounts(env, eventId),
    ]);

    return json({ guests, counts });
  }

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const members = normalizeManagedMembers(
      body.members,
      body.response_status
    );
    const duplicateMatches = await findDuplicateMembers(
      env,
      eventId,
      members
    );
    const guest = await createGuest(env, event, body, "admin");

    await audit(env, {
      eventId,
      guestId: guest.id,
      actorRole: "admin",
      action: "guest_created",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/guests\/([^/]+)$/
  );

  if (match && method === "PATCH") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const existing = await getGuest(env, eventId, guestId);

    if (!existing) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    const body = await bodyJson(request);

    const members =
      body.members === undefined
        ? existing.members
        : normalizeManagedMembers(
            body.members,
            body.response_status ?? existing.response_status
          );

    const duplicateMatches = await findDuplicateMembers(
      env,
      eventId,
      members,
      guestId
    );

    const guest = await updateGuest(env, event, guestId, body);

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_updated",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  if (match && method === "DELETE") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const guest = await getGuest(env, eventId, guestId);

    if (!guest) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    await softDeleteGuest(env, eventId, guestId);

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_deleted",
      details: { name: guest.primary_name },
    });

    return json({ ok: true });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/messages$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    return json({
      messages: await listLoveMessages(env, eventId, url),
    });
  }

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/export\.csv$/
  );

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const language = normalizeAppearance(
      safeJson(event.appearance_settings, {})
    ).interface_language;

    return csvResponse(
      await listGuestsRaw(env, eventId),
      `${language === "en" ? "guests" : "convidados"}-${event.slug}.csv`,
      language
    );
  }

  // =======================================================
  // CLIENT EVENT
  // =======================================================

  match = path.match(/^\/api\/client\/([^/]+)\/event$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json(
        { error: "Este link não é válido ou foi substituído." },
        404
      );
    }

    return json({
      event: serializeEvent(event),
      summary: await getSummary(env, event.id),
    });
  }

  if (match && method === "PATCH") {
    const token = decodeURIComponent(match[1]);
    const current = await getEventByClientToken(env, token);

    if (!current) {
      return json({ error: "Acesso inválido." }, 404);
    }

    const body = await bodyJson(request);
    const event = await updateEventFromClient(env, current, body);

    await audit(env, {
      eventId: current.id,
      actorRole: "client",
      action: "event_updated",
      details: { title: event.title },
    });

    return json({ event });
  }

  // =======================================================
  // CLIENT MEDIA
  // =======================================================

  match = path.match(/^\/api\/client\/([^/]+)\/media$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    return json({ media: await listEventMedia(env, event.id) });
  }

  if (match && method === "POST") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_appearance");

    const media = await uploadEventMedia(request, env, event);

    await audit(env, {
      eventId: event.id,
      actorRole: "client",
      action: "media_uploaded",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({
      media,
      event: serializeEvent(await getEvent(env, event.id)),
    });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/media\/([^/]+)$/);

  if (match && method === "DELETE") {
    const token = decodeURIComponent(match[1]);
    const mediaId = decodeURIComponent(match[2]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_appearance");

    const media = await deleteEventMedia(env, event, mediaId);

    await audit(env, {
      eventId: event.id,
      actorRole: "client",
      action: "media_deleted",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({
      ok: true,
      event: serializeEvent(await getEvent(env, event.id)),
    });
  }

  // =======================================================
  // CLIENT GUESTS
  // =======================================================

  match = path.match(/^\/api\/client\/([^/]+)\/guests\/bulk$/);

  if (match && method === "POST") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");

    const body = await bodyJson(request);
    const result = await bulkCreateGuests(
      env,
      event,
      body.rows,
      "client"
    );

    await audit(env, {
      eventId: event.id,
      actorRole: "client",
      action: "guest_bulk_imported",
      details: {
        created: result.created.length,
        failed: result.failed.length,
      },
    });

    return json(result);
  }

  match = path.match(/^\/api\/client\/([^/]+)\/guests$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    const [guests, counts] = await Promise.all([
      listGuests(env, event.id, url),
      guestStatusCounts(env, event.id),
    ]);

    return json({ guests, counts });
  }

  if (match && method === "POST") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");

    const body = await bodyJson(request);
    const members = normalizeManagedMembers(
      body.members,
      body.response_status
    );

    const duplicateMatches = await findDuplicateMembers(
      env,
      event.id,
      members
    );

    const guest = await createGuest(env, event, body, "client");

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "client",
      action: "guest_created",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/guests\/([^/]+)$/);

  if (match && method === "PATCH") {
    const token = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");

    const existing = await getGuest(env, event.id, guestId);

    if (!existing) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    const body = await bodyJson(request);

    const members =
      body.members === undefined
        ? existing.members
        : normalizeManagedMembers(
            body.members,
            body.response_status ?? existing.response_status
          );

    const duplicateMatches = await findDuplicateMembers(
      env,
      event.id,
      members,
      guestId
    );

    const guest = await updateGuest(env, event, guestId, body);

    await audit(env, {
      eventId: event.id,
      guestId,
      actorRole: "client",
      action: "guest_updated",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  if (match && method === "DELETE") {
    const token = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");

    const guest = await getGuest(env, event.id, guestId);

    if (!guest) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    await softDeleteGuest(env, event.id, guestId);

    await audit(env, {
      eventId: event.id,
      guestId,
      actorRole: "client",
      action: "guest_deleted",
      details: { name: guest.primary_name },
    });

    return json({ ok: true });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/messages$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "view_messages");

    return json({
      messages: await listLoveMessages(env, event.id, url),
    });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/export\.csv$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "export_guests");

    const language = normalizeAppearance(
      safeJson(event.appearance_settings, {})
    ).interface_language;

    return csvResponse(
      await listGuestsRaw(env, event.id),
      `${language === "en" ? "guests" : "convidados"}-${event.slug}.csv`,
      language
    );
  }

  // =======================================================
  // PUBLIC EVENT
  // =======================================================

  match = path.match(/^\/api\/public\/events\/([^/]+)$/);

  if (match && method === "GET") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json(
        { error: "Esta confirmação não está disponível." },
        404
      );
    }

    return json({ event: publicEvent(event) });
  }

  match = path.match(
    /^\/api\/public\/events\/([^/]+)\/suggestions$/
  );

  if (match && method === "GET") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json({ error: "Evento indisponível." }, 404);
    }

    const availability = getRsvpAvailability(event);

    if (!availability.accepting) {
      return json({ error: availability.reason }, 403);
    }

    if (event.rsvp_mode !== "list") {
      return json({ suggestions: [] });
    }

    const q = normalizeName(url.searchParams.get("q") || "");

    if (q.length < 2) {
      return json({ suggestions: [] });
    }

    return json({
      suggestions: await publicSuggestions(env, event.id, q),
    });
  }

  match = path.match(/^\/api\/public\/events\/([^/]+)\/lookup$/);

  if (match && method === "POST") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json({ error: "Evento indisponível." }, 404);
    }

    const availability = getRsvpAvailability(event);

    if (!availability.accepting) {
      return json({ error: availability.reason }, 403);
    }

    if (event.rsvp_mode !== "list") {
      return json(
        { error: "Este evento não utiliza lista pré-cadastrada." },
        400
      );
    }

    const body = await bodyJson(request);
    let guestRow = null;

    if (body.guest_id) {
      guestRow = await env.DB.prepare(`
        SELECT *
        FROM guests
        WHERE id = ? AND event_id = ? AND deleted_at IS NULL
        LIMIT 1
      `)
        .bind(String(body.guest_id), event.id)
        .first();
    } else {
      const normalized = normalizeName(body.name || "");

      if (!normalized) {
        return json({ error: "Digite seu nome." }, 400);
      }

      guestRow = await env.DB.prepare(`
        SELECT DISTINCT g.*
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
        ORDER BY g.created_at ASC
        LIMIT 1
      `)
        .bind(event.id, normalized, normalized)
        .first();
    }

    if (!guestRow) {
      return json(
        {
          error:
            "Não encontramos esse nome na lista. Confira a escrita ou fale com o anfitrião.",
        },
        404
      );
    }

    const guest = await hydrateGuest(env, guestRow);

    return json({
      guest: publicGuest(guest, event),
    });
  }

  match = path.match(/^\/api\/public\/events\/([^/]+)\/rsvp$/);

  if (match && method === "POST") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json({ error: "Evento indisponível." }, 404);
    }

    const availability = getRsvpAvailability(event);

    if (!availability.accepting) {
      return json({ error: availability.reason }, 403);
    }

    const body = await bodyJson(request);

    if (String(body.website || "").trim()) {
      return json({ ok: true });
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

      guest = await submitListRsvp(env, event, body);
    } else {
      guest = await submitFreeRsvp(env, event, body);
    }

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "public",
      action: "rsvp_submitted",
      details: {
        name: guest.primary_name,
        response_status: guest.response_status,
        confirmed_people: guest.confirmed_people,
      },
    });

    return json({
      ok: true,
      guest: publicGuest(guest, event),
    });
  }

  return json({ error: "Rota não encontrada." }, 404);
}

// =========================================================
// EVENTS
// =========================================================

async function createEvent(env, body) {
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(env, body.title);
  const clientToken = randomToken();
  const createdAt = now();

  const extraFields = normalizeExtraFields(body.extra_fields || {});
  const appearance = normalizeAppearance(
    body.appearance_settings || {}
  );
  const publicTexts = normalizePublicTexts(
    body.public_texts || {},
    appearance.interface_language
  );
  const clientPermissions = normalizeClientPermissions(
    body.client_permissions || {}
  );
  const backgroundType = normalizeBackgroundType(
    body.background_type
  );
  const backgroundImageUrl = normalizeOptionalUrl(
    body.background_image_url
  );
  const backgroundVideoUrl = normalizeOptionalUrl(
    body.background_video_url
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
      background_type,
      background_video_url,
      appearance_settings,
      public_texts,
      client_permissions,
      list_behavior,
      created_at,
      updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL,
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)
    .bind(
      id,
      String(body.title).trim(),
      slug,
      cleanNullable(body.event_date),
      cleanNullable(body.event_time),
      body.rsvp_mode === "list" ? "list" : "free",
      cleanNullable(body.welcome_message),
      safeColor(body.primary_color, "#b8735f"),
      safeColor(body.accent_color, "#f8efec"),
      backgroundImageUrl,
      JSON.stringify(extraFields),
      clientToken,
      cleanNullable(body.rsvp_deadline),
      normalizeOptionalInteger(body.max_people_per_rsvp, 1, 100),
      backgroundType,
      backgroundVideoUrl,
      JSON.stringify(appearance),
      JSON.stringify(publicTexts),
      JSON.stringify(clientPermissions),
      normalizeListBehavior(body.list_behavior),
      createdAt,
      createdAt
    )
    .run();

  return serializeEvent(await getEvent(env, id));
}

async function updateEvent(env, current, body, actorRole = "admin") {
  const title = String(body.title ?? current.title).trim();

  if (!title) {
    throw new HttpError(400, "Informe o nome do evento.");
  }

  const extraFields =
    body.extra_fields !== undefined
      ? normalizeExtraFields(body.extra_fields)
      : normalizeExtraFields(safeJson(current.extra_fields, {}));

  const appearance =
    body.appearance_settings !== undefined
      ? normalizeAppearance(body.appearance_settings)
      : normalizeAppearance(
          safeJson(current.appearance_settings, {})
        );

  const publicTexts =
    body.public_texts !== undefined
      ? normalizePublicTexts(
          body.public_texts,
          appearance.interface_language
        )
      : normalizePublicTexts(
          safeJson(current.public_texts, {}),
          appearance.interface_language
        );

  const clientPermissions =
    body.client_permissions !== undefined
      ? normalizeClientPermissions(body.client_permissions)
      : normalizeClientPermissions(
          safeJson(current.client_permissions, {})
        );

  const rsvpMode =
    body.rsvp_mode === "list"
      ? "list"
      : body.rsvp_mode === "free"
        ? "free"
        : current.rsvp_mode;

  const backgroundImageUrl = normalizeOptionalUrl(
    body.background_image_url !== undefined
      ? body.background_image_url
      : current.background_image_url
  );

  const backgroundVideoUrl = normalizeOptionalUrl(
    body.background_video_url !== undefined
      ? body.background_video_url
      : current.background_video_url
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
      background_type = ?,
      background_video_url = ?,
      appearance_settings = ?,
      public_texts = ?,
      client_permissions = ?,
      list_behavior = ?,
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
        current.primary_color || "#b8735f"
      ),
      safeColor(
        body.accent_color,
        current.accent_color || "#f8efec"
      ),
      backgroundImageUrl,
      JSON.stringify(extraFields),
      cleanNullable(
        body.rsvp_deadline !== undefined
          ? body.rsvp_deadline
          : current.rsvp_deadline
      ),
      normalizeOptionalInteger(
        body.max_people_per_rsvp !== undefined
          ? body.max_people_per_rsvp
          : current.max_people_per_rsvp,
        1,
        100
      ),
      normalizeBackgroundType(
        body.background_type !== undefined
          ? body.background_type
          : current.background_type
      ),
      backgroundVideoUrl,
      JSON.stringify(appearance),
      JSON.stringify(publicTexts),
      JSON.stringify(clientPermissions),
      normalizeListBehavior(
        body.list_behavior !== undefined
          ? body.list_behavior
          : current.list_behavior
      ),
      now(),
      current.id
    )
    .run();

  return serializeEvent(await getEvent(env, current.id));
}

async function updateEventFromClient(env, current, body) {
  const permissions = normalizeClientPermissions(
    safeJson(current.client_permissions, {})
  );

  const patch = {};

  if (
    body.appearance_settings !== undefined ||
    body.background_type !== undefined
  ) {
    if (!permissions.manage_appearance) {
      throw new HttpError(
        403,
        "A personalização visual está bloqueada para este evento."
      );
    }

    if (body.appearance_settings !== undefined) {
      patch.appearance_settings = body.appearance_settings;
    }

    if (body.background_type !== undefined) {
      patch.background_type = body.background_type;
    }
  }

  if (body.public_texts !== undefined) {
    if (!permissions.manage_texts) {
      throw new HttpError(
        403,
        "A edição dos textos está bloqueada para este evento."
      );
    }

    patch.public_texts = body.public_texts;
  }

  const detailKeys = [
    "event_date",
    "event_time",
    "welcome_message",
  ];

  const wantsDetails = detailKeys.some(
    (key) => body[key] !== undefined
  );

  if (wantsDetails) {
    if (!permissions.manage_event_details) {
      throw new HttpError(
        403,
        "A edição dos dados do evento está bloqueada."
      );
    }

    for (const key of detailKeys) {
      if (body[key] !== undefined) {
        patch[key] = body[key];
      }
    }
  }

  if (!Object.keys(patch).length) {
    return serializeEvent(current);
  }

  return updateEvent(env, current, patch, "client");
}

async function duplicateEvent(env, current) {
  const copyTitle = `${current.title} • cópia`;

  return createEvent(env, {
    title: copyTitle,
    event_date: current.event_date,
    event_time: current.event_time,
    rsvp_mode: current.rsvp_mode,
    welcome_message: current.welcome_message,
    primary_color: current.primary_color,
    accent_color: current.accent_color,
    background_image_url: current.background_image_url,
    extra_fields: safeJson(current.extra_fields, {}),
    rsvp_deadline: current.rsvp_deadline,
    max_people_per_rsvp: current.max_people_per_rsvp,
    background_type: current.background_type,
    background_video_url: current.background_video_url,
    appearance_settings: safeJson(
      current.appearance_settings,
      {}
    ),
    public_texts: safeJson(current.public_texts, {}),
    client_permissions: safeJson(
      current.client_permissions,
      {}
    ),
    list_behavior: current.list_behavior,
  });
}

async function getEventsWithSummary(env, archived = false) {
  const result = await env.DB.prepare(`
    SELECT
      e.*,
      (
        SELECT COUNT(*)
        FROM guests g
        WHERE g.event_id = e.id
          AND g.deleted_at IS NULL
          AND g.response_status = 'yes'
      ) AS yes_responses,
      (
        SELECT COUNT(*)
        FROM guests g
        WHERE g.event_id = e.id
          AND g.deleted_at IS NULL
          AND g.response_status = 'no'
      ) AS no_responses,
      (
        SELECT COUNT(*)
        FROM guests g
        WHERE g.event_id = e.id
          AND g.deleted_at IS NULL
          AND g.response_status = 'pending'
      ) AS pending_responses,
      (
        SELECT COUNT(*)
        FROM guest_members gm
        INNER JOIN guests g ON g.id = gm.guest_id
        WHERE gm.event_id = e.id
          AND gm.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND gm.attendance_status = 'yes'
      ) AS people_confirmed,
      (
        SELECT COUNT(*)
        FROM guest_members gm
        INNER JOIN guests g ON g.id = gm.guest_id
        WHERE gm.event_id = e.id
          AND gm.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND gm.attendance_status = 'yes'
          AND gm.person_type = 'adult'
      ) AS adults_confirmed,
      (
        SELECT COUNT(*)
        FROM guest_members gm
        INNER JOIN guests g ON g.id = gm.guest_id
        WHERE gm.event_id = e.id
          AND gm.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND gm.attendance_status = 'yes'
          AND gm.person_type = 'child'
      ) AS children_confirmed
    FROM events e
    WHERE
      (? = 1 AND e.archived_at IS NOT NULL)
      OR
      (? = 0 AND e.archived_at IS NULL)
    ORDER BY
      CASE WHEN e.status = 'active' THEN 0 ELSE 1 END,
      COALESCE(e.event_date, '9999-12-31') ASC,
      e.created_at DESC
  `)
    .bind(archived ? 1 : 0, archived ? 1 : 0)
    .all();

  return result.results.map((row) => ({
    ...serializeEvent(row),
    yes_responses: Number(row.yes_responses || 0),
    no_responses: Number(row.no_responses || 0),
    pending_responses: Number(row.pending_responses || 0),
    people_confirmed: Number(row.people_confirmed || 0),
    adults_confirmed: Number(row.adults_confirmed || 0),
    children_confirmed: Number(row.children_confirmed || 0),
  }));
}

async function getEvent(env, id) {
  return env.DB.prepare(`
    SELECT * FROM events WHERE id = ? LIMIT 1
  `)
    .bind(id)
    .first();
}

async function getEventBySlug(env, slug) {
  return env.DB.prepare(`
    SELECT * FROM events WHERE slug = ? LIMIT 1
  `)
    .bind(slug)
    .first();
}

async function getEventByClientToken(env, token) {
  if (!token) return null;

  return env.DB.prepare(`
    SELECT * FROM events WHERE client_token = ? LIMIT 1
  `)
    .bind(token)
    .first();
}

async function getSummary(env, eventId) {
  const guestRow = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN response_status = 'yes' THEN 1 ELSE 0 END) AS yes_responses,
      SUM(CASE WHEN response_status = 'no' THEN 1 ELSE 0 END) AS no_responses,
      SUM(CASE WHEN response_status = 'pending' THEN 1 ELSE 0 END) AS pending_responses
    FROM guests
    WHERE event_id = ? AND deleted_at IS NULL
  `)
    .bind(eventId)
    .first();

  const memberRow = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN gm.attendance_status = 'yes' THEN 1 ELSE 0 END) AS people_confirmed,
      SUM(CASE WHEN gm.attendance_status = 'yes' AND gm.person_type = 'adult' THEN 1 ELSE 0 END) AS adults_confirmed,
      SUM(CASE WHEN gm.attendance_status = 'yes' AND gm.person_type = 'child' THEN 1 ELSE 0 END) AS children_confirmed,
      COUNT(*) AS people_registered
    FROM guest_members gm
    INNER JOIN guests g ON g.id = gm.guest_id
    WHERE gm.event_id = ?
      AND gm.deleted_at IS NULL
      AND g.deleted_at IS NULL
  `)
    .bind(eventId)
    .first();

  return {
    yes_responses: Number(guestRow?.yes_responses || 0),
    no_responses: Number(guestRow?.no_responses || 0),
    pending_responses: Number(guestRow?.pending_responses || 0),
    people_confirmed: Number(memberRow?.people_confirmed || 0),
    adults_confirmed: Number(memberRow?.adults_confirmed || 0),
    children_confirmed: Number(memberRow?.children_confirmed || 0),
    people_registered: Number(memberRow?.people_registered || 0),
  };
}

function getRsvpAvailability(event) {
  if (event.archived_at) {
    return {
      accepting: false,
      reason: "As confirmações deste evento estão encerradas.",
    };
  }

  if (event.status !== "active") {
    return {
      accepting: false,
      reason: "As confirmações estão temporariamente pausadas.",
    };
  }

  if (
    event.rsvp_deadline &&
    hasDeadlinePassed(event.rsvp_deadline)
  ) {
    return {
      accepting: false,
      reason: "O prazo para confirmação de presença foi encerrado.",
    };
  }

  return {
    accepting: true,
    reason: null,
  };
}

// =========================================================
// MEDIA / R2
// =========================================================

async function listEventMedia(env, eventId) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM event_media
    WHERE event_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `)
    .bind(eventId)
    .all();

  return result.results.map(serializeMedia);
}

async function uploadEventMedia(request, env, event) {
  ensureMediaBinding(env);

  const contentType = request.headers.get("content-type") || "";

  if (
    !contentType
      .toLowerCase()
      .includes("multipart/form-data")
  ) {
    throw new HttpError(
      400,
      "Envie a mídia pelo campo de upload."
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const kind = normalizeMediaKind(form.get("kind"));

  if (!(file instanceof File)) {
    throw new HttpError(
      400,
      "Escolha um arquivo para enviar."
    );
  }

  validateMediaFile(file, kind);

  const objectKey = buildMediaObjectKey(
    event.id,
    kind,
    file.type
  );

  const publicUrl = publicUrlForKey(objectKey);
  const mediaId = crypto.randomUUID();
  const createdAt = now();

  await env.MEDIA.put(objectKey, file, {
    httpMetadata: {
      contentType: file.type,
      cacheControl:
        "public, max-age=31536000, immutable",
    },
    customMetadata: {
      eventId: event.id,
      mediaKind: kind,
      originalName: sanitizeMetadataText(
        file.name,
        200
      ),
    },
  });

  try {
    await env.DB.prepare(`
      INSERT INTO event_media (
        id,
        event_id,
        object_key,
        public_url,
        media_kind,
        mime_type,
        original_name,
        size_bytes,
        created_at,
        deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `)
      .bind(
        mediaId,
        event.id,
        objectKey,
        publicUrl,
        kind,
        file.type,
        sanitizeMetadataText(file.name, 240),
        Number(file.size || 0),
        createdAt
      )
      .run();

    await applyMediaToEvent(
      env,
      event,
      kind,
      publicUrl
    );
  } catch (error) {
    await env.MEDIA.delete(objectKey).catch(() => {});
    throw error;
  }

  return serializeMedia(
    await env.DB.prepare(`
      SELECT *
      FROM event_media
      WHERE id = ?
      LIMIT 1
    `)
      .bind(mediaId)
      .first()
  );
}

async function deleteEventMedia(
  env,
  event,
  mediaId
) {
  ensureMediaBinding(env);

  const media = await env.DB.prepare(`
    SELECT *
    FROM event_media
    WHERE
      id = ?
      AND event_id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `)
    .bind(mediaId, event.id)
    .first();

  if (!media) {
    throw new HttpError(
      404,
      "Mídia não encontrada."
    );
  }

  await env.MEDIA.delete(media.object_key);

  const deletedAt = now();

  await env.DB.prepare(`
    UPDATE event_media
    SET deleted_at = ?
    WHERE id = ? AND event_id = ?
  `)
    .bind(deletedAt, mediaId, event.id)
    .run();

  await removeMediaFromEvent(
    env,
    event,
    media
  );

  return serializeMedia({
    ...media,
    deleted_at: deletedAt,
  });
}

async function applyMediaToEvent(
  env,
  event,
  kind,
  publicUrl
) {
  if (kind === "background_image") {
    await env.DB.prepare(`
      UPDATE events
      SET
        background_image_url = ?,
        background_type = 'image',
        updated_at = ?
      WHERE id = ?
    `)
      .bind(publicUrl, now(), event.id)
      .run();

    return;
  }

  if (kind === "background_video") {
    await env.DB.prepare(`
      UPDATE events
      SET
        background_video_url = ?,
        background_type = 'video',
        updated_at = ?
      WHERE id = ?
    `)
      .bind(publicUrl, now(), event.id)
      .run();

    return;
  }

  if (kind === "cover" || kind === "logo") {
    const appearance = normalizeAppearance(
      safeJson(event.appearance_settings, {})
    );

    appearance[
      kind === "cover" ? "cover_url" : "logo_url"
    ] = publicUrl;

    await env.DB.prepare(`
      UPDATE events
      SET
        appearance_settings = ?,
        updated_at = ?
      WHERE id = ?
    `)
      .bind(
        JSON.stringify(appearance),
        now(),
        event.id
      )
      .run();
  }
}

async function removeMediaFromEvent(
  env,
  event,
  media
) {
  const latest = await getEvent(env, event.id);

  const appearance = normalizeAppearance(
    safeJson(latest.appearance_settings, {})
  );

  let changedAppearance = false;

  let backgroundImageUrl =
    latest.background_image_url;

  let backgroundVideoUrl =
    latest.background_video_url;

  let backgroundType =
    normalizeBackgroundType(latest.background_type);

  if (backgroundImageUrl === media.public_url) {
    backgroundImageUrl = null;

    if (backgroundType === "image") {
      backgroundType = "none";
    }
  }

  if (backgroundVideoUrl === media.public_url) {
    backgroundVideoUrl = null;

    if (backgroundType === "video") {
      backgroundType = "none";
    }
  }

  if (appearance.cover_url === media.public_url) {
    appearance.cover_url = "";
    changedAppearance = true;
  }

  if (appearance.logo_url === media.public_url) {
    appearance.logo_url = "";
    changedAppearance = true;
  }

  await env.DB.prepare(`
    UPDATE events
    SET
      background_image_url = ?,
      background_video_url = ?,
      background_type = ?,
      appearance_settings = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      backgroundImageUrl,
      backgroundVideoUrl,
      backgroundType,
      JSON.stringify(
        changedAppearance
          ? appearance
          : normalizeAppearance(
              safeJson(
                latest.appearance_settings,
                {}
              )
            )
      ),
      now(),
      event.id
    )
    .run();
}

function ensureMediaBinding(env) {
  if (!env.MEDIA) {
    throw new HttpError(
      500,
      "O armazenamento de mídia ainda não está conectado ao Worker."
    );
  }
}

function normalizeMediaKind(value) {
  const kind = String(value || "").trim();

  if (!MEDIA_KINDS.has(kind)) {
    throw new HttpError(
      400,
      "Tipo de mídia inválido."
    );
  }

  return kind;
}

function validateMediaFile(file, kind) {
  if (!file.size) {
    throw new HttpError(
      400,
      "O arquivo está vazio."
    );
  }

  if (kind === "background_video") {
    if (!VIDEO_MIME_TYPES.has(file.type)) {
      throw new HttpError(
        400,
        "Use vídeo MP4 ou WebM para o fundo."
      );
    }

    if (file.size > MAX_VIDEO_BYTES) {
      throw new HttpError(
        400,
        "O vídeo de fundo pode ter no máximo 20 MB."
      );
    }

    return;
  }

  if (
    kind === "background_image" ||
    kind === "cover" ||
    kind === "logo"
  ) {
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      throw new HttpError(
        400,
        "Use imagem JPG, PNG, WebP ou AVIF."
      );
    }

    if (file.size > MAX_IMAGE_BYTES) {
      throw new HttpError(
        400,
        "A imagem pode ter no máximo 10 MB."
      );
    }

    return;
  }

  if (
    !IMAGE_MIME_TYPES.has(file.type) &&
    !VIDEO_MIME_TYPES.has(file.type)
  ) {
    throw new HttpError(
      400,
      "Formato de arquivo não permitido."
    );
  }

  if (file.size > MAX_VIDEO_BYTES) {
    throw new HttpError(
      400,
      "O arquivo pode ter no máximo 20 MB."
    );
  }
}

function buildMediaObjectKey(
  eventId,
  kind,
  mimeType
) {
  const ext = extensionForMime(mimeType);
  const folder = kind.replace(/_/g, "-");
  const unique = `${Date.now()}-${crypto.randomUUID()}`;

  return `rsvp/${eventId}/${folder}/${unique}.${ext}`;
}

function extensionForMime(mimeType) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };

  return map[mimeType] || "bin";
}

function publicUrlForKey(key) {
  return `${MEDIA_PUBLIC_BASE}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function serializeMedia(row) {
  if (!row) return null;

  return {
    id: row.id,
    event_id: row.event_id,
    public_url: row.public_url,
    media_kind: row.media_kind,
    mime_type: row.mime_type,
    original_name: row.original_name || "",
    size_bytes: Number(row.size_bytes || 0),
    created_at: row.created_at,
    deleted_at: row.deleted_at || null,
  };
}

// =========================================================
// GUEST LISTS
// =========================================================

async function listGuests(env, eventId, url) {
  const q = normalizeName(
    url.searchParams.get("q") || ""
  );

  const status =
    url.searchParams.get("status") || "";

  let sql = `
    SELECT DISTINCT g.*
    FROM guests g
    LEFT JOIN guest_members gm
      ON gm.guest_id = g.id
      AND gm.deleted_at IS NULL
    WHERE g.event_id = ?
      AND g.deleted_at IS NULL
  `;

  const bindings = [eventId];

  if (q) {
    sql += `
      AND (
        g.normalized_name LIKE ?
        OR COALESCE(g.normalized_group_label, '') LIKE ?
        OR gm.normalized_name LIKE ?
      )
    `;

    bindings.push(
      `%${q}%`,
      `%${q}%`,
      `%${q}%`
    );
  }

  if (
    ["yes", "no", "pending"].includes(status)
  ) {
    sql += ` AND g.response_status = ? `;
    bindings.push(status);
  }

  sql += `
    ORDER BY
      CASE
        WHEN g.responded_at IS NULL THEN 1
        ELSE 0
      END,
      g.responded_at DESC,
      g.updated_at DESC,
      COALESCE(
        NULLIF(g.group_label, ''),
        g.primary_name
      ) COLLATE NOCASE ASC
  `;

  const result = await env.DB
    .prepare(sql)
    .bind(...bindings)
    .all();

  return hydrateGuests(
    env,
    result.results
  );
}

async function guestStatusCounts(env, eventId) {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(
        CASE
          WHEN response_status = 'yes'
          THEN 1 ELSE 0
        END
      ) AS yes_count,
      SUM(
        CASE
          WHEN response_status = 'pending'
          THEN 1 ELSE 0
        END
      ) AS pending_count,
      SUM(
        CASE
          WHEN response_status = 'no'
          THEN 1 ELSE 0
        END
      ) AS no_count
    FROM guests
    WHERE
      event_id = ?
      AND deleted_at IS NULL
  `)
    .bind(eventId)
    .first();

  return {
    total: Number(row?.total || 0),
    yes: Number(row?.yes_count || 0),
    pending: Number(row?.pending_count || 0),
    no: Number(row?.no_count || 0),
  };
}

async function listGuestsRaw(env, eventId) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE
      event_id = ?
      AND deleted_at IS NULL
    ORDER BY
      COALESCE(
        NULLIF(group_label, ''),
        primary_name
      ) COLLATE NOCASE ASC
  `)
    .bind(eventId)
    .all();

  return hydrateGuests(
    env,
    result.results
  );
}

async function listDeletedGuests(
  env,
  eventId
) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE
      event_id = ?
      AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
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
    .bind(guestId, eventId)
    .first();
}

async function getGuest(
  env,
  eventId,
  guestId
) {
  const row = await env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE
      id = ?
      AND event_id = ?
      AND deleted_at IS NULL
    LIMIT 1
  `)
    .bind(guestId, eventId)
    .first();

  if (!row) return null;

  return hydrateGuest(env, row);
}

async function createGuest(
  env,
  event,
  body,
  source
) {
  const primaryName = String(
    body.primary_name || ""
  ).trim();

  if (!primaryName) {
    throw new HttpError(
      400,
      "Informe o nome do responsável pela confirmação."
    );
  }

  if (primaryName.length > 150) {
    throw new HttpError(
      400,
      "O nome informado é muito longo."
    );
  }

  const id = crypto.randomUUID();

  const members = normalizeManagedMembers(
    body.members,
    body.response_status
  );

  const status = deriveGroupStatus(
    members,
    allowedStatus(body.response_status)
  );

  const createdAt = now();

  const groupLabel = cleanOptionalText(
    body.group_label,
    150
  );

  const maxPeopleAllowed =
    normalizeOptionalInteger(
      body.max_people_allowed,
      1,
      100
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
      love_message,
      source,
      group_label,
      normalized_group_label,
      max_people_allowed,
      responded_at,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
    )
  `)
    .bind(
      id,
      event.id,
      primaryName,
      normalizeName(primaryName),
      status,
      cleanOptionalText(body.phone, 80),
      countMembers(members, "adult"),
      countMembers(members, "child"),
      JSON.stringify(
        members.map((member) => member.name)
      ),
      cleanOptionalText(body.dietary, 500),
      cleanOptionalText(body.notes, 2000),
      cleanOptionalText(
        body.love_message,
        3000
      ),
      source,
      groupLabel,
      normalizeName(groupLabel || ""),
      maxPeopleAllowed,
      status === "pending"
        ? null
        : createdAt,
      createdAt,
      createdAt
    )
    .run();

  await syncManagedGuestMembers(
    env,
    event.id,
    id,
    members,
    []
  );

  return getGuest(
    env,
    event.id,
    id
  );
}

async function updateGuest(
  env,
  event,
  guestId,
  body
) {
  const existing = await getGuest(
    env,
    event.id,
    guestId
  );

  if (!existing) return null;

  const primaryName = String(
    body.primary_name ??
      existing.primary_name
  ).trim();

  if (!primaryName) {
    throw new HttpError(
      400,
      "Informe o nome do responsável pela confirmação."
    );
  }

  if (primaryName.length > 150) {
    throw new HttpError(
      400,
      "O nome informado é muito longo."
    );
  }

  const requestedStatus =
    body.response_status !== undefined
      ? allowedStatus(body.response_status)
      : existing.response_status;

  const shouldApplyFamilyStatus =
    body.members === undefined &&
    ["yes", "no"].includes(requestedStatus);

  const members =
    body.members === undefined
      ? existing.members.map((member) => ({
          ...member,
          attendance_status:
            shouldApplyFamilyStatus
              ? requestedStatus
              : member.attendance_status,
        }))
      : normalizeManagedMembers(
          body.members,
          requestedStatus
        );

  const status = deriveGroupStatus(
    members,
    requestedStatus
  );

  const groupLabel =
    body.group_label !== undefined
      ? cleanOptionalText(
          body.group_label,
          150
        )
      : existing.group_label || null;

  const maxPeopleAllowed =
    body.max_people_allowed !== undefined
      ? normalizeOptionalInteger(
          body.max_people_allowed,
          1,
          100
        )
      : existing.max_people_allowed;

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
      group_label = ?,
      normalized_group_label = ?,
      max_people_allowed = ?,
      responded_at = ?,
      updated_at = ?
    WHERE
      id = ?
      AND event_id = ?
      AND deleted_at IS NULL
  `)
    .bind(
      primaryName,
      normalizeName(primaryName),
      status,
      cleanOptionalText(
        body.phone !== undefined
          ? body.phone
          : existing.phone,
        80
      ),
      countMembers(members, "adult"),
      countMembers(members, "child"),
      JSON.stringify(
        members.map((member) => member.name)
      ),
      cleanOptionalText(
        body.dietary !== undefined
          ? body.dietary
          : existing.dietary,
        500
      ),
      cleanOptionalText(
        body.notes !== undefined
          ? body.notes
          : existing.notes,
        2000
      ),
      cleanOptionalText(
        body.love_message !== undefined
          ? body.love_message
          : existing.love_message,
        3000
      ),
      groupLabel,
      normalizeName(groupLabel || ""),
      maxPeopleAllowed,
      status === "pending"
        ? existing.responded_at || null
        : existing.responded_at || now(),
      now(),
      guestId,
      event.id
    )
    .run();

  if (
    body.members !== undefined ||
    shouldApplyFamilyStatus
  ) {
    await syncManagedGuestMembers(
      env,
      event.id,
      guestId,
      members,
      existing.members
    );
  }

  return getGuest(
    env,
    event.id,
    guestId
  );
}

async function syncManagedGuestMembers(
  env,
  eventId,
  guestId,
  members,
  existingMembers
) {
  const currentTime = now();

  const existingById = new Map(
    (existingMembers || [])
      .filter((member) => member.id)
      .map((member) => [
        member.id,
        member,
      ])
  );

  const keepIds = new Set();
  const statements = [];

  members.forEach((member, index) => {
    const existing = member.id
      ? existingById.get(member.id)
      : null;

    if (existing) {
      keepIds.add(existing.id);

      statements.push(
        env.DB.prepare(`
          UPDATE guest_members
          SET
            name = ?,
            normalized_name = ?,
            person_type = ?,
            attendance_status = ?,
            is_primary = ?,
            sort_order = ?,
            updated_at = ?,
            deleted_at = NULL
          WHERE
            id = ?
            AND guest_id = ?
            AND event_id = ?
        `).bind(
          member.name,
          normalizeName(member.name),
          member.person_type,
          member.attendance_status,
          index === 0 ? 1 : 0,
          index,
          currentTime,
          existing.id,
          guestId,
          eventId
        )
      );
    } else {
      const id = crypto.randomUUID();

      keepIds.add(id);

      statements.push(
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
            deleted_at,
            attendance_status,
            is_preapproved
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1
          )
        `).bind(
          id,
          guestId,
          eventId,
          member.name,
          normalizeName(member.name),
          member.person_type,
          index === 0 ? 1 : 0,
          index,
          currentTime,
          currentTime,
          member.attendance_status
        )
      );
    }
  });

  for (const existing of existingMembers || []) {
    if (
      existing.id &&
      !keepIds.has(existing.id)
    ) {
      statements.push(
        env.DB.prepare(`
          UPDATE guest_members
          SET
            deleted_at = ?,
            updated_at = ?
          WHERE
            id = ?
            AND guest_id = ?
            AND event_id = ?
            AND deleted_at IS NULL
        `).bind(
          currentTime,
          currentTime,
          existing.id,
          guestId,
          eventId
        )
      );
    }
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }
}

async function bulkCreateGuests(
  env,
  event,
  rows,
  source
) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new HttpError(
      400,
      "Envie pelo menos um convidado para importar."
    );
  }

  if (rows.length > MAX_BULK_GUESTS) {
    throw new HttpError(
      400,
      `Importe no máximo ${MAX_BULK_GUESTS} confirmações por vez.`
    );
  }

  const created = [];
  const failed = [];

  for (
    let index = 0;
    index < rows.length;
    index++
  ) {
    try {
      const guest = await createGuest(
        env,
        event,
        rows[index] || {},
        source
      );

      created.push(guest);
    } catch (error) {
      failed.push({
        index,
        name: String(
          rows[index]?.primary_name || ""
        ).trim(),
        error:
          error instanceof Error
            ? error.message
            : "Falha ao importar.",
      });
    }
  }

  return {
    created,
    failed,
  };
}

async function softDeleteGuest(
  env,
  eventId,
  guestId
) {
  const currentTime = now();

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
    `).bind(
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
    `).bind(
      currentTime,
      currentTime,
      guestId,
      eventId
    ),
  ]);
}

async function restoreGuest(
  env,
  eventId,
  guestId
) {
  const currentTime = now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE guests
      SET
        deleted_at = NULL,
        updated_at = ?
      WHERE
        id = ?
        AND event_id = ?
    `).bind(
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
    `).bind(
      currentTime,
      guestId,
      eventId
    ),
  ]);
}

async function hydrateGuests(
  env,
  rows,
  includeDeleted = false
) {
  if (!rows.length) return [];

  const guestIds = rows.map(
    (row) => row.id
  );

  const placeholders = guestIds
    .map(() => "?")
    .join(",");

  const result = await env.DB.prepare(`
    SELECT *
    FROM guest_members
    WHERE
      guest_id IN (${placeholders})
      ${
        includeDeleted
          ? ""
          : "AND deleted_at IS NULL"
      }
    ORDER BY
      sort_order ASC,
      name COLLATE NOCASE ASC
  `)
    .bind(...guestIds)
    .all();

  const map = new Map();

  for (const member of result.results) {
    if (!map.has(member.guest_id)) {
      map.set(
        member.guest_id,
        []
      );
    }

    map.get(member.guest_id).push(
      serializeMember(member)
    );
  }

  return rows.map((row) =>
    serializeGuestRow(
      row,
      map.get(row.id) || []
    )
  );
}

async function hydrateGuest(env, row) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM guest_members
    WHERE
      guest_id = ?
      AND deleted_at IS NULL
    ORDER BY
      sort_order ASC,
      name COLLATE NOCASE ASC
  `)
    .bind(row.id)
    .all();

  return serializeGuestRow(
    row,
    result.results.map(serializeMember)
  );
}

async function findDuplicateMembers(
  env,
  eventId,
  members,
  excludeGuestId = null
) {
  const normalizedNames = [
    ...new Set(
      (members || [])
        .map((member) =>
          normalizeName(member.name)
        )
        .filter(Boolean)
    ),
  ];

  if (!normalizedNames.length) {
    return [];
  }

  const placeholders = normalizedNames
    .map(() => "?")
    .join(",");

  let sql = `
    SELECT
      gm.name,
      gm.normalized_name,
      gm.guest_id,
      g.primary_name,
      g.group_label
    FROM guest_members gm
   