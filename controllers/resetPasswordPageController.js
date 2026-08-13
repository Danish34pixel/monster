// Server-rendered reset-password page — GET/POST /reset-password/:token.
// Replaces the dependency on a separately-hosted frontend: the link emailed
// to users now points straight at this backend, which renders the form,
// validates the token, and updates the password itself. No React/Expo web
// deployment required for this flow anymore.
const bcrypt = require("bcryptjs");
const { hashToken } = require("../utils/passwordResetToken");
const { checkResetToken, findAccountByResetToken, timingSafeStringsEqual } = require("../services/passwordResetService");
const { resetPasswordTokenBodySchema } = require("../validation/schemas");
const {
  renderResetFormPage,
  renderSuccessPage,
  renderTokenErrorPage,
} = require("../utils/resetPasswordPageTemplates");

function sendHtml(res, status, html) {
  res.status(status).set("Content-Type", "text/html; charset=utf-8").send(html);
}

// GET /reset-password/:token — shows the form, or an error page if the
// token is already invalid/expired. Read-only: does not consume the token.
async function renderResetPasswordPage(req, res) {
  try {
    const token = String(req.params.token || "").trim();

    if (!token || token.length < 20) {
      return sendHtml(res, 400, renderTokenErrorPage("invalid"));
    }

    const check = await checkResetToken(hashToken(token));
    if (!check.valid) {
      return sendHtml(res, 400, renderTokenErrorPage(check.reason));
    }

    return sendHtml(res, 200, renderResetFormPage({ token }));
  } catch (err) {
    console.error("renderResetPasswordPage error:", err && err.message);
    return sendHtml(res, 500, renderTokenErrorPage("invalid"));
  }
}

// POST /reset-password/:token — validates + updates the password, then
// shows a success page. The token always comes from the URL param (never
// trusted from the form body) — it's the actual authorization factor here,
// not a session, so re-deriving it from the same trusted source as the GET
// keeps that contract simple and correct.
async function submitResetPasswordPage(req, res) {
  try {
    const token = String(req.params.token || "").trim();

    if (!token || token.length < 20) {
      return sendHtml(res, 400, renderTokenErrorPage("invalid"));
    }

    const parsed = resetPasswordTokenBodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join(" ");
      return sendHtml(res, 400, renderResetFormPage({ token, error: message }));
    }
    const { password, confirmPassword } = parsed.data;
    if (password !== confirmPassword) {
      return sendHtml(
        res,
        400,
        renderResetFormPage({ token, error: "Passwords do not match." }),
      );
    }

    const hashedIncoming = hashToken(token);
    const found = await findAccountByResetToken(hashedIncoming);

    if (!found || !found.account.resetPasswordToken || !found.account.resetPasswordExpires) {
      return sendHtml(res, 400, renderTokenErrorPage("invalid"));
    }
    if (!timingSafeStringsEqual(hashedIncoming, found.account.resetPasswordToken)) {
      return sendHtml(res, 400, renderTokenErrorPage("invalid"));
    }
    if (new Date(found.account.resetPasswordExpires).getTime() < Date.now()) {
      await found.model.updateOne(
        { _id: found.account._id },
        { $unset: { resetPasswordToken: "", resetPasswordExpires: "" } },
        { strict: false },
      );
      return sendHtml(res, 400, renderTokenErrorPage("expired"));
    }

    const account = await found.model
      .findById(found.account._id)
      .select("+resetPasswordToken +resetPasswordExpires +password");

    account.password = await bcrypt.hash(password, 12);
    account.clearPasswordResetToken();
    await account.save({ validateModifiedOnly: true });

    return sendHtml(res, 200, renderSuccessPage());
  } catch (err) {
    console.error("submitResetPasswordPage error:", err && err.message);
    return sendHtml(res, 500, renderTokenErrorPage("invalid"));
  }
}

module.exports = { renderResetPasswordPage, submitResetPasswordPage };
