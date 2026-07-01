/**
 * afterPack.js
 * 
 * Replaces electron-builder's packaged Electron with the node_modules version.
 * 
 * Root cause: the Electron zip that electron-builder downloads produces an app
 * that crashes at node::PrincipalRealm::builtin_module_require() on launch,
 * while the same binary from node_modules/electron/dist works fine.
 * 
 * This hook keeps the app.asar created by electron-builder but replaces the 
 * entire Electron Framework and helpers with the working node_modules version.
 */

const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context;
  if (packager.platform.name !== 'mac') return;

  const productName = packager.appInfo.productName;          // "Tech Corretor"
  const builtApp    = path.join(appOutDir, `${productName}.app`);
  const srcElectron = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');

  console.log('[afterPack] Replacing Electron Framework with node_modules version...');

  // 1. Save our app.asar before we touch anything
  const ourAsar  = path.join(builtApp, 'Contents', 'Resources', 'app.asar');
  const tmpAsar  = path.join(appOutDir, '_app_tmp.asar');
  fs.copyFileSync(ourAsar, tmpAsar);

  // 2. Replace Electron Framework entirely
  const dstFrameworks = path.join(builtApp, 'Contents', 'Frameworks');
  const srcFrameworks = path.join(srcElectron, 'Contents', 'Frameworks');
  execSync(`rm -rf ${JSON.stringify(dstFrameworks)}`);
  execSync(`cp -R ${JSON.stringify(srcFrameworks)} ${JSON.stringify(dstFrameworks)}`);

  // 3. Replace MacOS binary with the one from node_modules (rename it)
  const dstMacOS  = path.join(builtApp, 'Contents', 'MacOS', productName);
  const srcBinary = path.join(srcElectron, 'Contents', 'MacOS', 'Electron');
  fs.copyFileSync(srcBinary, dstMacOS);
  fs.chmodSync(dstMacOS, 0o755);

  // 4. Restore our app.asar
  fs.copyFileSync(tmpAsar, ourAsar);
  fs.unlinkSync(tmpAsar);
  // Remove default_app.asar from the node_modules electron
  const defaultAsar = path.join(builtApp, 'Contents', 'Resources', 'default_app.asar');
  if (fs.existsSync(defaultAsar)) fs.unlinkSync(defaultAsar);

  // 5. Update the main Info.plist — only set CFBundleExecutable; keep rest as original Electron values
  //    (CFBundleName stays "Electron" which is what the binary expects for helper lookup)
  const mainPlist = path.join(builtApp, 'Contents', 'Info.plist');
  execSync(`plutil -replace CFBundleExecutable -string ${JSON.stringify(productName)} ${JSON.stringify(mainPlist)}`);
  execSync(`plutil -replace CFBundleDisplayName -string ${JSON.stringify(productName)} ${JSON.stringify(mainPlist)}`);
  execSync(`plutil -replace CFBundleName -string "Electron" ${JSON.stringify(mainPlist)}`);

  // 6. Re-sign the entire app bundle to fix "damaged" error on macOS
  //    Tries Development certificate first (trusted on dev machine),
  //    falls back to ad-hoc if unavailable.
  const cert = 'Apple Development: Rodrigo Felippo (N944BST58L)';
  let signOpts = `--force --deep --sign ${JSON.stringify(cert)} --preserve-metadata=identifier,flags`;
  try {
    execSync(`security find-identity -p codesigning -v | grep -q ${JSON.stringify(cert)}`);
  } catch (_) {
    console.log('[afterPack] Development cert not found, using ad-hoc signing');
    signOpts = `--force --deep --sign - --preserve-metadata=identifier,flags`;
  }
  console.log('[afterPack] Re-signing app bundle...');
  execSync(`codesign ${signOpts} ${JSON.stringify(builtApp)}`, { stdio: 'inherit' });

  console.log('[afterPack] Done. Framework replaced, app.asar restored, app re-signed.');
};
