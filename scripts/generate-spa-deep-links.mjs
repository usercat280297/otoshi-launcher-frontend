import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const indexPath = path.join(distDir, "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("[deep-links] Missing dist/index.html");
  process.exit(1);
}

const indexHtml = fs.readFileSync(indexPath, "utf8");

const routes = [
  "/",
  "/overlay",
  "/big-picture",
  "/download-launcher",
  "/privacy-policy",
  "/terms-of-service",
  "/store",
  "/steam",
  "/discover",
  "/fixes/online",
  "/fixes/bypass",
  "/workshop",
  "/community",
  "/wishlist",
  "/inventory",
  "/profile",
  "/library",
  "/downloads",
  "/settings",
  "/developer",
  "/login",
  "/register",
  "/oauth/callback",
];

const written = [];
const redirects = [];

for (const route of routes) {
  if (route === "/") continue;

  const normalized = route.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) continue;

  const routePath = path.join(distDir, normalized);
  if (fs.existsSync(routePath) && fs.statSync(routePath).isDirectory()) {
    fs.rmSync(routePath, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(routePath), { recursive: true });
  fs.writeFileSync(routePath, indexHtml, "utf8");
  written.push(path.relative(projectRoot, routePath));
  redirects.push(`/${normalized} /index.html 200`);
}

const notFoundPath = path.join(distDir, "404.html");
fs.writeFileSync(notFoundPath, indexHtml, "utf8");
written.push(path.relative(projectRoot, notFoundPath));

const redirectsPath = path.join(distDir, "_redirects");
const redirectsBody = [...redirects, "/* /index.html 200"].join("\n") + "\n";
fs.writeFileSync(redirectsPath, redirectsBody, "utf8");
written.push(path.relative(projectRoot, redirectsPath));

console.log(`[deep-links] generated ${written.length} deep-link entrypoints`);
