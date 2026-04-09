const { sendMail } = require("../utils/mailer");

async function run() {
  try {
    const to = process.argv[2] || process.env.TEST_TO || "test@example.com";
    const subject = "Test Email from MedTek Backend";
    const html = "<p>This is a test email from MedTek backend.</p>";
    const text = "This is a test email from MedTek backend.";
    const res = await sendMail({ to, subject, html, text });
    if (res.previewUrl) {
      console.log("Preview URL:", res.previewUrl);
    } else {
      console.log("Email sent. Info:", res.info && res.info.messageId);
    }
  } catch (e) {
    console.error("Test email failed:", e && e.message);
    process.exit(1);
  }
}

if (require.main === module) run();
