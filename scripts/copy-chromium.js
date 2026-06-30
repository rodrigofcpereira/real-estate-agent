const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const src = execSync("node -e \"console.log(require('puppeteer').executablePath())\"", {
  encoding: "utf-8",
}).trim();

const destDir = path.join(__dirname, "..", "resources", "chromium");

if (!src || !fs.existsSync(src)) {
  console.error("Chromium not found. Run: npx puppeteer browsers install chrome");
  process.exit(1);
}

const chromeDir = path.dirname(path.dirname(src));
const dest = path.join(destDir, path.basename(chromeDir));

if (fs.existsSync(dest)) {
  console.log("Chromium already copied to", dest);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
execSync(`cp -R "${chromeDir}" "${dest}"`, { stdio: "inherit" });
console.log("Chromium copied to", dest);
