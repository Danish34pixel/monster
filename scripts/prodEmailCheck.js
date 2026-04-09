#!/usr/bin/env node
// scripts/prodEmailCheck.js
// Usage: node scripts/prodEmailCheck.js recipient@example.com
// This script runs in the environment (use on deployed server) and attempts
// to verify the SMTP transporter and send a single test email. It prints
// detailed errors but never logs secrets.

require("dotenv").config();
const nodemailer = require("nodemailer");

function redact(str) {
  try {
    if (!str) return str;
    return String(str).replace(/(.).+@/, "$1***@");
  } catch (e) {
    return "(redacted)";
  }
}

async function createTransporterForCheck() {
  const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const emailHost =
    process.env.EMAIL_HOST || process.env.SMTP_HOST || "smtp.gmail.com";
  const emailPort = process.env.EMAIL_PORT
    ? Number(process.env.EMAIL_PORT)
    : 587;
  const emailSecure =
    String(process.env.EMAIL_SECURE || "false").toLowerCase() === "true";
  const sendgridKey = process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY;

  if (sendgridKey) {
    return nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: { user: "apikey", pass: sendgridKey },
    });
  }

  return nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: emailSecure,
    auth: { user: emailUser, pass: emailPass },
  });
}

async function main() {
  const to = process.argv[2] || process.env.TEST_EMAIL_RECIPIENT;
  if (!to) {
    console.error(
      "Usage: node scripts/prodEmailCheck.js recipient@example.com"
    );
    process.exit(1);
  }

  console.log("Running production email check with these visible variables:");
  console.log("  NODE_ENV:", process.env.NODE_ENV);
  console.log(
    "  EMAIL_HOST:",
    process.env.EMAIL_HOST || process.env.SMTP_HOST || "smtp.gmail.com"
  );
  console.log(
    "  EMAIL_PORT:",
    process.env.EMAIL_PORT || process.env.SMTP_PORT || 587
  );
  console.log(
    "  EMAIL_USER:",
    redact(process.env.EMAIL_USER || process.env.SMTP_USER)
  );
  console.log(
    "  USING_SENDGRID:",
    !!(process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY)
  );

  let transporter;
  try {
    transporter = await createTransporterForCheck();
  } catch (err) {
    console.error("Failed to construct transporter:", err && err.message);
    process.exit(2);
  }

  try {
    console.log("Verifying transporter...");
    await transporter.verify();
    console.log("Transporter verified: OK");
  } catch (verifyErr) {
    console.error(
      "Transporter verification failed:",
      verifyErr && verifyErr.message
    );
    // Still try to send to capture full error details
  }

  try {
    const from =
      process.env.EMAIL_FROM ||
      process.env.EMAIL_USER ||
      "no-reply@example.com";
    console.log(
      `Attempting to send test message from ${redact(from)} to ${redact(to)}`
    );
    const info = await transporter.sendMail({
      from,
      to,
      subject: "[medtek] Production email check",
      text: "This is a production email check. If you received this, SMTP is working.",
      html: "<p>This is a production email check. If you received this, SMTP is working.</p>",
    });
    console.log("Send succeeded. Response info (redacted):");
    console.log({
      messageId: info && info.messageId,
      accepted: info && info.accepted,
      rejected: info && info.rejected,
      response:
        typeof info.response === "string"
          ? info.response.replace(/([A-Za-z0-9_-]{20,})/g, "[redacted]")
          : info.response,
    });
    process.exit(0);
  } catch (sendErr) {
    console.error("Send failed:", sendErr && sendErr.message);
    if (sendErr && sendErr.response)
      console.error("SMTP response:", sendErr.response);
    process.exit(3);
  }
}

main();
