/**
 * CarePlasma — Website Form Mailer
 * ---------------------------------------------------------------------------
 * A Cloudflare Worker that receives POSTs from the "Get In Touch", "Choose
 * Center", and "Careers" forms on the CarePlasma website and relays each one
 * as an email through the Gmail API — the same OAuth2 pattern used by the
 * sibling bloomsphere-mailer-api / referralform-mailer-api Workers. The
 * Careers form's resume upload is forwarded as a MIME email attachment.
 *
 * Required setup (see README.md for full steps):
 *   - Secrets:  GMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   - Variable: MAIL_TO         (comma-separated recipient address(es))
 *   - Variable: ALLOWED_ORIGIN  (your site's origin, for CORS lock-down)
 * ---------------------------------------------------------------------------
 */

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, message: "Method not allowed." }, 405, corsHeaders);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (err) {
      return jsonResponse({ success: false, message: "Could not read form data." }, 400, corsHeaders);
    }

    // Honeypot: bots fill every field, real users leave this blank.
    const honeypot = (formData.get("_honey") || "").toString().trim();
    if (honeypot) {
      return jsonResponse({ success: true, message: "Thanks!" }, 200, corsHeaders);
    }

    const name = (formData.get("name") || "").toString().trim();
    const email = (formData.get("email") || "").toString().trim();
    const phone = (formData.get("phone") || "").toString().trim();
    const topic = (formData.get("subject") || "").toString().trim(); // user-entered topic, shown in the email body
    const message = (formData.get("message") || "").toString().trim();
    const emailSubject = (formData.get("_subject") || "New contact form submission").toString();
    const fromName = (formData.get("_from_name") || "CarePlasma Website").toString();

    if (!email) {
      return jsonResponse({ success: false, message: "An email address is required." }, 400, corsHeaders);
    }

    const resume = formData.get("resume");
    const hasResume = resume && typeof resume === "object" && typeof resume.arrayBuffer === "function" && resume.size > 0;
    if (hasResume && resume.size > MAX_ATTACHMENT_BYTES) {
      return jsonResponse({ success: false, message: "Resume file is too large (8MB max)." }, 400, corsHeaders);
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN || !env.GMAIL_USER) {
      return jsonResponse(
        { success: false, message: "Server is not configured to send email yet (missing Gmail API credentials)." },
        500,
        corsHeaders
      );
    }
    if (!env.MAIL_TO) {
      return jsonResponse(
        { success: false, message: "Server is not configured with a recipient (missing MAIL_TO)." },
        500,
        corsHeaders
      );
    }

    const htmlBody = `
      <h2>New message from the CarePlasma website</h2>
      <p><strong>Name:</strong> ${escapeHtml(name) || "(not provided)"}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone) || "(not provided)"}</p>
      ${topic ? `<p><strong>Subject:</strong> ${escapeHtml(topic)}</p>` : ""}
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, "<br>") || "(no message)"}</p>
      ${hasResume ? `<p><strong>Attachment:</strong> ${escapeHtml(resume.name || "resume")}</p>` : ""}
    `;

    try {
      const accessToken = await getAccessToken(env);

      const attachment = hasResume
        ? {
            filename: resume.name || "resume",
            contentType: resume.type || "application/octet-stream",
            content: arrayBufferToBase64(await resume.arrayBuffer()),
          }
        : null;

      const raw = buildMimeMessage({
        fromName,
        fromAddress: env.GMAIL_USER,
        to: env.MAIL_TO,
        replyTo: email,
        subject: emailSubject,
        html: htmlBody,
        attachment,
      });

      const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });

      if (!sendResponse.ok) {
        const errText = await sendResponse.text();
        return jsonResponse(
          { success: false, message: "Email provider rejected the message.", detail: errText },
          502,
          corsHeaders
        );
      }

      return jsonResponse({ success: true, message: "Message sent." }, 200, corsHeaders);
    } catch (err) {
      return jsonResponse({ success: false, message: "Unexpected error sending email." }, 500, corsHeaders);
    }
  },
};

async function getAccessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

function buildMimeMessage({ fromName, fromAddress, to, replyTo, subject, html, attachment }) {
  const toList = to.split(",").map((addr) => addr.trim()).filter(Boolean).join(", ");
  const headers =
    `From: ${encodeHeaderValue(fromName)} <${fromAddress}>\r\n` +
    `To: ${toList}\r\n` +
    `Reply-To: ${sanitizeHeader(replyTo)}\r\n` +
    `Subject: ${encodeHeaderValue(subject)}\r\n` +
    `MIME-Version: 1.0\r\n`;

  if (!attachment) {
    const message = `${headers}Content-Type: text/html; charset=UTF-8\r\n\r\n${html}`;
    return base64UrlEncode(message);
  }

  const boundary = "careplasma-" + crypto.randomUUID();
  const message =
    `${headers}Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${html}\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"\r\n` +
    `Content-Disposition: attachment; filename="${attachment.filename}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${wrapBase64(attachment.content)}\r\n` +
    `--${boundary}--`;
  return base64UrlEncode(message);
}

function wrapBase64(base64) {
  return base64.replace(/(.{76})/g, "$1\r\n");
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function jsonResponse(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function sanitizeHeader(str) {
  return String(str).replace(/[\r\n]+/g, " ");
}

// RFC 2047 "encoded word" — header values (Subject, From display name) are
// restricted to ASCII; embedding raw UTF-8 bytes (e.g. an em dash) makes
// Gmail read each byte as Latin-1, producing mojibake like "Ã¢Â€Â”".
function encodeHeaderValue(str) {
  const sanitized = sanitizeHeader(str);
  if (/^[\x00-\x7F]*$/.test(sanitized)) return sanitized;
  const bytes = new TextEncoder().encode(sanitized);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
