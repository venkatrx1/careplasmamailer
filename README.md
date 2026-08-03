# CarePlasma Mailer

A Cloudflare Worker that receives the "Get In Touch," "Choose Center," and
"Careers" form submissions from the [careplasma](https://github.com/venkatrx1/careplasma)
website and relays each one as an email via [Resend](https://resend.com) — no
third-party form SaaS, no server to maintain. The Careers form's resume
upload is forwarded as an email attachment.

This project is deployed as a Cloudflare Pages project
(`careplasmamailer.pages.dev`) using `_worker.js` at the repo root, which
Cloudflare Pages runs in place of its usual static-asset serving ("Advanced
Mode"). `_worker.js` just re-exports the handler in `index.js`, so the same
code also works with a plain `wrangler deploy` Workers deployment.

## How it works

- Each form POSTs as `multipart/form-data` to this project's URL.
- The Worker checks a honeypot field, reads the standard fields (`name`,
  `email`, `phone`, `subject`, `message`) plus an optional `resume` file, and
  relays it as an HTML email through the Resend API.

## Setup

1. `npm install`
2. Create a Resend account and API key (free tier is sufficient).
3. Configure environment variables — **where** depends on how this project is
   deployed:
   - **Cloudflare Pages via Git integration** (the current setup): set these
     in the Pages project's dashboard under Settings → Environment variables.
     `wrangler.toml` is not read in this flow.
   - **`wrangler deploy` / `wrangler pages deploy`**: `TO_EMAIL`,
     `FROM_EMAIL`, and `ALLOWED_ORIGIN` can stay in [wrangler.toml](wrangler.toml);
     set the secret with `npx wrangler secret put RESEND_API_KEY`.

   | Name              | Type   | Purpose                                                  |
   | ----------------- | ------ | --------------------------------------------------------- |
   | `RESEND_API_KEY`  | secret | Resend API key                                             |
   | `TO_EMAIL`        | var    | Comma-separated recipient address(es)                      |
   | `FROM_EMAIL`      | var    | Optional; defaults to `onboarding@resend.dev` until you verify your own sending domain in Resend |
   | `ALLOWED_ORIGIN`  | var    | Your site's origin, for CORS lock-down (`*` allows any origin) |

4. Deploy — either push to the branch connected to the Cloudflare Pages
   project, or run `npx wrangler deploy` for a plain Workers deployment.

## Local development

- `npx wrangler dev` — runs the Worker locally for iteration.
- `npx wrangler tail` — streams live logs from the deployed Worker; run this
  while submitting a real form to debug failures.

## Security notes

- The honeypot field (`_honey`) silently no-ops the request when filled, to
  deter simple bots without tipping them off.
- `ALLOWED_ORIGIN` is set to `*` by default. Lock it down to the site's real
  origin once everything is verified working, to reduce the chance of the
  endpoint being used to relay spam from other sites.
