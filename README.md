# CarePlasma Mailer

A Cloudflare Worker that receives the "Get In Touch," "Choose Center," and
"Careers" form submissions from the [careplasma](https://github.com/venkatrx1/careplasma)
website and relays each one by email through the Gmail API — the same OAuth2
pattern used by the sibling `bloomsphere-mailer-api` / `referralform-mailer-api`
Workers. The Careers form's resume upload is forwarded as a MIME email
attachment.

Deployed at `https://careplasma-mailer-api.venkatrx1.workers.dev` via
`wrangler deploy` (a plain Cloudflare Worker, not Cloudflare Pages).

## How it works

- Each form POSTs as `multipart/form-data` to this Worker's URL.
- The Worker checks a honeypot field, reads the standard fields (`name`,
  `email`, `phone`, `subject`, `message`) plus an optional `resume` file, and
  sends it through the Gmail API (`gmail.googleapis.com`), authenticated with
  an OAuth2 refresh token (no passwords, no third-party relay).

## Prerequisites

- Node.js and npm
- A Cloudflare account (free tier is sufficient)
- A Google Cloud project with the Gmail API enabled, and OAuth2 credentials
  (client ID/secret) with a refresh token authorized for
  `https://www.googleapis.com/auth/gmail.send` on the sending Gmail account.
  If you already set this up for `bloomsphere-mailer-api` or
  `referralform-mailer-api`, the same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
  (and `GOOGLE_REFRESH_TOKEN`/`GMAIL_USER`, if sending from the same mailbox)
  can be reused here — no need to redo the OAuth consent flow.

## Setup

1. `npm install`
2. `npx wrangler login` — authenticates the CLI with your Cloudflare account.
3. Set the required secrets:
   - `npx wrangler secret put GMAIL_USER` — the sending Gmail address.
   - `npx wrangler secret put GOOGLE_CLIENT_ID`
   - `npx wrangler secret put GOOGLE_CLIENT_SECRET`
   - `npx wrangler secret put GOOGLE_REFRESH_TOKEN`
4. Edit [wrangler.toml](wrangler.toml) if needed:
   - `ALLOWED_ORIGIN` — the site origin allowed to call this Worker.
   - `MAIL_TO` — comma-separated recipient address(es).
5. `npx wrangler deploy` — deploys the Worker and prints its live URL.

## Local development

- `npx wrangler dev` — runs the Worker locally for iteration.
- `npx wrangler tail` — streams live logs from the deployed Worker; run this
  while submitting a real form to debug failures.

## Frontend integration

Each form POSTs as `multipart/form-data` to this Worker's URL. Recognized
fields:

| Field         | Purpose                                                        |
| ------------- | --------------------------------------------------------------- |
| `name`        | Sender's name, included in the email body                       |
| `email`       | Sender's email, used as `Reply-To` and included in the body      |
| `phone`       | Sender's phone, included in the email body                       |
| `subject`     | User-entered topic (Get In Touch form only), shown in the body   |
| `message`     | Message body                                                     |
| `resume`      | Optional file (Careers form) — forwarded as an email attachment, 8MB max |
| `_subject`    | Email `Subject` header (defaults to "New contact form submission") |
| `_from_name`  | Display name used in the `From` header (defaults to "CarePlasma Website") |
| `_honey`      | Honeypot — must stay empty; leave the input hidden via CSS       |

## Configuration reference

| Name                    | Type   | Set via                | Purpose                                              |
| ----------------------- | ------ | ------------------------ | ----------------------------------------------------- |
| `ALLOWED_ORIGIN`        | var    | `wrangler.toml`          | Origin allowed to call the Worker (CORS lock-down)     |
| `MAIL_TO`               | var    | `wrangler.toml`          | Comma-separated recipient address(es)                  |
| `GMAIL_USER`            | secret | `wrangler secret put`    | Gmail address used as sender identity (`From`)         |
| `GOOGLE_CLIENT_ID`      | secret | `wrangler secret put`    | OAuth2 client ID for the Gmail API                     |
| `GOOGLE_CLIENT_SECRET`  | secret | `wrangler secret put`    | OAuth2 client secret for the Gmail API                 |
| `GOOGLE_REFRESH_TOKEN`  | secret | `wrangler secret put`    | OAuth2 refresh token used to mint access tokens         |

Secrets are stored encrypted by Cloudflare and never appear in source control.

## Testing

1. `npx wrangler dev` to run locally, or deploy and use the live URL.
2. Submit one of the CarePlasma site's forms, or `curl`/Postman a
   `multipart/form-data` POST with a few fields, to the Worker URL.
3. Confirm the JSON response is `{"success": true, "message": "Message sent."}`.
4. Confirm an email arrives at each `MAIL_TO` address with the submitted
   fields, and with the resume attached if the Careers form was used.
5. Run `npx wrangler tail` while testing to see logs and catch any Gmail API
   or token-refresh errors immediately.

## Security notes

- The honeypot field (`_honey`) silently no-ops the request when filled, to
  deter simple bots without tipping them off.
- `ALLOWED_ORIGIN` is set to `*` by default. Lock it down to the site's real
  origin once everything is verified working, to reduce the chance of the
  endpoint being used to relay spam from other sites.
