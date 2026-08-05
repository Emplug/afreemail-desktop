const { notarize } = require('@electron/notarize');

// electron-builder afterSign hook. No-ops unless the three Apple credential env
// vars are present, so `npm run dist:mac` still works for local/unsigned test
// builds -- only a real release build (with these set as CI secrets or in the
// releaser's local env) actually notarizes. Never hardcode these values here;
// APPLE_APP_SPECIFIC_PASSWORD must be an app-specific password generated at
// https://appleid.apple.com, not the Apple ID's real password.
module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Skipping notarization -- APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(`[notarize] Submitting ${appName} for notarization...`);
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log(`[notarize] Done.`);
};
