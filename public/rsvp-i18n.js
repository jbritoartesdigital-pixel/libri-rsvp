(() => {
  "use strict";

  /*
   * LIBRI RSVP | I18N
   *
   * Camada aditiva de idioma para a página pública.
   *
   * Regras:
   * - eventos existentes continuam em português;
   * - o painel administrativo continua em português;
   * - o idioma escolhido pertence ao evento;
   * - English aplica os textos-base em inglês;
   * - textos personalizados continuam editáveis;
   * - nenhuma migration é necessária.
   *
   * Persistência:
   * o motor atual salva somente as chaves públicas já conhecidas.
   * Para não alterar o Worker principal, o idioma EN é marcado com
   * uma sequência invisível no início de public_texts.eyebrow.
   * Esta camada remove a marca antes de entregar os dados ao app.
   */

  const EN_MARKER =
    "\u2063\u200C\u200C\u2063";

  const PT_DEFAULTS = {
    eyebrow:
      "Confirmação de presença",

    intro:
      "Confirme sua presença para que tudo seja preparado com carinho.",

    lookup_label:
      "Digite seu nome",

    lookup_placeholder:
      "Comece a digitar seu nome",

    yes_button:
      "Sim, estarei presente!",

    no_button:
      "Não poderei comparecer",

    message_label:
      "Deixe uma mensagem carinhosa 💌",

    message_placeholder:
      "Uma mensagem especial para quem está celebrando...",

    success_title:
      "Presença confirmada!",

    success_message:
      "Que bom ter você com a gente. 💛",

    decline_title:
      "Resposta registrada",

    decline_message:
      "Obrigada por avisar.",

    decline_hint:
      "Tudo bem 💛 Se quiser, você ainda pode deixar uma mensagem carinhosa abaixo.",

    name_label:
      "Seu nome",

    calendar_button:
      "Adicionar à agenda",

    location_button:
      "Abrir localização",

    back_button:
      "Voltar ao convite",

    closed_title:
      "Confirmações encerradas",
  };

  const EN_DEFAULTS = {
    eyebrow:
      "RSVP",

    intro:
      "Please confirm your attendance so everything can be prepared with care.",

    lookup_label:
      "Find your name",

    lookup_placeholder:
      "Start typing your name",

    yes_button:
      "Yes, I'll be there!",

    no_button:
      "Unfortunately, I can't attend",

    message_label:
      "Leave a message for the family 💌",

    message_placeholder:
      "Write a special message for the celebration...",

    success_title:
      "RSVP confirmed!",

    success_message:
      "We're so happy you'll be there. 💛",

    decline_title:
      "Response received",

    decline_message:
      "Thank you for letting us know.",

    decline_hint:
      "That's okay 💛 If you'd like, you can still leave a special message below.",

    name_label:
      "Your name",

    calendar_button:
      "Add to calendar",

    location_button:
      "Open location",

    back_button:
      "Back to invitation",

    closed_title:
      "RSVP closed",
  };

  const languageByEventId =
    new Map();

  const languageBySlug =
    new Map();

  const languageByClientToken =
    new Map();

  let currentPublicEvent =
    null;

  let lastSingleAdminEvent =
    null;

  let mutationTimer =
    null;

  const nativeFetch =
    window.fetch.bind(
      window,
    );

  const NativeBlob =
    window.Blob;

  /* ==================================================
     LANGUAGE STORAGE
  ================================================== */

  function cleanEyebrow(
    value = "",
  ) {
    const text =
      String(
        value ?? "",
      );

    return text.startsWith(
      EN_MARKER,
    )
      ? text.slice(
        EN_MARKER.length,
      )
      : text;
  }

  function languageFromTexts(
    texts,
  ) {
    if (
      texts?.language === "en"
    ) {
      return "en";
    }

    const eyebrow =
      String(
        texts?.eyebrow
        ?? "",
      );

    return eyebrow.startsWith(
      EN_MARKER,
    )
      ? "en"
      : "pt";
  }

  function decodeTexts(
    texts,
  ) {
    const source =
      texts
      && typeof texts
        === "object"
        ? texts
        : {};

    const language =
      languageFromTexts(
        source,
      );

    return {
      ...source,

      eyebrow:
        cleanEyebrow(
          source.eyebrow,
        ),

      language,
    };
  }

  function migrateDefaults(
    texts,
    fromLanguage,
    toLanguage,
  ) {
    const source =
      {
        ...(texts || {}),
      };

    const fromDefaults =
      fromLanguage === "en"
        ? EN_DEFAULTS
        : PT_DEFAULTS;

    const toDefaults =
      toLanguage === "en"
        ? EN_DEFAULTS
        : PT_DEFAULTS;

    for (
      const key
      of Object.keys(
        toDefaults,
      )
    ) {
      const current =
        String(
          source[key]
          ?? "",
        ).trim();

      const oldDefault =
        String(
          fromDefaults[key]
          ?? "",
        ).trim();

      if (
        !current
        || current === oldDefault
      ) {
        source[key] =
          toDefaults[key];
      }
    }

    return source;
  }

  function encodeTexts(
    texts,
    language,
    previousLanguage,
  ) {
    const targetLanguage =
      language === "en"
        ? "en"
        : "pt";

    const previous =
      previousLanguage === "en"
        ? "en"
        : "pt";

    let source =
      {
        ...(texts || {}),
      };

    source.eyebrow =
      cleanEyebrow(
        source.eyebrow,
      );

    if (
      targetLanguage
      !== previous
    ) {
      source =
        migrateDefaults(
          source,
          previous,
          targetLanguage,
        );
    }

    if (
      !String(
        source.eyebrow
        ?? "",
      ).trim()
    ) {
      source.eyebrow =
        targetLanguage
          === "en"
          ? EN_DEFAULTS.eyebrow
          : PT_DEFAULTS.eyebrow;
    }

    source.eyebrow =
      targetLanguage === "en"
        ? (
          EN_MARKER
          + cleanEyebrow(
            source.eyebrow,
          )
        )
        : cleanEyebrow(
          source.eyebrow,
        );

    delete source.language;

    return source;
  }

  /* ==================================================
     EVENT MEMORY
  ================================================== */

  function rememberEvent(
    event,
    requestUrl,
  ) {
    if (
      !event
      || typeof event
        !== "object"
    ) {
      return event;
    }

    const publicTexts =
      decodeTexts(
        event.public_texts,
      );

    const language =
      publicTexts.language;

    event.public_texts =
      publicTexts;

    if (event.id) {
      languageByEventId.set(
        String(
          event.id,
        ),
        language,
      );
    }

    if (event.slug) {
      languageBySlug.set(
        String(
          event.slug,
        ),
        language,
      );
    }

    const path =
      requestUrl.pathname;

    const clientMatch =
      path.match(
        /^\/api\/client\/([^/]+)\/event$/,
      );

    if (clientMatch) {
      languageByClientToken.set(
        decodeURIComponent(
          clientMatch[1],
        ),
        language,
      );
    }

    const adminSingleMatch =
      path.match(
        /^\/api\/admin\/events\/([^/]+)$/,
      );

    if (
      adminSingleMatch
      && event.id
    ) {
      lastSingleAdminEvent =
        event;
    }

    const publicMatch =
      path.match(
        /^\/api\/public\/events\/([^/]+)$/,
      );

    if (publicMatch) {
      const currentSlug =
        decodeURIComponent(
          publicMatch[1],
        );

      if (
        event.slug
        === currentSlug
      ) {
        currentPublicEvent =
          event;

        if (
          language === "en"
          && event.closed_reason
        ) {
          event.closed_reason =
            translateMessage(
              event.closed_reason,
            );
        }

        document
          .documentElement
          .setAttribute(
            "lang",
            language === "en"
              ? "en"
              : "pt-BR",
          );
      }
    }

    return event;
  }

  function languageForWrite(
    requestUrl,
    data,
  ) {
    const selector =
      document.querySelector(
        "[data-libri-language]",
      );

    if (
      selector
      && (
        requestUrl.pathname
          .startsWith(
            "/api/admin/events",
          )
      )
    ) {
      return selector.value
        === "en"
        ? "en"
        : "pt";
    }

    if (
      data?.public_texts
        ?.language
        === "en"
    ) {
      return "en";
    }

    const adminMatch =
      requestUrl.pathname
        .match(
          /^\/api\/admin\/events\/([^/]+)$/,
        );

    if (adminMatch) {
      return (
        languageByEventId.get(
          decodeURIComponent(
            adminMatch[1],
          ),
        )
        || "pt"
      );
    }

    const clientMatch =
      requestUrl.pathname
        .match(
          /^\/api\/client\/([^/]+)\/event$/,
        );

    if (clientMatch) {
      return (
        languageByClientToken.get(
          decodeURIComponent(
            clientMatch[1],
          ),
        )
        || "pt"
      );
    }

    return (
      languageFromTexts(
        data?.public_texts,
      )
      || "pt"
    );
  }

  function previousLanguageForWrite(
    requestUrl,
    data,
  ) {
    const adminMatch =
      requestUrl.pathname
        .match(
          /^\/api\/admin\/events\/([^/]+)$/,
        );

    if (adminMatch) {
      return (
        languageByEventId.get(
          decodeURIComponent(
            adminMatch[1],
          ),
        )
        || languageFromTexts(
          data?.public_texts,
        )
        || "pt"
      );
    }

    const clientMatch =
      requestUrl.pathname
        .match(
          /^\/api\/client\/([^/]+)\/event$/,
        );

    if (clientMatch) {
      return (
        languageByClientToken.get(
          decodeURIComponent(
            clientMatch[1],
          ),
        )
        || languageFromTexts(
          data?.public_texts,
        )
        || "pt"
      );
    }

    return (
      languageFromTexts(
        data?.public_texts,
      )
      || "pt"
    );
  }

  /* ==================================================
     FETCH BRIDGE
  ================================================== */

  function isEventWrite(
    requestUrl,
    method,
  ) {
    if (
      ![
        "POST",
        "PATCH",
      ].includes(
        method,
      )
    ) {
      return false;
    }

    return (
      requestUrl.pathname
        === "/api/admin/events"

      || /^\/api\/admin\/events\/[^/]+$/
        .test(
          requestUrl.pathname,
        )

      || /^\/api\/client\/[^/]+\/event$/
        .test(
          requestUrl.pathname,
        )
    );
  }

  function isRelevantJsonRoute(
    requestUrl,
  ) {
    return (
      requestUrl.pathname
        .startsWith(
          "/api/admin/events",
        )

      || requestUrl.pathname
        .startsWith(
          "/api/client/",
        )

      || requestUrl.pathname
        .startsWith(
          "/api/public/events/",
        )
    );
  }

  function processIncomingData(
    data,
    requestUrl,
  ) {
    if (
      !data
      || typeof data
        !== "object"
    ) {
      return data;
    }

    if (data.event) {
      rememberEvent(
        data.event,
        requestUrl,
      );
    }

    if (
      Array.isArray(
        data.events,
      )
    ) {
      data.events.forEach(
        (event) =>
          rememberEvent(
            event,
            requestUrl,
          ),
      );
    }

    if (
      data.error
      && requestUrl.pathname
        .startsWith(
          "/api/public/",
        )
      && currentLanguage()
        === "en"
    ) {
      data.error =
        translateMessage(
          data.error,
        );
    }

    return data;
  }

  window.fetch =
    async function libriFetch(
      input,
      init = {},
    ) {
      const requestUrl =
        new URL(
          input instanceof Request
            ? input.url
            : String(input),
          location.origin,
        );

      const method =
        String(
          init.method
          || (
            input instanceof Request
              ? input.method
              : "GET"
          ),
        ).toUpperCase();

      let nextInit =
        {
          ...init,
        };

      if (
        isEventWrite(
          requestUrl,
          method,
        )
        && typeof nextInit.body
          === "string"
      ) {
        try {
          const data =
            JSON.parse(
              nextInit.body,
            );

          if (
            data
            && typeof data
              === "object"
            && data.public_texts
          ) {
            const selectedLanguage =
              languageForWrite(
                requestUrl,
                data,
              );

            const previousLanguage =
              previousLanguageForWrite(
                requestUrl,
                data,
              );

            data.public_texts =
              encodeTexts(
                data.public_texts,
                selectedLanguage,
                previousLanguage,
              );

            nextInit.body =
              JSON.stringify(
                data,
              );
          }
        } catch {
          /*
           * Corpo não-JSON:
           * deixa o request seguir
           * normalmente.
           */
        }
      }

      const response =
        await nativeFetch(
          input,
          nextInit,
        );

      if (
        !isRelevantJsonRoute(
          requestUrl,
        )
      ) {
        return response;
      }

      const contentType =
        response.headers
          .get(
            "content-type",
          )
        || "";

      if (
        !contentType.includes(
          "application/json",
        )
      ) {
        return response;
      }

      let data;

      try {
        data =
          await response
            .clone()
            .json();
      } catch {
        return response;
      }

      const processed =
        processIncomingData(
          data,
          requestUrl,
        );

      return new Response(
        JSON.stringify(
          processed,
        ),
        {
          status:
            response.status,

          statusText:
            response.statusText,

          headers:
            new Headers(
              response.headers,
            ),
        },
      );
    };

  /* ==================================================
     ENGLISH UI
  ================================================== */

  function currentLanguage() {
    if (
      currentPublicEvent
        ?.public_texts
        ?.language
        === "en"
    ) {
      return "en";
    }

    const publicMatch =
      location.pathname
        .match(
          /^\/e\/([^/]+)/,
        );

    if (publicMatch) {
      return (
        languageBySlug.get(
          decodeURIComponent(
            publicMatch[1],
          ),
        )
        || "pt"
      );
    }

    return "pt";
  }

  const exactTranslations =
    new Map([
      [
        "Confirmação de presença",
        "RSVP",
      ],

      [
        "Confirme sua presença para que tudo seja preparado com carinho.",
        "Please confirm your attendance so everything can be prepared with care.",
      ],

      [
        "Digite seu nome",
        "Find your name",
      ],

      [
        "Comece a digitar seu nome",
        "Start typing your name",
      ],

      [
        "Sim, estarei presente!",
        "Yes, I'll be there!",
      ],

      [
        "Não poderei comparecer",
        "Unfortunately, I can't attend",
      ],

      [
        "Deixe uma mensagem carinhosa 💌",
        "Leave a message for the family 💌",
      ],

      [
        "Uma mensagem especial para quem está celebrando...",
        "Write a special message for the celebration...",
      ],

      [
        "Presença confirmada!",
        "RSVP confirmed!",
      ],

      [
        "Que bom ter você com a gente. 💛",
        "We're so happy you'll be there. 💛",
      ],

      [
        "Resposta registrada",
        "Response received",
      ],

      [
        "Obrigada por avisar.",
        "Thank you for letting us know.",
      ],

      [
        "Tudo bem 💛 Se quiser, você ainda pode deixar uma mensagem carinhosa abaixo.",
        "That's okay 💛 If you'd like, you can still leave a special message below.",
      ],

      [
        "Seu nome",
        "Your name",
      ],

      [
        "Adicionar à agenda",
        "Add to calendar",
      ],

      [
        "Abrir localização",
        "Open location",
      ],

      [
        "Voltar ao convite",
        "Back to invitation",
      ],

      [
        "Confirmações encerradas",
        "RSVP closed",
      ],

      [
        "Digite pelo menos 2 letras. As sugestões aparecem abreviadas para proteger a lista.",
        "Type at least 2 letters. Suggestions are abbreviated to protect the guest list.",
      ],

      [
        "Toque para abrir sua confirmação",
        "Tap to open your RSVP",
      ],

      [
        "Nenhuma sugestão encontrada.",
        "No matching guest found.",
      ],

      [
        "Marque individualmente quem poderá comparecer.",
        "Select each person who will attend.",
      ],

      [
        "Adicionar alguém",
        "Add someone",
      ],

      [
        "Quem irá?",
        "Who will attend?",
      ],

      [
        "Adulto",
        "Adult",
      ],

      [
        "Criança",
        "Child",
      ],

      [
        "✓ Vai",
        "✓ Going",
      ],

      [
        "Vai",
        "Going",
      ],

      [
        "Não vai",
        "Not going",
      ],

      [
        "+ Adulto",
        "+ Adult",
      ],

      [
        "+ Criança",
        "+ Child",
      ],

      [
        "Telefone",
        "Phone",
      ],

      [
        "Restrição alimentar",
        "Dietary restrictions",
      ],

      [
        "Observações",
        "Notes",
      ],

      [
        "Enviar confirmação",
        "Submit RSVP",
      ],

      [
        "← Procurar outro nome",
        "← Find another name",
      ],

      [
        "Nome",
        "Name",
      ],

      [
        "Você",
        "You",
      ],

      [
        "Pessoa responsável",
        "Primary guest",
      ],

      [
        "Google Agenda",
        "Google Calendar",
      ],

      [
        "Apple / iPhone / outros",
        "Apple / iPhone / others",
      ],

      [
        "Escolha onde deseja salvar este evento.",
        "Choose where you want to save this event.",
      ],

      [
        "Convite indisponível",
        "Invitation unavailable",
      ],

      [
        "Data não informada",
        "Date not provided",
      ],

      [
        "O período de confirmação foi encerrado.",
        "The RSVP period has ended.",
      ],

      [
        "Este evento ainda não tem data configurada.",
        "This event does not have a date yet.",
      ],

      [
        "Não foi possível concluir.",
        "Could not complete the request.",
      ],

      [
        "Marque quem vai ou não vai.",
        "Please select who will or will not attend.",
      ],

      [
        "Escolha se você poderá comparecer.",
        "Please choose whether you will attend.",
      ],

      [
        "Informe pelo menos uma pessoa.",
        "Please add at least one person.",
      ],
    ]);

  function translateMessage(
    value,
  ) {
    const text =
      String(
        value ?? "",
      ).trim();

    if (!text) {
      return text;
    }

    if (
      exactTranslations.has(
        text,
      )
    ) {
      return exactTranslations.get(
        text,
      );
    }

    const serverExact =
      {
        "Esta confirmação não está disponível.":
          "This RSVP is not available.",

        "Evento indisponível.":
          "This event is unavailable.",

        "As confirmações deste evento estão encerradas.":
          "RSVPs for this event are closed.",

        "As confirmações estão temporariamente pausadas.":
          "RSVPs are temporarily paused.",

        "O prazo para confirmação de presença foi encerrado.":
          "The RSVP deadline has passed.",

        "Este evento não utiliza lista pré-cadastrada.":
          "This event does not use a pre-approved guest list.",

        "Digite seu nome.":
          "Enter your name.",

        "Não encontramos esse nome na lista. Confira a escrita ou fale com o anfitrião.":
          "We couldn't find that name on the guest list. Check the spelling or contact the host.",

        "Localize seu nome na lista antes de confirmar.":
          "Find your name on the guest list before submitting your RSVP.",

        "Convidado não encontrado neste evento.":
          "Guest not found for this event.",

        "Pessoas pré-cadastradas não podem ser removidas pelo convite.":
          "Pre-approved guests cannot be removed from this RSVP.",

        "Este convite permite confirmar apenas as pessoas já cadastradas.":
          "This RSVP only allows confirmation for pre-approved guests.",

        "Informe seu nome.":
          "Enter your name.",

        "Informe pelo menos uma pessoa que irá à festa.":
          "Add at least one person who will attend.",

        "Escolha se poderá comparecer.":
          "Choose whether you will attend.",
      };

    if (
      serverExact[text]
    ) {
      return serverExact[text];
    }

    let match =
      text.match(
        /^Limite de (\d+) pessoa\(s\)\.$/,
      );

    if (match) {
      return `Limit of ${match[1]} guest(s).`;
    }

    match =
      text.match(
        /^Esta confirmação permite no máximo (\d+) pessoa\(s\) presentes\.$/,
      );

    if (match) {
      return `This RSVP allows up to ${match[1]} guest(s) attending.`;
    }

    match =
      text.match(
        /^Esta confirmação permite no máximo (\d+) pessoa\(s\)\.$/,
      );

    if (match) {
      return `This RSVP allows up to ${match[1]} guest(s).`;
    }

    match =
      text.match(
        /^(.+) já está nesta confirmação\.$/,
      );

    if (match) {
      return `${match[1]} is already included in this RSVP.`;
    }

    match =
      text.match(
        /^(.+) já consta em outra confirmação deste evento\.$/,
      );

    if (match) {
      return `${match[1]} is already included in another RSVP for this event.`;
    }

    match =
      text.match(
        /^Marque individualmente quem poderá comparecer\. Até (\d+) pessoa\(s\) presentes\.$/,
      );

    if (match) {
      return `Select each person who will attend. Up to ${match[1]} guest(s) may attend.`;
    }

    return text;
  }

  function isProtectedDynamicNode(
    node,
  ) {
    const parent =
      node.parentElement;

    if (!parent) {
      return false;
    }

    return Boolean(
      parent.closest(
        [
          ".public-person-name",
          ".public-family-title",
          ".public-search-result strong",
          ".public-card > h1",
          ".success-event-summary span",
        ].join(","),
      ),
    );
  }

  function translateTextNode(
    node,
  ) {
    if (
      !node
      || node.nodeType
        !== Node.TEXT_NODE
      || isProtectedDynamicNode(
        node,
      )
    ) {
      return;
    }

    const raw =
      node.nodeValue
      || "";

    const trimmed =
      raw.trim();

    if (!trimmed) {
      return;
    }

    const translated =
      translateMessage(
        trimmed,
      );

    if (
      translated
      === trimmed
    ) {
      return;
    }

    const leading =
      raw.match(
        /^\s*/,
      )?.[0]
      || "";

    const trailing =
      raw.match(
        /\s*$/,
      )?.[0]
      || "";

    node.nodeValue =
      `${leading}${translated}${trailing}`;
  }

  function translateAttributes(
    root,
  ) {
    root
      .querySelectorAll(
        "[placeholder]",
      )
      .forEach(
        (element) => {
          const current =
            element.getAttribute(
              "placeholder",
            );

          const translated =
            translateMessage(
              current,
            );

          if (
            translated
            !== current
          ) {
            element.setAttribute(
              "placeholder",
              translated,
            );
          }
        },
      );

    root
      .querySelectorAll(
        "[title]",
      )
      .forEach(
        (element) => {
          const current =
            element.getAttribute(
              "title",
            );

          const translated =
            translateMessage(
              current,
            );

          if (
            translated
            !== current
          ) {
            element.setAttribute(
              "title",
              translated,
            );
          }
        },
      );
  }

  function formatDateEn(
    value,
  ) {
    if (!value) {
      return "Date not provided";
    }

    try {
      return new Intl
        .DateTimeFormat(
          "en-US",
          {
            dateStyle:
              "medium",
          },
        )
        .format(
          new Date(
            `${value}T12:00:00`,
          ),
        );
    } catch {
      return String(
        value,
      );
    }
  }

  function formatTimeEn(
    value,
  ) {
    if (!value) {
      return "";
    }

    const match =
      String(
        value,
      ).match(
        /^(\d{1,2}):(\d{2})$/,
      );

    if (!match) {
      return String(
        value,
      );
    }

    const date =
      new Date(
        2000,
        0,
        1,
        Number(
          match[1],
        ),
        Number(
          match[2],
        ),
      );

    return new Intl
      .DateTimeFormat(
        "en-US",
        {
          hour:
            "numeric",

          minute:
            "2-digit",
        },
      )
      .format(
        date,
      );
  }

  function applyEnglishDates() {
    const event =
      currentPublicEvent;

    if (!event) {
      return;
    }

    const dateElement =
      document.querySelector(
        ".public-card > .date",
      );

    if (dateElement) {
      dateElement.textContent =
        (
          formatDateEn(
            event.event_date,
          )

          + (
            event.event_time
              ? ` • ${formatTimeEn(
                event.event_time,
              )}`
              : ""
          )
        );
    }

    if (
      event.rsvp_deadline
    ) {
      document
        .querySelectorAll(
          ".public-card > .chip",
        )
        .forEach(
          (chip) => {
            if (
              chip.textContent
                .includes(
                  "Confirme até",
                )
              || chip.textContent
                .includes(
                  "RSVP by",
                )
            ) {
              chip.textContent =
                `RSVP by ${formatDateEn(
                  event.rsvp_deadline,
                )}`;
            }
          },
        );
    }

    const successDate =
      document.querySelector(
        ".success-event-summary strong",
      );

    if (
      successDate
      && event.event_date
    ) {
      successDate.textContent =
        (
          formatDateEn(
            event.event_date,
          )

          + (
            event.event_time
              ? ` • ${formatTimeEn(
                event.event_time,
              )}`
              : ""
          )
        );
    }
  }

  function rewriteGoogleCalendarLink() {
    const event =
      currentPublicEvent;

    if (!event) {
      return;
    }

    document
      .querySelectorAll(
        'a[href*="calendar.google.com/calendar/render"]',
      )
      .forEach(
        (link) => {
          try {
            const url =
              new URL(
                link.href,
              );

            const bits = [
              "Event added by Libri RSVP.",
            ];

            const invitationUrl =
              event
                .appearance_settings
                ?.invitation_url;

            if (invitationUrl) {
              bits.push(
                `Invitation: ${invitationUrl}`,
              );
            }

            url.searchParams.set(
              "details",
              bits.join(
                "\n",
              ),
            );

            link.href =
              url.toString();
          } catch {
            /*
             * Mantém o link original
             * em caso de URL inesperada.
             */
          }
        },
      );
  }

  function translatePublicUi() {
    if (
      !location.pathname
        .startsWith(
          "/e/",
        )
      || currentLanguage()
        !== "en"
    ) {
      return;
    }

    document
      .documentElement
      .setAttribute(
        "lang",
        "en",
      );

    document.title =
      "Libri RSVP | RSVP";

    const roots = [
      document.querySelector(
        ".public-page",
      ),

      document.querySelector(
        "#toast",
      ),

      ...document
        .querySelectorAll(
          ".modal-backdrop",
        ),
    ].filter(Boolean);

    for (
      const root
      of roots
    ) {
      const walker =
        document
          .createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
          );

      let node =
        walker.nextNode();

      while (node) {
        translateTextNode(
          node,
        );

        node =
          walker.nextNode();
      }

      translateAttributes(
        root,
      );
    }

    applyEnglishDates();
    rewriteGoogleCalendarLink();
  }

  /* ==================================================
     ADMIN LANGUAGE SELECTOR
  ================================================== */

  function currentAdminEventLanguage() {
    return (
      lastSingleAdminEvent
        ?.public_texts
        ?.language
      === "en"
        ? "en"
        : "pt"
    );
  }

  function enhanceEventForm() {
    if (
      !location.pathname
        .startsWith(
          "/admin",
        )
    ) {
      return;
    }

    const form =
      document.querySelector(
        "#eventForm",
      );

    if (
      !form
      || form.querySelector(
        "[data-libri-language]",
      )
    ) {
      return;
    }

    const modalTitle =
      form.closest(
        ".modal",
      )
        ?.querySelector(
          "h2",
        )
        ?.textContent
        ?.trim()
      || "";

    const isNew =
      modalTitle
      === "Novo evento";

    const language =
      isNew
        ? "pt"
        : currentAdminEventLanguage();

    const field =
      document.createElement(
        "div",
      );

    field.className =
      "field libri-language-field";

    field.innerHTML = `
      <label for="libriRsvpLanguage">
        Idioma da RSVP
      </label>

      <select
        id="libriRsvpLanguage"
        data-libri-language
      >
        <option value="pt">
          Português
        </option>

        <option value="en">
          English
        </option>
      </select>

      <small>
        Define o idioma da página pública.
        O painel administrativo continua em português.
      </small>
    `;

    const select =
      field.querySelector(
        "select",
      );

    select.value =
      language;

    const firstSection =
      form.querySelector(
        ".form-section",
      );

    const nameField =
      firstSection
        ?.querySelector(
          ".field",
        );

    if (nameField) {
      nameField.insertAdjacentElement(
        "afterend",
        field,
      );
    } else {
      form.prepend(
        field,
      );
    }
  }

  function enhanceAdminSettingsLanguage() {
    if (
      !location.pathname
        .startsWith(
          "/admin",
        )
      || !lastSingleAdminEvent
    ) {
      return;
    }

    const settingsList =
      document.querySelector(
        "#tabRoot .settings-list",
      );

    if (
      !settingsList
      || settingsList.querySelector(
        "[data-libri-language-setting]",
      )
    ) {
      return;
    }

    const card =
      document.createElement(
        "div",
      );

    card.className =
      "setting-card";

    card.dataset
      .libriLanguageSetting =
        "true";

    card.innerHTML = `
      <div>
        <h4>
          Idioma da RSVP
        </h4>

        <p>
          ${
            currentAdminEventLanguage()
              === "en"
              ? "English"
              : "Português"
          }
        </p>
      </div>
    `;

    settingsList.appendChild(
      card,
    );
  }

  /* ==================================================
     CALENDAR FILE
  ================================================== */

  function LibriBlob(
    parts,
    options,
  ) {
    let nextParts =
      parts;

    if (
      currentLanguage()
        === "en"
      && String(
        options?.type
        || "",
      ).toLowerCase()
        .startsWith(
          "text/calendar",
        )
      && Array.isArray(
        parts,
      )
    ) {
      nextParts =
        parts.map(
          (part) => {
            if (
              typeof part
              !== "string"
            ) {
              return part;
            }

            return part
              .replace(
                "PRODID:-//Libri Convites//Libri RSVP//PT-BR",
                "PRODID:-//Libri Convites//Libri RSVP//EN",
              )
              .replace(
                "Evento adicionado pelo Libri RSVP.",
                "Event added by Libri RSVP.",
              )
              .replace(
                /Convite:/g,
                "Invitation:",
              );
          },
        );
    }

    return new NativeBlob(
      nextParts,
      options,
    );
  }

  LibriBlob.prototype =
    NativeBlob.prototype;

  Object.setPrototypeOf(
    LibriBlob,
    NativeBlob,
  );

  window.Blob =
    LibriBlob;

  /* ==================================================
     OBSERVER
  ================================================== */

  function refreshEnhancements() {
    clearTimeout(
      mutationTimer,
    );

    mutationTimer =
      setTimeout(
        () => {
          enhanceEventForm();
          enhanceAdminSettingsLanguage();
          translatePublicUi();
        },
        40,
      );
  }

  const observer =
    new MutationObserver(
      refreshEnhancements,
    );

  observer.observe(
    document.documentElement,
    {
      childList:
        true,

      subtree:
        true,

      characterData:
        true,
    },
  );

  refreshEnhancements();
})();
