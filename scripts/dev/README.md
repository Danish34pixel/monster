Dev scripts
===========

These scripts are intended for local development and testing only. They should not be used in production.

Files:
- `createTestUser.js` - creates or updates a test user with email `test-reset@example.com`.
- `generateResetToken.js` - generates a raw reset token for the test user and stores its hash in the DB.

Usage (from `Medi-trap-backend` folder):

Windows PowerShell:

```powershell
node scripts/dev/createTestUser.js
node scripts/dev/generateResetToken.js
```

Notes:
- `createTestUser.js` currently writes a placeholder `drugLicenseImage` value and may fail if your User schema requires a valid image URL. Adjust the script as needed for your environment.
- These scripts are safe to keep in the repo under `scripts/dev` for local testing; they were moved from the project root to avoid accidental use in production.
