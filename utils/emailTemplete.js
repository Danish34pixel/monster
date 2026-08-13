// Reusable HTML email templates. Plain CommonJS (matches the rest of the
// backend) so these can be `require()`d from controllers/services.

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

/**
 * Password reset email — professional HTML template with a call-to-action
 * button, a plain-text fallback link, and an expiry warning.
 *
 * @param {Object} opts
 * @param {string} [opts.name] - Recipient's display name, if known.
 * @param {string} opts.resetUrl - Full URL the user should open to reset their password.
 * @param {number} [opts.expiryMinutes] - Minutes until the link expires.
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildPasswordResetEmail({ name, resetUrl, expiryMinutes = 15 }) {
  const safeName = escapeHtml(name || "there");
  const safeUrl = escapeHtml(resetUrl);
  const subject = "Reset Your MediTrap Password";

  const html = `
  <div style="background-color:#f1f5f9;padding:32px 16px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
      <div style="background:#2563eb;padding:24px 32px;text-align:center;">
        <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.3px;">MediTrap</span>
      </div>
      <div style="padding:32px;">
        <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Reset your password</h1>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#334155;">Hi ${safeName},</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
          We received a request to reset the password for your MediTrap account. Click the
          button below to choose a new password.
        </p>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${safeUrl}"
             style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;
                    font-size:15px;font-weight:700;padding:14px 32px;border-radius:12px;">
            Reset Password
          </a>
        </div>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;">
          <a href="${safeUrl}" style="color:#2563eb;">${safeUrl}</a>
        </p>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin:0 0 24px;">
          <p style="margin:0;font-size:13px;color:#92400e;">
            ⏱ This link expires in <strong>${expiryMinutes} minutes</strong> and can only be used once.
          </p>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">
          If you didn't request a password reset, you can safely ignore this email — your
          password will remain unchanged.
        </p>
      </div>
      <div style="background:#f8fafc;padding:16px 32px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">© ${new Date().getFullYear()} MediTrap. All rights reserved.</p>
      </div>
    </div>
  </div>`;

  const text = `Hi ${name || "there"},

We received a request to reset the password for your MediTrap account.

Reset your password using this link (expires in ${expiryMinutes} minutes, one-time use only):
${resetUrl}

If you didn't request this, you can safely ignore this email.`;

  return { subject, html, text };
}

module.exports = { buildPasswordResetEmail, escapeHtml };
