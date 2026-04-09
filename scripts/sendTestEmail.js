// Simple script to test the mailer configuration locally.
// Usage: node scripts/sendTestEmail.js recipient@example.com
const { sendMail } = require("../utils/mailer");

async function main() {
  const to = process.argv[2] || process.env.TEST_EMAIL_RECIPIENT;
  if (!to) {
    console.error("Usage: node scripts/sendTestEmail.js recipient@example.com");
    process.exit(1);
  }

  try {
    const result = await sendMail({
      to,
      subject: "Test email from medtek",
      html: "<p>This is a test email from medtek</p>",
      text: "This is a test email from medtek",
    });
    console.log("sendMail result:", !!result && typeof result === "object");
    if (result && result.previewUrl)
      console.log("Preview URL:", result.previewUrl);
    process.exit(0);
  } catch (err) {
    console.error("sendTestEmail failed:", err && err.message);
    process.exit(2);
  }
}

main();
