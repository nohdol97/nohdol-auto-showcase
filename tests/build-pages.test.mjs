import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { buildPages, validateCatalog } from "../scripts/build-pages.mjs";

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

test("Pages deployment uses the current Node 24 action runtimes", async () => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  assert.match(workflow, /actions\/configure-pages@v6/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
});

test("build creates catalog, detail, and installation routes without an authentication code", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-pages-"));
  const output = path.join(temporary, "site");
  await buildPages({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
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
  await buildPages({ catalog: catalogPath, site: path.join(root, "site"), output });
  const detailRoute = await readFile(path.join(output, "apps", "sample-monitor", "index.html"), "utf8");
  const installRoute = await readFile(path.join(output, "install", "sample-monitor", "index.html"), "utf8");
  assert.match(detailRoute, /data-app-id="sample-monitor"/);
  assert.match(detailRoute, /Sample Monitor — nohdol auto/);
  assert.match(installRoute, /Sample Monitor 설치 — nohdol auto/);
});
