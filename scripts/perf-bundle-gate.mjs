import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const assetsDir = path.join(distDir, "assets");

const MAX_JS_KB = Number(process.env.OTOSHI_MAX_JS_KB || 900);
const MAX_CSS_KB = Number(process.env.OTOSHI_MAX_CSS_KB || 300);

if (!fs.existsSync(assetsDir)) {
  console.error(`[perf-bundle-gate] Missing assets directory: ${assetsDir}`);
  process.exit(1);
}

const files = fs.readdirSync(assetsDir);
const jsFiles = files.filter((file) => file.endsWith(".js"));
const cssFiles = files.filter((file) => file.endsWith(".css"));
const startupJsFiles = jsFiles.filter((file) =>
  /^(index-|react-vendor-|ui-vendor-)/.test(file)
);

const getTotalKb = (list) =>
  list.reduce((sum, file) => {
    const full = path.join(assetsDir, file);
    return sum + fs.statSync(full).size / 1024;
  }, 0);

const jsKb = Number(getTotalKb(jsFiles).toFixed(1));
const startupJsKb = Number(getTotalKb(startupJsFiles).toFixed(1));
const cssKb = Number(getTotalKb(cssFiles).toFixed(1));

const report = {
  jsKb,
  startupJsKb,
  cssKb,
  maxJsKb: MAX_JS_KB,
  maxCssKb: MAX_CSS_KB,
  jsFiles,
  startupJsFiles,
  cssFiles,
  pass: startupJsKb <= MAX_JS_KB && cssKb <= MAX_CSS_KB,
};

console.log("[perf-bundle-gate]", JSON.stringify(report, null, 2));

if (!report.pass) {
  process.exit(2);
}
