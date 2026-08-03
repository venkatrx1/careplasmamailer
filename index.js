/**
 * CarePlasma — Website Form Mailer
 * ---------------------------------------------------------------------------
 * A small Cloudflare Worker that receives POSTs from the "Get In Touch",
 * "Choose Center", and "Careers" forms on the CarePlasma website and relays
 * each one as an email to TO_EMAIL — no third-party form SaaS, no server to
 * maintain. The Careers form may also include a resume file, which is
 * forwarded as an email attachment.
 *
 * Required setup (see README.md for full steps):
 *   - Secret:      RESEND_API_KEY   (from https://resend.com — free tier)
 *   - Variable:    TO_EMAIL         (comma-separated list of inboxes to receive submissions)
 *   - Variable:    FROM_EMAIL       (optional; defaults to onboarding@resend.dev
 *                                    until you verify your own domain in Resend)
 *   - Variable:    ALLOWED_ORIGIN   (your site's origin, for CORS lock-down)
 * ---------------------------------------------------------------------------
 */

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB — comfortably under Resend's request size limit

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    };

    // Preflight
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

    // Honeypot: matches Website A's convention exactly. Bots that fill in
    // every field will populate this hidden field; humans never see it.
    const honeypot = (formData.get("_honey") || "").toString().trim();
    if (honeypot) {
      // Pretend success so the bot doesn't learn anything, but don't send an email.
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

    if (!env.RESEND_API_KEY) {
      return jsonResponse(
        { success: false, message: "Server is not configured to send email yet (missing RESEND_API_KEY)." },
        500,
        corsHeaders
      );
    }
    if (!env.TO_EMAIL) {
      return jsonResponse(
        { success: false, message: "Server is not configured with a recipient (missing TO_EMAIL)." },
        500,
        corsHeaders
      );
    }

    const fromAddress = env.FROM_EMAIL || "onboarding@resend.dev";
    const toAddresses = env.TO_EMAIL.split(",").map((addr) => addr.trim()).filter(Boolean);

    const attachments = [];
    if (hasResume) {
      attachments.push({
        filename: resume.name || "resume",
        content: arrayBufferToBase64(await resume.arrayBuffer()),
      });
    }

    const htmlBody = `
      <h2>New message from the CarePlasma website</h2>
      <p><strong>Name:</strong> ${escapeHtml(name) || "(not provided)"}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone) || "(not provided)"}</p>
      ${topic ? `<p><strong>Subject:</strong> ${escapeHtml(topic)}</p>` : ""}
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, "<br>") || "(no message)"}</p>
      ${hasResume ? `<p><strong>Attachment:</strong> ${escapeHtml(attachments[0].filename)}</p>` : ""}
    `;

    try {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName} <${fromAddress}>`,
          to: toAddresses,
          reply_to: email,
          subject: emailSubject,
          html: htmlBody,
          ...(attachments.length ? { attachments } : {}),
        }),
      });

      if (!resendResponse.ok) {
        const errText = await resendResponse.text();
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

function jsonResponse(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
