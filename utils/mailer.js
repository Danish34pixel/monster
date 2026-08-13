const nodemailer = require("nodemailer");

function parseBool(val) {
  if (typeof val === "boolean") return val;
  if (!val) return false;
  return String(val).toLowerCase() === "true";
}

// Gmail App Passwords are displayed in 4-4-4-4 groups for readability but
// the actual credential has no spaces — strip them so a copy-pasted value
// (with or without spaces) always authenticates correctly.
function cleanSecret(val) {
  return val ? String(val).replace(/\s+/g, "") : val;
}

// SMTP_* is the canonical name set (matches .env.example / docs); EMAIL_* is
// kept only as a legacy fallback. SMTP_* wins when both are set so a stale
// EMAIL_* value can never silently shadow a correct SMTP_* one — that
// precedence bug (EMAIL_PASS still holding a placeholder while SMTP_PASS had
// the real app password) is exactly what caused the 535 auth failure.
function resolveSmtpConfig() {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = cleanSecret(process.env.SMTP_PASS || process.env.EMAIL_PASS);
  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587);
  const secure = parseBool(process.env.SMTP_SECURE || process.env.EMAIL_SECURE);
  const from =
    process.env.SMTP_FROM || process.env.EMAIL_FROM || user || "no-reply@example.com";
  return { user, pass, host, port, secure, from };
}

// Logs nodemailer/SMTP-specific diagnostic fields (never the credential
// itself) so auth failures are actionable from server logs alone.
function logSmtpErrorDetails(context, err) {
  if (!err) return;
  console.error(`${context}:`, {
    message: err.message,
    code: err.code,
    responseCode: err.responseCode,
    response: err.response,
    command: err.command,
  });
}

async function createTransporter() {
  const { user: emailUser, pass: emailPass, host: emailHost, port: emailPort, secure: emailSecure } =
    resolveSmtpConfig();
  const sendgridKey = process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY;
  // Control explicit SendGrid use via env var. By default prefer SMTP creds and nodemailer.
  const useSendGrid =
    String(process.env.USE_SENDGRID || "false").toLowerCase() === "true";

  const useEthereal = parseBool(process.env.USE_ETHEREAL) || !emailUser;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !emailUser) {
    throw new Error(
      "Mailer: SMTP credentials missing in production (SMTP_USER or EMAIL_USER)"
    );
  }

  // If Ethereal explicitly requested OR no SMTP credentials present -> Ethereal
  if (useEthereal) {
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    try {
      await transporter.verify();
    } catch (err) {
      logSmtpErrorDetails("Ethereal verify failed", err);
    }
    return { transporter, preview: true };
  }

  // If SendGrid API key is present AND USE_SENDGRID=true, prefer using SendGrid SMTP (user: 'apikey')
  if (sendgridKey && useSendGrid) {
    const sgHost = "smtp.sendgrid.net";
    const sgPort = 587;
    const sgSecure = false;
    if (process.env.NODE_ENV === "development") {
      console.log(
        "Mailer: using SendGrid SMTP (smtp.sendgrid.net) because USE_SENDGRID=true"
      );
    }
    const transporter = nodemailer.createTransport({
      host: sgHost,
      port: sgPort,
      secure: sgSecure,
      auth: {
        user: "apikey",
        pass: sendgridKey,
      },
    });
    try {
      await transporter.verify();
    } catch (verifyErr) {
      logSmtpErrorDetails("SendGrid SMTP verify failed", verifyErr);
      throw verifyErr;
    }
    return { transporter, preview: false };
  }

  if (sendgridKey && !useSendGrid && process.env.NODE_ENV === "development") {
    console.log(
      "SendGrid API key is present but USE_SENDGRID is not set to 'true'; falling back to nodemailer SMTP transport."
    );
  }

  const host = emailHost;
  const port = emailPort;
  const secure = emailSecure;

  // Development-only helper logging to surface common misconfigurations
  if (process.env.NODE_ENV === "development") {
    const redactedUser = emailUser
      ? String(emailUser).replace(/(.).+(@.+)/, "$1***$2")
      : String(emailUser);
    console.log(
      "Mailer config -> host:",
      host,
      "port:",
      port,
      "secure:",
      secure,
      "user:",
      redactedUser,
      "passwordLength:",
      emailPass ? emailPass.length : 0,
      "useEthereal:",
      useEthereal
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });

  try {
    await transporter.verify();
  } catch (verifyErr) {
    logSmtpErrorDetails("Mailer verify failed", verifyErr);
    throw verifyErr;
  }

  return { transporter, preview: false };
}

