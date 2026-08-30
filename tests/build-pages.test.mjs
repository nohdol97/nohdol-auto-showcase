import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { buildSite, validateCatalog } from "../scripts/build-site.mjs";

const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(await readFile(path.join(root, "apps.json"), "utf8"));

test("accepts a disabled endpoint until the authorization Worker is deployed", () => {
  const disabled = structuredClone(catalog);
  disabled.apps[0].authEndpoint = null;
  assert.equal(validateCatalog(disabled).apps[0].authEndpoint, null);
});

test("accepts only an HTTPS authorize endpoint", () => {
  const valid = structuredClone(catalog);
  valid.apps[0].authEndpoint = "https://downloads.example/authorize";
  assert.equal(validateCatalog(valid).apps[0].authEndpoint, valid.apps[0].authEndpoint);
  const invalid = structuredClone(valid);
  invalid.apps[0].authEndpoint = "https://downloads.example/not-authorize";
  assert.throws(() => validateCatalog(invalid), /authorization endpoint/);
});

test("requires accessible text for a demo GIF", () => {
  const invalid = structuredClone(catalog);
  invalid.apps[0].demoGif = "./assets/autotrip-workflow.gif";
  invalid.apps[0].demoAlt = null;
  invalid.apps[0].demoCaption = null;
  assert.throws(() => validateCatalog(invalid), /alt text and caption/);
});

test("requires an app-specific activation note", () => {
  const invalid = structuredClone(catalog);
  delete invalid.apps[0].activationNote;
  assert.throws(() => validateCatalog(invalid), /invalid app metadata/);
});

test("requires the default asset to reference an allowlisted installer", () => {
  const valid = structuredClone(catalog);
  assert.equal(validateCatalog(valid).apps[0].defaultAssetId, "windows");
  const invalid = structuredClone(catalog);
  invalid.apps[0].defaultAssetId = "android";
  assert.throws(() => validateCatalog(invalid), /valid default asset/);
});

