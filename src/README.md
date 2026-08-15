# Libri RSVP

MVP de confirmação de presença para Cloudflare Workers + D1.

## O que já existe

- Área Libri com login por senha administrativa.
- Criação de eventos.
- Dois modos: confirmação livre e lista pré-cadastrada.
- Link público por evento (`/e/slug`).
- Link privado da cliente (`/cliente/token`).
- Cliente pode adicionar, editar e excluir convidados do próprio evento.
- Histórico de alterações no banco (`audit_log`).
- Exportação CSV.
- Campos opcionais por evento.
- Personalização de cores, mensagem e imagem de fundo.
- Turnstile opcional.
- Deteção simples de duplicidade por nome no modo livre.

## Primeira publicação

1. Instale dependências:
   `npm install`

2. Entre no Cloudflare pelo Wrangler:
   `npx wrangler login`

3. Crie o banco:
   `npx wrangler d1 create libri-rsvp-db`

4. Copie o `database_id` retornado para `wrangler.jsonc`.

5. Aplique a migration:
   `npm run db:migrate:remote`

6. Crie os secrets:
   `npx wrangler secret put ADMIN_PASSWORD`
   `npx wrangler secret put SESSION_SECRET`

   Para SESSION_SECRET use uma string aleatória longa. Exemplo local para gerar uma:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

7. Publique:
   `npm run deploy`

8. Abra `/admin` no endereço do Worker.

## Turnstile (opcional, recomendado antes de abrir ao público)

Configure no Worker:
- `TURNSTILE_SITEKEY` como variável não secreta.
- `TURNSTILE_SECRET` como secret.

Sem `TURNSTILE_SECRET`, o MVP aceita confirmações sem desafio anti-bot para facilitar o primeiro teste.

## Domínio

Depois que o MVP estiver validado no `workers.dev`, adicione um Custom Domain ao Worker, por exemplo `confirmacao.seudominio.com`.
