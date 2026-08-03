# Referral Form Mailer.

A Cloudflare Worker that receives the "New Patient Form" submission from the
[ReferralForm](https://github.com/venkatrx1/ReferralForm) GitHub Pages site and
relays it by email through the practice's own Gmail mailbox — replacing the
previous third-party relay (formsubmit.co).

## How it works

- The static form POSTs as `multipart/form-data` to this Worker's URL.
- The Worker checks the request `Origin`, checks a honeypot field, builds an
  HTML table from the submitted fields, and sends it via Gmail's SMTP server
  (`smtp.gmail.com:465`) using `nodemailer`, authenticated with a Gmail App
  Password.
- No third party other than Cloudflare (runs the code) and Google (the
  mailbox you already use) ever sees the form contents.

## Prerequisites

- Node.js and npm
- A Cloudflare account (free tier is sufficient)
- 2-Step Verification enabled on the sending Gmail account, so you can create
  an App Password

## Setup

1. `npm install`
2. Create a Gmail App Password: Google Account → Security → 2-Step
   Verification (enable if needed) → App passwords → create one (e.g. name it
   "Referral Form Mailer") → copy the 16-character password.
3. `npx wrangler login` — authenticates the CLI with your Cloudflare account.
4. `npx wrangler secret put GMAIL_USER` — paste the sending Gmail address.
5. `npx wrangler secret put GMAIL_APP_PASSWORD` — paste the App Password from
   step 2.
6. Edit [wrangler.toml](wrangler.toml):
   - `ALLOWED_ORIGIN` — the GitHub Pages origin allowed to call this Worker
     (e.g. `https://venkatrx1.github.io`).
   - `MAIL_TO` — comma-separated recipient address(es). Can include the
     sending address itself plus any other recipients.
7. `npx wrangler deploy` — deploys the Worker and prints its live URL.
8. Paste that URL into `FORM_ENDPOINT` near the top of `script.js` in the
   ReferralForm project, then commit and push.

## Local development

- `npx wrangler dev` — runs the Worker locally for iteration.
- `npx wrangler tail` — streams live logs from the deployed Worker; run this
  while submitting a real form to debug failures.

## Configuration reference

| Name                 | Type   | Set via                    | Purpose                                              |
| -------------------- | ------ | --------------------------- | ----------------------------------------------------- |
| `ALLOWED_ORIGIN`     | var    | `wrangler.toml`             | Origin allowed to call the Worker (CORS + basic check) |
| `MAIL_TO`            | var    | `wrangler.toml`             | Comma-separated recipient address(es)                 |
| `GMAIL_USER`         | secret | `wrangler secret put`       | Gmail address used as SMTP login and `From` address   |
| `GMAIL_APP_PASSWORD` | secret | `wrangler secret put`       | Gmail App Password (requires 2-Step Verification)     |

Secrets are stored encrypted by Cloudflare and never appear in source control.

## Security notes

- The `Origin` check blocks ordinary cross-site browser calls but is **not** a
  strong access control — a non-browser client could spoof the header. If the
  endpoint attracts spam or abuse once its URL is visible in the public form's
  JS, add [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)
  to the form and verify it server-side here.
- The honeypot field (`_honey`) silently no-ops the request when filled, to
  deter simple bots without tipping them off.
- This setup removes formsubmit.co from the data path, but Google itself is
  not BAA-covered on a free/personal Gmail account. If the form collects data
  that counts as PHI under HIPAA, a Google Workspace account with a signed BAA
  is required for full compliance — confirm with whoever owns that risk for
  the practice.
