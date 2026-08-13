// Server-rendered HTML for the reset-password page (GET/POST /reset-password/:token).
// Plain template-literal HTML — no view engine is installed/configured in
// this project (view/index.ejs exists but is never wired to a view engine
// or res.render() anywhere; it's dead code), so this matches the existing
// convention already used in utils/emailTemplete.js.

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

const BASE_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f1f5f9;
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    padding: 24px 16px;
  }
  .card {
    width: 100%;
    max-width: 420px;
    background: #ffffff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(15, 23, 42, 0.08);
  }
  .brand {
    background: #2563eb;
    padding: 20px 28px;
    text-align: center;
  }
  .brand span {
    color: #ffffff;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  .content { padding: 28px; }
  h1 { margin: 0 0 8px; font-size: 20px; color: #0f172a; }
  p.subtitle { margin: 0 0 20px; font-size: 14px; color: #64748b; line-height: 1.5; }
  label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; }
  input[type="password"] {
    width: 100%;
    padding: 12px 14px;
    font-size: 15px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    color: #0f172a;
    margin-bottom: 16px;
  }
  input[type="password"]:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
  button {
    width: 100%;
    padding: 13px;
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    background: #2563eb;
    border: none;
    border-radius: 10px;
    cursor: pointer;
  }
  button:hover { background: #1d4ed8; }
  .error-box {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 16px;
    color: #b91c1c;
    font-size: 13px;
  }
  .success-icon, .error-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
    font-size: 28px;
  }
  .success-icon { background: #ecfdf5; color: #059669; }
  .error-icon { background: #fef2f2; color: #dc2626; }
  .center { text-align: center; }
  a.btn-link {
    display: block;
    width: 100%;
    padding: 13px;
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    background: #2563eb;
    border-radius: 10px;
    text-decoration: none;
    text-align: center;
    box-sizing: border-box;
  }
  small.hint { display: block; margin-top: -10px; margin-bottom: 16px; color: #94a3b8; font-size: 12px; }
`;

function page({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — MediTrap</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="brand"><span>MediTrap</span></div>
    <div class="content">
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`;
}

/**
 * The New Password / Confirm Password / Submit form.
 * @param {Object} opts
 * @param {string} opts.token
 * @param {string} [opts.error] - Inline validation/error message (e.g. password mismatch).
 */
function renderResetFormPage({ token, error }) {
  const safeToken = escapeHtml(token);
  const errorHtml = error
    ? `<div class="error-box">${escapeHtml(error)}</div>`
    : "";

  return page({
    title: "Reset your password",
    bodyHtml: `
      <h1>Reset your password</h1>
      <p class="subtitle">Choose a new password for your MediTrap account.</p>
      ${errorHtml}
      <form method="POST" action="/reset-password/${safeToken}">
        <label for="password">New Password</label>
        <input type="password" id="password" name="password" minlength="8" maxlength="128" required autocomplete="new-password" />
        <label for="confirmPassword">Confirm Password</label>
        <input type="password" id="confirmPassword" name="confirmPassword" minlength="8" maxlength="128" required autocomplete="new-password" />
        <small class="hint">Must be at least 8 characters.</small>
        <button type="submit">Reset Password</button>
      </form>
    `,
  });
}

function renderSuccessPage() {
  return page({
    title: "Password reset successful",
    bodyHtml: `
      <div class="center">
        <div class="success-icon">&#10003;</div>
        <h1>Password updated successfully. You can now login to MediTrap.</h1>
      </div>
    `,
  });
}

/**
 * Invalid / expired token error page.
 * @param {"invalid" | "expired"} reason
 */
function renderTokenErrorPage(reason) {
  const isExpired = reason === "expired";
  return page({
    title: isExpired ? "Link expired" : "Invalid link",
    bodyHtml: `
      <div class="center">
        <div class="error-icon">&#33;</div>
        <h1>${isExpired ? "This link has expired" : "Invalid reset link"}</h1>
        <p class="subtitle">
          ${
            isExpired
              ? "Password reset links expire 15 minutes after they're requested, and can only be used once. Please request a new one from the app."
              : "This password reset link is invalid, has already been used, or has expired. Please request a new one from the app."
          }
        </p>
      </div>
    `,
  });
}

module.exports = {
  renderResetFormPage,
  renderSuccessPage,
  renderTokenErrorPage,
  escapeHtml,
};
