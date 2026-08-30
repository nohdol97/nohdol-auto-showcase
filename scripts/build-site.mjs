import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_DEMO_PATH = /^\.\/assets\/[a-z0-9][a-z0-9.-]*\.gif$/;

export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 3 || !Array.isArray(catalog.apps)) throw new Error("apps.json must use schemaVersion 3 and define apps");
  const ids = new Set();
  for (const app of catalog.apps) {
    const kind = app.kind ?? "product";
    if (!SAFE_ID.test(app.id) || ids.has(app.id) || !app.name || !app.description || !["product", "prototype"].includes(kind)) throw new Error(`invalid app metadata: ${app.id}`);
    ids.add(app.id);
    if (kind === "prototype") {
      if (app.authEndpoint !== null || app.installPreview !== true || !app.demoGif || !app.demoAlt || !app.demoCaption || !app.demoLabel || !app.availabilityNote || !app.audience || !app.sector) throw new Error(`prototype ${app.id} must define a truthful disabled install preview`);
      if (!SAFE_DEMO_PATH.test(app.demoGif)) throw new Error(`invalid demo GIF path: ${app.id}`);
    } else if (!app.activationNote) throw new Error(`invalid app metadata: ${app.id}`);
    if (kind === "product" && app.authEndpoint !== null) {
      const endpoint = new URL(app.authEndpoint);
      if (endpoint.protocol !== "https:" || endpoint.pathname !== "/authorize") throw new Error(`invalid authorization endpoint: ${app.id}`);
    }
    if (kind === "product" && app.demoGif !== null && !SAFE_DEMO_PATH.test(app.demoGif)) throw new Error(`invalid demo GIF path: ${app.id}`);
    if (app.demoGif && (!app.demoAlt || !app.demoCaption)) throw new Error(`demo GIF requires alt text and caption: ${app.id}`);
    if (!Array.isArray(app.assets) || app.assets.length === 0 || app.assets.some((asset) => !SAFE_ID.test(asset.id) || !asset.label)) throw new Error(`app ${app.id} must define valid assets`);
    if (!SAFE_ID.test(app.defaultAssetId) || !app.assets.some((asset) => asset.id === app.defaultAssetId)) throw new Error(`app ${app.id} must define a valid default asset`);
  }
  return catalog;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function routeDocument(template, { page, appId = "", baseHref, title }) {
  return template
    .replace("<title>한결 — 반복 업무 프로그램</title>", `<base href="${escapeHtml(baseHref)}" />\n    <title>${escapeHtml(title)}</title>`)
    .replace('<body data-page="catalog">', `<body data-page="${escapeHtml(page)}"${appId ? ` data-app-id="${escapeHtml(appId)}"` : ""}>`);
}

function parseArguments(argv) {
  const options = { catalog: "apps.json", site: "site", output: "_site" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--catalog") options.catalog = value;
    else if (argv[index] === "--site") options.site = value;
    else if (argv[index] === "--output") options.output = value;
    else continue;
    index += 1;
  }
  return options;
}

export async function buildSite(options) {
  const catalog = validateCatalog(JSON.parse(await readFile(options.catalog, "utf8")));
  await rm(options.output, { recursive: true, force: true });
  await mkdir(options.output, { recursive: true });
  await cp(options.site, options.output, { recursive: true });
  await writeFile(path.join(options.output, "apps.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  const template = await readFile(path.join(options.site, "index.html"), "utf8");
  const installIndex = path.join(options.output, "install");
  await mkdir(installIndex, { recursive: true });
  await writeFile(
    path.join(installIndex, "index.html"),
    routeDocument(template, {
      page: "install-index",
      baseHref: "../",
      title: "프로그램 설치 — 한결",
    }),
  );
  for (const app of catalog.apps) {
    const detailDirectory = path.join(options.output, "apps", app.id);
    await mkdir(detailDirectory, { recursive: true });
    await writeFile(
      path.join(detailDirectory, "index.html"),
      routeDocument(template, {
        page: "detail",
        appId: app.id,
        baseHref: "../../",
        title: `${app.name} — 한결`,
      }),
    );
    if ((app.kind ?? "product") === "product" || app.installPreview === true) {
      const installDirectory = path.join(options.output, "install", app.id);
      await mkdir(installDirectory, { recursive: true });
      await writeFile(
        path.join(installDirectory, "index.html"),
        routeDocument(template, {
          page: "install",
          appId: app.id,
          baseHref: "../../",
          title: `${app.name} 설치 — 한결`,
        }),
      );
    }
  }
  return catalog;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSite(parseArguments(process.argv.slice(2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
