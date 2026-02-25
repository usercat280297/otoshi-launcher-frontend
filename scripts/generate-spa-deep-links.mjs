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

for (const route of routes) {
  if (route === "/") continue;

  const normalized = route.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) continue;

  const routeDir = path.join(distDir, normalized);
  if (fs.existsSync(routeDir) && !fs.statSync(routeDir).isDirectory()) {
    fs.unlinkSync(routeDir);
  }

  fs.mkdirSync(routeDir, { recursive: true });
  const routeIndex = path.join(routeDir, "index.html");
  fs.writeFileSync(routeIndex, indexHtml, "utf8");
  written.push(path.relative(projectRoot, routeIndex));
}

const notFoundPath = path.join(distDir, "404.html");
fs.writeFileSync(notFoundPath, indexHtml, "utf8");
written.push(path.relative(projectRoot, notFoundPath));

console.log(`[deep-links] generated ${written.length} deep-link entrypoints`);