// sendMail signature: sendMail({ to, subject, html, text, from })
async function sendMail({ to, subject, html, text, from }) {
  try {
    const primary = await createTransporter();
    const { transporter, preview: isPreview } = primary;
    const { from: resolvedFrom } = resolveSmtpConfig();
    const effectiveFrom = from || resolvedFrom;
    if (process.env.NODE_ENV === "development")
      console.log("sendMail: sending from=", effectiveFrom, "to=", to);
    const info = await transporter.sendMail({
      from: effectiveFrom,
      to,
      subject,
      text,
      html,
    });
    const previewUrl = isPreview
      ? nodemailer.getTestMessageUrl(info) || null
      : null;
    return { info, previewUrl };
  } catch (smtpErr) {
    logSmtpErrorDetails("sendMail: primary transport failed", smtpErr);

    // Ethereal (fake test inbox) is only used as a fallback when explicitly
    // opted into via USE_ETHEREAL=true — silently masking a real send
    // failure behind a fake success (as a NODE_ENV==='development' check
    // used to do) makes SMTP auth bugs like this one much harder to catch.
    if (parseBool(process.env.USE_ETHEREAL)) {
      try {
        const testAccount = await nodemailer.createTestAccount();
        const fallbackTransporter = nodemailer.createTransport({
          host: testAccount.smtp.host,
          port: testAccount.smtp.port,
          secure: testAccount.smtp.secure,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
        const { from: resolvedFrom } = resolveSmtpConfig();
        const effectiveFrom = from || resolvedFrom || testAccount.user;
        console.log(
          "sendMail: ethereal fallback from=",
          effectiveFrom,
          "to=",
          to
        );
        const info = await fallbackTransporter.sendMail({
          from: effectiveFrom,
          to,
          subject,
          text,
          html,
        });
        const previewUrl = nodemailer.getTestMessageUrl(info) || null;
        console.log("Ethereal preview URL:", previewUrl);
        return { info, previewUrl };
      } catch (ethErr) {
        logSmtpErrorDetails("sendMail: Ethereal fallback also failed", ethErr);
        throw ethErr;
      }
    }
    throw smtpErr;
  }
}

// Called once at server startup (see server.js). Never throws — logs
// SMTP_USER and the app-password length (never the password itself), then
// runs transporter.verify() against the real Gmail SMTP server and logs a
// clear success/failure line so misconfiguration is caught immediately
// instead of surfacing later as a 535 on the first password-reset request.
async function verifyMailerOnStartup() {
  const { user, pass, host, port } = resolveSmtpConfig();

  console.log("Mailer startup check -> SMTP_USER:", user || "(not set)");
  console.log("Mailer startup check -> SMTP_PASS length:", pass ? pass.length : 0);

  if (parseBool(process.env.USE_ETHEREAL)) {
    console.warn("Mailer startup check: USE_ETHEREAL=true — skipping real Gmail SMTP verification.");
    return { ok: true, ethereal: true };
  }

  if (!user || !pass) {
    console.error(
      "Mailer startup check: SMTP_USER/SMTP_PASS (or EMAIL_USER/EMAIL_PASS) are missing — password-reset emails will fail."
    );
    return { ok: false };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: parseBool(process.env.SMTP_SECURE || process.env.EMAIL_SECURE),
      auth: { user, pass },
    });
    await transporter.verify();
    console.log(`✅ Mailer startup check: SMTP connection to ${host}:${port} as ${user} verified successfully.`);
    return { ok: true };
  } catch (err) {
    logSmtpErrorDetails("❌ Mailer startup check: SMTP verification failed", err);
    console.error(
      "Mailer startup check: for Gmail, SMTP_PASS must be a 16-character App Password " +
      "(Google Account -> Security -> 2-Step Verification -> App passwords), not the account login password."
    );
    return { ok: false, error: err };
  }
}

module.exports = { sendMail, verifyMailerOnStartup };
