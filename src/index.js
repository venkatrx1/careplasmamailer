export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, corsHeaders, 405);
    }

    if (env.ALLOWED_ORIGIN !== '*' && request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
      return json({ ok: false, error: 'Forbidden' }, corsHeaders, 403);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return json({ ok: false, error: 'Invalid form submission' }, corsHeaders, 400);
    }

    // Honeypot: bots fill every field, real users leave this blank.
    if (formData.get('_honey')) {
      return json({ ok: true }, corsHeaders);
    }

    const subject = formData.get('_subject') || 'Referral form received';
    const fromName = formData.get('_from_name') || 'Referral Form';
    const rows = [];
    for (const [key, value] of formData.entries()) {
      if (key === '_honey' || key === '_subject' || key === '_from_name' || !value) continue;
      rows.push(
        `<tr><td style="padding:4px 8px;font-weight:bold;">${escapeHtml(key)}</td>` +
        `<td style="padding:4px 8px;">${escapeHtml(String(value))}</td></tr>`
      );
    }
    const html = `<table>${rows.join('')}</table>`;

    try {
      await sendMail(env, { subject, fromName, html });
      return json({ ok: true }, corsHeaders);
    } catch (err) {
      console.error('Send failed:', err);
      return json({ ok: false, error: 'Send failed' }, corsHeaders, 500);
    }
  },
};

async function getAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function sendMail(env, { subject, fromName, html }) {
  const accessToken = await getAccessToken(env);

  const message =
    `From: ${sanitizeHeader(fromName)} <${env.GMAIL_USER}>\r\n` +
    `To: ${env.MAIL_TO}\r\n` +
    `Subject: ${sanitizeHeader(subject)}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    html;

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: base64UrlEncode(message) }),
  });

  if (!res.ok) {
    throw new Error(`Gmail API send failed (${res.status}): ${await res.text()}`);
  }
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function sanitizeHeader(str) {
  return String(str).replace(/[\r\n]+/g, ' ');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
