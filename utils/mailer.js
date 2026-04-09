const nodemailer = require("nodemailer");

function parseBool(val) {
  if (typeof val === "boolean") return val;
  if (!val) return false;
  return String(val).toLowerCase() === "true";
}

async function createTransporter() {
  const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const emailPort = process.env.EMAIL_PORT || process.env.SMTP_PORT;
  const emailSecure = process.env.EMAIL_SECURE || process.env.SMTP_SECURE;
  const sendgridKey = process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY;
  // Control explicit SendGrid use via env var. By default prefer SMTP creds and nodemailer.
  const useSendGrid =
    String(process.env.USE_SENDGRID || "false").toLowerCase() === "true";

  const useEthereal = parseBool(process.env.USE_ETHEREAL) || !emailUser;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !emailUser) {
    throw new Error(
      "Mailer: SMTP credentials missing in production (EMAIL_USER or SMTP_USER)"
    );
  }

  // If dev and Ethereal requested OR no SMTP credentials present -> Ethereal
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
      console.error("Ethereal verify failed:", err && err.message);
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
      console.error(
        "SendGrid SMTP verify failed:",
        verifyErr && verifyErr.message
      );
      throw verifyErr;
    }
    return { transporter, preview: false };
  }

  if (sendgridKey && !useSendGrid && process.env.NODE_ENV === "development") {
    console.log(
      "SendGrid API key is present but USE_SENDGRID is not set to 'true'; falling back to nodemailer SMTP transport."
    );
  }

  const host = emailHost || "smtp.gmail.com";
  const port = emailPort ? Number(emailPort) : 587;
  const secure = parseBool(emailSecure);

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
    console.error("Mailer verify failed:", verifyErr && verifyErr.message);
    throw verifyErr;
  }

  return { transporter, preview: false };
}

// sendMail signature: sendMail({ to, subject, html, text, from })
async function sendMail({ to, subject, html, text, from }) {
  try {
    const primary = await createTransporter();
    const { transporter, preview: isPreview } = primary;
    const effectiveFrom =
      from ||
      process.env.EMAIL_FROM ||
      process.env.EMAIL_USER ||
      "no-reply@example.com";
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
    console.error(
      "sendMail: primary transport failed",
      smtpErr && smtpErr.message
    );
    if (process.env.NODE_ENV === "development") {
      try {
        const testAccount = await nodemailer.createTestAccount();
        const fallbackTransporter = nodemailer.createTransport({
          host: testAccount.smtp.host,
          port: testAccount.smtp.port,
          secure: testAccount.smtp.secure,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
        const effectiveFrom =
          from ||
          process.env.EMAIL_FROM ||
          testAccount.user ||
          "no-reply@example.com";
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
        console.error(
          "sendMail: Ethereal fallback also failed",
          ethErr && ethErr.message
        );
        throw ethErr;
      }
    }
    throw smtpErr;
  }
}

module.exports = { sendMail };
