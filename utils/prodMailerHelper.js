const nodemailer = require("nodemailer");

function createTransporter() {
  // Prefer SendGrid API key if provided (nodemailer-sendgrid-transport uses API key as auth)
  if (process.env.SENDGRID_API_KEY) {
    // Use SMTP with SendGrid credentials via API key
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST || "smtp.sendgrid.net",
      port: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587,
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER || "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  }

  // Fallback to regular SMTP configuration
  const host = process.env.EMAIL_HOST;
  const port = process.env.EMAIL_PORT
    ? Number(process.env.EMAIL_PORT)
    : undefined;
  const secure = process.env.EMAIL_SECURE === "true";

  if (!host || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    // Try to create a direct transporter (may work in some hosts) or throw
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendTestMail({ to, subject = "Test email", text = "Test" }) {
  const transporter = createTransporter();
  try {
    // Verify transporter (some transports throw on verify)
    await transporter.verify();
  } catch (err) {
    // Continue and attempt send; include verification error in response
    console.warn("Transporter verify failed:", err && err.message);
  }

  const from =
    process.env.EMAIL_FROM ||
    process.env.EMAIL_USER ||
    `no-reply@${process.env.FRONTEND_BASE_URL || "example.com"}`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html: `<p>${text}</p>`,
  });

  return {
    messageId: info && info.messageId,
    accepted: info && info.accepted,
    rejected: info && info.rejected,
    response: info && info.response,
  };
}

module.exports = { createTransporter, sendTestMail };