test("detects supported desktop platforms and leaves mobile or unknown platforms to the app fallback", async () => {
  const source = await readFile(path.join(root, "site", "platform.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const { detectAssetId } = context.window.showcasePlatform;
  assert.equal(detectAssetId("Win32", "desktop"), "windows");
  assert.equal(detectAssetId("macOS", "desktop"), "macos");
  assert.equal(detectAssetId("Linux x86_64", "desktop"), "linux");
  assert.equal(detectAssetId("Linux armv8l", "Android 15"), null);
  assert.equal(detectAssetId("", "unknown"), null);
});

test("the published catalog includes the AutoTrip workflow GIF", () => {
  assert.equal(catalog.apps[0].demoGif, "./assets/autotrip-workflow.gif");
  assert.match(catalog.apps[0].demoAlt, /실제 AutoTrip 프로그램/);
  assert.match(catalog.apps[0].demoAlt, /마이리얼트립 국내선 페이지/);
  assert.match(catalog.apps[0].demoAlt, /결제 전에 멈추는 과정/);
  assert.match(catalog.apps[0].demoCaption, /프로그램의 실행 화면부터/);
  assert.match(catalog.apps[0].demoCaption, /실제 결제 버튼은 누르지 않았습니다/);
});

test("[REG:hosting.cloudflare_static_assets] Cloudflare serves generated assets through the inquiry Worker", async () => {
  const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  assert.equal(config.name, "nohdol-auto-showcase");
  assert.equal(config.main, "./src/worker.mjs");
  assert.equal(config.assets.directory, "./_site");
  assert.equal(config.assets.binding, "ASSETS");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
  assert.equal(config.assets.not_found_handling, "404-page");
});

test("the legacy GitHub Pages bridge uses current action runtimes", async () => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  assert.match(workflow, /actions\/configure-pages@v6/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
});

test("[REG:hosting.legacy_redirect] legacy GitHub Pages routes preserve path, query, and hash on Cloudflare", async () => {
  const source = await readFile(path.join(root, "site", "legacy-redirect.js"), "utf8");
  const replacements = [];
  const context = {
    window: {
      location: {
        origin: "https://nohdol97.github.io",
        pathname: "/nohdol-auto-showcase/install/autotrip/",
        search: "?from=legacy",
        hash: "#download",
        replace(value) { replacements.push(value); },
      },
    },
    URL,
  };
  vm.runInNewContext(source, context);
  assert.deepEqual(replacements, [
    "https://nohdol-auto-showcase.nohdol-auto-download-gateway.workers.dev/install/autotrip/?from=legacy#download",
  ]);

  context.window.location.origin = "https://nohdol-auto-showcase.nohdol-auto-download-gateway.workers.dev";
  vm.runInNewContext(source, context);
  assert.equal(replacements.length, 1);
});

test("the public UI follows the restrained nohdol-clean profile", async () => {
  const template = await readFile(path.join(root, "site", "index.html"), "utf8");
  const styles = await readFile(path.join(root, "site", "styles.css"), "utf8");
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  assert.match(template, /name="theme-color" content="#F5F7FA"/);
  assert.doesNotMatch(template, /class="ambient/);
  assert.match(styles, /--canvas: #f5f7fa/);
  assert.match(styles, /--accent: #315e9e/);
  assert.match(styles, /border-radius: 6px/);
  assert.doesNotMatch(styles, /gradient|backdrop-filter|filter: blur|transition: all/i);
  assert.match(appScript, /실제 프로그램 · 실제 사이트 · 결제 전 안전 정지/);
  assert.match(appScript, /status\.dataset\.state = "busy"/);
  assert.match(appScript, /status\.dataset\.state = "error"/);
});

test("the catalog presents product-specific workflows in plain Korean", async () => {
  const template = await readFile(path.join(root, "site", "index.html"), "utf8");
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  assert.match(template, /한결/);
  assert.match(appScript, /매일의 반복은/);
  assert.match(appScript, /한결 가볍게/);
  assert.match(appScript, /되풀이하는 일을 줄여 중요한 업무에 집중/);
  assert.match(appScript, /기능만 되는 투박한/);
  assert.match(appScript, /experienceTitle\.append\(document\.createElement\("br"\)/);
  assert.match(appScript, /도구로 끝내지 않습니다/);
  assert.match(appScript, /프로그램 소개/);
  assert.match(appScript, /화면 데모/);
  assert.match(appScript, /설치 페이지 제공/);
  assert.doesNotMatch(`${template}\n${appScript}`, /nohdol auto|데스크톱 자동화|자동화 프로그램|사용할 자동화/i);
  assert.doesNotMatch(appScript, /UI 콘셉트|UI 프로토타입|임시 포트폴리오|향후 교체/);
  assert.doesNotMatch(appScript, /PyInstaller|Electron|React|TypeScript|프레임워크/);
});

test("[REG:hosting.generated_routes] build creates catalog, detail, and installation routes without an authentication code", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-pages-"));
  const output = path.join(temporary, "site");
  await buildSite({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const installIndex = await readFile(path.join(output, "install", "index.html"), "utf8");
  const detailRoute = await readFile(path.join(output, "apps", "autotrip", "index.html"), "utf8");
  const installRoute = await readFile(path.join(output, "install", "autotrip", "index.html"), "utf8");
  const appScript = await readFile(path.join(output, "app.js"), "utf8");
  const platformScript = await readFile(path.join(output, "platform.js"), "utf8");
  const generated = await readFile(path.join(output, "apps.json"), "utf8");
  const demoGif = await readFile(path.join(output, "assets", "autotrip-workflow.gif"));
  assert.match(html, /data-page="catalog"/);
  assert.match(installIndex, /data-page="install-index"/);
  assert.match(installIndex, /<base href="\.\.\/"/);
  assert.match(detailRoute, /data-page="detail" data-app-id="autotrip"/);
  assert.match(installRoute, /data-page="install" data-app-id="autotrip"/);
  assert.match(installRoute, /<base href="\.\.\/\.\.\/"/);
  assert.match(appScript, /설치 인증코드/);
  assert.match(appScript, /설치 인증코드 필요/);
  assert.match(appScript, /app\.assets\.some/);
  assert.match(platformScript, /"windows"/);
  assert.match(generated, /"defaultAssetId": "windows"/);
  assert.match(appScript, /제품키는 설치한 앱의 제품키 입력란에서만 사용합니다/);
  assert.match(appScript, /공개 설명/);
  assert.match(appScript, /인증 설치/);
  assert.match(generated, /설치 인증코드와 별도로 전달받은 일회용 제품키/);
  assert.doesNotMatch(generated, /\/admin\/|product-keys|ADMIN_API_KEY/);
  assert.doesNotMatch(appScript, /배포 준비됨/);
  assert.doesNotMatch(html, /AUTOTRIP \/ SAFE MODE|AutoTrip 살펴보기/);
  assert.doesNotMatch(generated, /INSTALL_ACCESS_CODE|releases\/download|browser_download_url/);
  assert.equal(demoGif.subarray(0, 6).toString("ascii"), "GIF89a");
});

test("adding catalog metadata automatically creates routes for another program", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-multi-app-"));
  const source = structuredClone(catalog);
  source.apps.push({
    ...source.apps[0],
    id: "sample-monitor",
    name: "Sample Monitor",
    demoGif: null,
    demoAlt: null,
    demoCaption: null,
  });
  const catalogPath = path.join(temporary, "apps.json");
  const output = path.join(temporary, "site");
  await writeFile(catalogPath, JSON.stringify(source));
  await buildSite({ catalog: catalogPath, site: path.join(root, "site"), output });
  const detailRoute = await readFile(path.join(output, "apps", "sample-monitor", "index.html"), "utf8");
  const installRoute = await readFile(path.join(output, "install", "sample-monitor", "index.html"), "utf8");
  assert.match(detailRoute, /data-app-id="sample-monitor"/);
  assert.match(detailRoute, /Sample Monitor — 한결/);
  assert.match(installRoute, /Sample Monitor 설치 — 한결/);
});

test("the catalog contains ten disclosed standalone program demos across three audiences", () => {
  const prototypes = catalog.apps.filter((app) => app.kind === "prototype");
  assert.equal(prototypes.length, 10);
  assert.deepEqual(new Set(prototypes.map((app) => app.audience)), new Set(["개인 업무", "대기업", "전문직"]));
  for (const app of prototypes) {
    assert.equal(app.authEndpoint, null);
    assert.equal(app.installPreview, true);
    assert.match(app.demoLabel, /기능 시연 화면/);
    assert.match(app.demoLabel, /외부 시스템 미연동/);
    assert.match(app.availabilityNote, /설치 페이지를 제공/);
    assert.match(app.availabilityNote, /설치 파일과 인증코드는 현재 제공되지 않습니다/);
    assert.equal(app.defaultAssetId, "windows");
    assert.deepEqual(app.assets.map((asset) => asset.id), ["macos", "windows", "linux"]);
    assert.doesNotMatch(JSON.stringify(app), /UI 콘셉트|UI 프로토타입|임시 UI 포트폴리오/);
  }
});

test("demo validation requires a disabled install preview and rejects a live endpoint", () => {
  const prototype = structuredClone(catalog.apps.find((app) => app.kind === "prototype"));
  delete prototype.availabilityNote;
  assert.throws(() => validateCatalog({ schemaVersion: 3, apps: [prototype] }), /truthful disabled install preview/);

  const connected = structuredClone(catalog.apps.find((app) => app.kind === "prototype"));
  connected.authEndpoint = "https://downloads.example/authorize";
  assert.throws(() => validateCatalog({ schemaVersion: 3, apps: [connected] }), /truthful disabled install preview/);
});

test("demo entries generate detail, GIF, and non-downloadable install preview routes", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-prototypes-"));
  const output = path.join(temporary, "site");
  await buildSite({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
  for (const app of catalog.apps.filter((item) => item.kind === "prototype")) {
    const detailRoute = await readFile(path.join(output, "apps", app.id, "index.html"), "utf8");
    const installRoute = await readFile(path.join(output, "install", app.id, "index.html"), "utf8");
    const demoGif = await readFile(path.join(output, "assets", `${app.id}-workflow.gif`));
    assert.match(detailRoute, new RegExp(`data-app-id="${app.id}"`));
    assert.match(installRoute, new RegExp(`data-page="install" data-app-id="${app.id}"`));
    assert.equal(demoGif.subarray(0, 6).toString("ascii"), "GIF89a");
  }
  const appScript = await readFile(path.join(output, "app.js"), "utf8");
  assert.match(appScript, /if \(!app\.authEndpoint\) return/);
  assert.match(appScript, /submit\.disabled = !app\.authEndpoint/);
  assert.match(appScript, /설치 페이지 제공/);
  assert.doesNotMatch(appScript, /설치 준비 중|배포 준비 중/);
});
