const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const appName = "LF Im\u00f3veis";

function findBuildApp() {
  const distDir = path.join(__dirname, "..", "dist", "mac-arm64");
  const entries = fs.readdirSync(distDir);
  const appDir = entries.find(e => e.endsWith(".app"));
  if (!appDir) throw new Error(`No .app found in ${distDir}`);
  return path.join(distDir, appDir);
}

const appPath = findBuildApp();
const frameworksPath = path.join(appPath, "Contents", "Frameworks");
const nodeHelpers = path.join(
  __dirname, "..", "node_modules", "electron", "dist",
  "Electron.app", "Contents", "Frameworks"
);

const variants = ["Helper", "Helper (GPU)", "Helper (Plugin)", "Helper (Renderer)"];

for (const variant of variants) {
  const src = `Electron ${variant}`;
  const dst = `${appName} ${variant}`;
  const srcPath = path.join(nodeHelpers, `${src}.app`);
  const dstPath = path.join(frameworksPath, `${dst}.app`);

  console.log(`Replacing ${dst}...`);

  // Remove electron-builder's modified version
  fs.rmSync(dstPath, { recursive: true, force: true });

  // Copy original helper bundle from Electron distribution
  execSync(`cp -R "${srcPath}" "${dstPath}"`);

  // Inside the bundle, rename the executable
  const macosDir = path.join(dstPath, "Contents", "MacOS");
  const [origExe] = fs.readdirSync(macosDir).filter(f => f.startsWith("Electron"));
  if (!origExe) throw new Error(`No executable found in ${macosDir}`);

  // The new executable name: for "Helper" → "LF Imóveis Helper", for "Helper (GPU)" → "LF Imóveis Helper (GPU)"
  const newExeName = `${appName} ${variant}`;
  fs.renameSync(path.join(macosDir, origExe), path.join(macosDir, newExeName));

  // Update Info.plist to match the new executable name and bundle ID
  const plistPath = path.join(dstPath, "Contents", "Info.plist");
  execSync(`plutil -replace CFBundleExecutable -string "${newExeName}" "${plistPath}"`);
  execSync(`plutil -replace CFBundleIdentifier -string "com.lfimoveis.app.helper" "${plistPath}"`);

  // Don't add CFBundleVersion; the original plist doesn't have it and adding it
  // would invalidate the linker signature's implicit Info.plist hash.
  // Remove if electron-builder left one behind.
  execSync(`plutil -remove CFBundleVersion "${plistPath}" 2>/dev/null || true`);

  console.log(`  ${origExe} → ${newExeName}`);
}

console.log("All helpers replaced.");
