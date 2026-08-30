import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { buildSite, validateCatalog } from "../scripts/build-site.mjs";
import showcaseWorker from "../src/worker.mjs";

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
  assert.match(catalog.apps[0].demoAlt, /AutoTrip 프로그램/);
  assert.match(catalog.apps[0].demoAlt, /마이리얼트립 국내선 페이지/);
  assert.match(catalog.apps[0].demoAlt, /결제 전에 멈추는 과정/);
  assert.match(catalog.apps[0].demoCaption, /AutoTrip 실행 화면부터/);
  assert.match(catalog.apps[0].demoCaption, /결제 버튼은 누르지 않았습니다/);
});

test("[REG:hosting.cloudflare_static_assets] Cloudflare serves generated assets through the inquiry Worker", async () => {
  const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  assert.equal(config.name, "nohdol-auto-showcase");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.main, "./src/worker.mjs");
  assert.equal(config.assets.directory, "./_site");
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.not_found_handling, "404-page");
});

test("[REG:hosting.custom_domain] apex is primary and www redirects without dropping the route", async () => {
  const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  assert.deepEqual(config.routes, [
    { pattern: "byabalone.com", custom_domain: true },
    { pattern: "www.byabalone.com", custom_domain: true },
  ]);
  const response = await showcaseWorker.fetch(new Request("https://www.byabalone.com/install/autotrip/?from=www"), {}, {});
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("Location"), "https://byabalone.com/install/autotrip/?from=www");
});

test("[REG:seo.canonical_origin] HTTP and retained Workers origins cannot compete with the canonical host", async () => {
  const insecure = await showcaseWorker.fetch(new Request("http://byabalone.com/apps/autotrip/?from=http"), {}, {});
  assert.equal(insecure.status, 308);
  assert.equal(insecure.headers.get("Location"), "https://byabalone.com/apps/autotrip/?from=http");

  const retained = await showcaseWorker.fetch(
    new Request("https://nohdol-auto-showcase.example.workers.dev/apps/autotrip/"),
    { ASSETS: { fetch: async () => new Response("<!doctype html><title>compat</title>", { headers: { "Content-Type": "text/html" } }) } },
    {},
  );
  assert.equal(retained.status, 200);
  assert.equal(retained.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(retained.headers.get("Link"), '<https://byabalone.com/apps/autotrip/>; rel="canonical"');
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
    "https://byabalone.com/install/autotrip/?from=legacy#download",
  ]);

  context.window.location.origin = "https://byabalone.com";
  vm.runInNewContext(source, context);
  assert.equal(replacements.length, 1);
});

test("[REG:showcase.abalone_brand] the public UI layers Abalone identity over nohdol-clean", async () => {
  const template = await readFile(path.join(root, "site", "index.html"), "utf8");
  const styles = await readFile(path.join(root, "site", "styles.css"), "utf8");
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  assert.match(template, /name="theme-color" content="#111111"/);
  assert.match(template, /class="skip-link" href="#page">본문으로 건너뛰기/);
  assert.doesNotMatch(template, /class="ambient/);
  for (const token of ["--brand-canvas", "--brand-ink", "--brand-accent", "--brand-accent-strong", "--brand-accent-soft", "--brand-focus"]) {
    assert.match(styles, new RegExp(token));
  }
  assert.match(styles, /--brand-accent: #111111/);
  assert.match(styles, /--accent: var\(--brand-accent\)/);
  assert.match(styles, /outline: 3px solid var\(--brand-focus\)/);
  assert.match(styles, /border-radius: 6px/);
  for (const match of styles.matchAll(/#([0-9a-f]{6})/gi)) {
    const channels = [match[1].slice(0, 2), match[1].slice(2, 4), match[1].slice(4, 6)];
    assert.equal(new Set(channels).size, 1, `non-grayscale CSS color: ${match[0]}`);
  }
  for (const match of styles.matchAll(/rgb\((\d+) (\d+) (\d+)/g)) {
    assert.equal(new Set(match.slice(1, 4)).size, 1, `non-grayscale CSS rgb color: ${match[0]}`);
  }
  assert.doesNotMatch(styles, /\.workflow-image\s*\{[^}]*\bfilter\s*:/s);
  assert.doesNotMatch(styles, /gradient|backdrop-filter|filter: blur|transition: all/i);
  assert.match(appScript, /"product-mark"/);
  assert.doesNotMatch(appScript, /element\("div", "brand-mark", app\.name/);
  assert.match(appScript, /프로그램 흐름 · 결제 전 안전 정지/);
  assert.match(appScript, /status\.dataset\.state = "busy"/);
  assert.match(appScript, /status\.dataset\.state = "error"/);
});

test("[REG:showcase.brand_icon] the Abalone mark is font-independent and ships in browser icon formats", async () => {
  const template = await readFile(path.join(root, "site", "index.html"), "utf8");
  const svg = await readFile(path.join(root, "site", "favicon.svg"), "utf8");
  const manifest = JSON.parse(await readFile(path.join(root, "site", "site.webmanifest"), "utf8"));
  const faviconPng = await readFile(path.join(root, "site", "favicon-32.png"));
  const appleTouchIcon = await readFile(path.join(root, "site", "apple-touch-icon.png"));
  const icon192 = await readFile(path.join(root, "site", "icon-192.png"));
  const icon512 = await readFile(path.join(root, "site", "icon-512.png"));
  const legacyIcon = await readFile(path.join(root, "site", "favicon.ico"));

  assert.match(template, /<title>Abalone — 업무 맞춤 프로그램 제작<\/title>/);
  assert.match(template, /rel="icon" href="\.\/favicon\.svg\?v=black-white" type="image\/svg\+xml"/);
  assert.match(template, /rel="alternate icon" href="\.\/favicon\.ico\?v=black-white"/);
  assert.match(template, /rel="apple-touch-icon" href="\.\/apple-touch-icon\.png\?v=black-white"/);
  assert.match(template, /rel="manifest" href="\.\/site\.webmanifest\?v=black-white"/);
  assert.equal([...template.matchAll(/class="brand-mark" src="\.\/favicon\.svg\?v=black-white"/g)].length, 2);
  assert.match(svg, /viewBox="0 0 32 32"/);
  assert.match(svg, /fill="#111111"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.doesNotMatch(svg, /<text|gradient|<image/i);

  for (const [contents, size] of [[faviconPng, 32], [appleTouchIcon, 180], [icon192, 192], [icon512, 512]]) {
    assert.equal(contents.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(contents.readUInt32BE(16), size);
    assert.equal(contents.readUInt32BE(20), size);
  }
  assert.equal(legacyIcon.subarray(0, 4).toString("hex"), "00000100");
  assert.equal(manifest.name, "Abalone");
  assert.equal(manifest.background_color, "#f5f5f5");
  assert.equal(manifest.theme_color, "#111111");
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ["./icon-192.png?v=black-white", "./icon-512.png?v=black-white"]);
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
});

test("[REG:showcase.domain_embedded_positioning] the catalog explains remote domain-shaped delivery in plain Korean", async () => {
  const template = await readFile(path.join(root, "site", "index.html"), "utf8");
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  const styles = await readFile(path.join(root, "site", "styles.css"), "utf8");
  assert.match(template, /Abalone/);
  assert.match(appScript, /업무 가까이에서 만드는 프로그램/);
  assert.match(appScript, /복잡한 일을 이해하고/);
  assert.match(appScript, /쓸 수 있는 흐름으로/);
  assert.match(appScript, /정리합니다/);
  assert.match(appScript, /mobile-title-break/);
  assert.match(appScript, /업종마다 사람, 규칙, 예외/);
  assert.match(appScript, /업무 이해/);
  assert.match(appScript, /작은 검증/);
  assert.match(appScript, /적용과 개선/);
  assert.match(appScript, /원격 밀착 협업/);
  assert.match(appScript, /프로그램 상담 시작/);
  assert.match(appScript, /new URL\("\?inquiry=open", document\.baseURI\)\.href/);
  assert.match(template, /어떤 업종에서 누가 어떤 순서로 일하는지/);
  assert.match(appScript, /설치 안내/);
  assert.match(styles, /\.mobile-title-break\s*\{[^}]*display: none;/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.mobile-title-break\s*\{[^}]*display: block;/s);
  assert.doesNotMatch(`${template}\n${appScript}`, /FDE|상주 개발|상주 인력|nohdol auto|데스크톱 자동화|자동화 프로그램|사용할 자동화/i);
  assert.doesNotMatch(appScript, /UI 콘셉트|UI 프로토타입|임시 포트폴리오|향후 교체/);
  assert.doesNotMatch(appScript, /PyInstaller|Electron|React|TypeScript|프레임워크/);
});

test("[REG:showcase.availability_truth] the home hides internal kinds while routes retain concrete availability", async () => {
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  assert.doesNotMatch(appScript, /실제 연동|기능 데모|기능 시연 화면|파일 없음/);
  assert.doesNotMatch(appScript, /verifiedApps|demoApps|program-group/);
  assert.match(appScript, /catalog\.apps\.forEach\(\(app, index\) => list\.append\(renderCatalogCard\(app, index\)\)\)/);
  assert.match(appScript, /설치 파일과 인증코드는 현재 제공되지 않습니다/);
  assert.match(appScript, /app\.availabilityNote/);
  assert.match(appScript, /submit\.disabled = !app\.authEndpoint/);
  assert.match(appScript, /if \(!app\.authEndpoint\) return/);
});

test("[REG:showcase.catalog_unified_alignment] catalog cards share one grid and a bottom action baseline", async () => {
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  const styles = await readFile(path.join(root, "site", "styles.css"), "utf8");
  assert.match(appScript, /element\("div", "app-list catalog-list"\)/);
  assert.match(styles, /\.catalog-card\s*\{[^}]*grid-template-columns: 32px minmax\(0, 1fr\);[^}]*align-items: stretch;/s);
  assert.match(styles, /\.catalog-copy\s*\{[^}]*display: flex;[^}]*height: 100%;[^}]*flex-direction: column;/s);
  assert.match(styles, /\.catalog-actions\s*\{[^}]*margin-top: auto;/s);
  assert.doesNotMatch(styles, /\.workflow-image\s*\{[^}]*\bfilter\s*:/s);
});

test("[REG:showcase.reduced_motion] every workflow GIF has a reduced-motion poster", async () => {
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  const styles = await readFile(path.join(root, "site", "styles.css"), "utf8");
  assert.match(appScript, /prefers-reduced-motion: reduce/);
  assert.match(appScript, /-poster\.png/);
  assert.match(appScript, /contains\("detail-shell"\) \? "eager" : "lazy"/);
  assert.match(styles, /aspect-ratio: 30 \/ 19/);
  for (const app of catalog.apps.filter((item) => item.demoGif)) {
    const poster = app.demoGif.replace(/^\.\//, "site/").replace(/\.gif$/i, "-poster.png");
    const contents = await readFile(path.join(root, poster));
    assert.equal(contents.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
});

test("[REG:showcase.recovery_states] catalog failure exposes a focused plain-Korean retry", async () => {
  const appScript = await readFile(path.join(root, "site", "app.js"), "utf8");
  const styles = await readFile(path.join(root, "site", "styles.css"), "utf8");
  assert.match(appScript, /function renderLoadError/);
  assert.match(appScript, /role", "alert"/);
  assert.match(appScript, /프로그램 목록을 불러오지 못했습니다/);
  assert.match(appScript, /다시 불러오기/);
  assert.match(appScript, /window\.location\.reload/);
  assert.match(appScript, /title\.focus\(\)/);
  assert.match(styles, /\.inquiry-dialog[\s\S]*height: fit-content/);
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
  const demoPoster = await readFile(path.join(output, "assets", "autotrip-workflow-poster.png"));
  assert.match(html, /data-page="catalog"/);
  assert.match(installIndex, /data-page="install-index"/);
  assert.match(installIndex, /<base href="\.\.\/"/);
  assert.match(detailRoute, /data-page="detail" data-app-id="autotrip"/);
  assert.match(installRoute, /data-page="install" data-app-id="autotrip"/);
  assert.match(installRoute, /<base href="\.\.\/\.\.\/"/);
  assert.match(appScript, /설치 인증코드/);
  assert.doesNotMatch(appScript, /설치 인증코드 필요/);
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
  assert.equal(demoPoster.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("[REG:seo.static_discovery] generated routes expose crawlable initial HTML, canonical metadata, sitemap, and truthful schema", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-seo-"));
  const output = path.join(temporary, "site");
  await buildSite({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
  const home = await readFile(path.join(output, "index.html"), "utf8");
  const product = await readFile(path.join(output, "apps", "autotrip", "index.html"), "utf8");
  const prototype = await readFile(path.join(output, "apps", "life-admin", "index.html"), "utf8");
  const prototypeInstall = await readFile(path.join(output, "install", "life-admin", "index.html"), "utf8");
  const robots = await readFile(path.join(output, "robots.txt"), "utf8");
  const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
  const notFound = await readFile(path.join(output, "404.html"), "utf8");

  assert.match(home, /<main id="page"[^>]*>[\s\S]*<h1[^>]*>[^<]+/);
  assert.match(home, /복잡한 일을 이해하고/);
  const description = home.match(/<meta name="description" content="([^"]+)" \/>/)?.[1];
  const openGraphDescription = home.match(/<meta property="og:description" content="([^"]+)" \/>/)?.[1];
  assert.ok(description, "home description metadata should exist");
  assert.equal(
    description,
    "업무 흐름을 이해하고 필요한 맞춤 프로그램을 작은 범위부터 검증합니다. 제작 사례와 안전한 설치 안내, 프로그램 상담 방법을 확인하세요.",
  );
  assert.equal(openGraphDescription, description);
  assert.ok(
    [...description].length <= 80,
    `home description exceeds 80 characters: ${[...description].length}`,
  );
  assert.match(home, /<link rel="canonical" href="https:\/\/byabalone\.com\/"/);
  assert.match(home, /<meta property="og:title"/);
  assert.match(home, /<a[^>]+href="\.\/privacy\/"[^>]*>개인정보 처리방침<\/a>/);
  assert.match(home, /<a[^>]+href="\.\/terms\/"[^>]*>이용약관<\/a>/);
  assert.match(product, /<link rel="canonical" href="https:\/\/byabalone\.com\/apps\/autotrip\/"/);
  assert.match(product, new RegExp(catalog.apps[0].description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(product, /"@type":"SoftwareApplication"/);
  assert.doesNotMatch(prototype, /"@type":"SoftwareApplication"/);
  assert.match(prototype, /외부 시스템 미연동/);
  assert.match(prototypeInstall, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/byabalone\.com\/sitemap\.xml$/m);
  assert.match(sitemap, /<loc>https:\/\/byabalone\.com\/apps\/autotrip\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/byabalone\.com\/privacy\/<\/loc>/);
  assert.doesNotMatch(sitemap, /<loc>https:\/\/byabalone\.com\/install\/life-admin\/<\/loc>/);
  assert.match(notFound, /<meta name="robots" content="noindex, nofollow"/);

  for (const match of home.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)) JSON.parse(match[1]);
});

test("[REG:seo.naver_site_ownership] homepage publishes the exact Naver verification meta", async () => {
  const template = await readFile(path.join(root, "site", "index.html"), "utf8");
  const expected = '<meta name="naver-site-verification" content="f803f7dcf0277c0a4616bb36c12e4215b00e541a" />';
  const head = template.slice(template.indexOf("<head>"), template.indexOf("</head>"));
  assert.match(head, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-naver-verification-"));
  const output = path.join(temporary, "site");
  await buildSite({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
  const generated = await readFile(path.join(output, "index.html"), "utf8");
  const generatedHead = generated.slice(generated.indexOf("<head>"), generated.indexOf("</head>"));
  assert.match(generatedHead, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("[REG:legal.public_notices] privacy, terms, and consent surfaces match the implemented inquiry lifecycle", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-legal-"));
  const output = path.join(temporary, "site");
  await buildSite({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
  const privacy = await readFile(path.join(output, "privacy", "index.html"), "utf8");
  const terms = await readFile(path.join(output, "terms", "index.html"), "utf8");
  const template = await readFile(path.join(output, "index.html"), "utf8");
  const client = await readFile(path.join(output, "inquiry.js"), "utf8");
  const core = await readFile(path.join(root, "src", "inquiry-core.mjs"), "utf8");

  for (const text of ["이메일", "대화 내용", "첨부 파일", "접속 정보", "Cloudflare", "OpenAI", "Resend", "90일", "1년", "30일", "국외", "삭제", "열람", "inquiry@mail.byabalone.com"]) assert.match(privacy, new RegExp(text));
  for (const text of ["문의", "계약이 아닙니다", "견적", "프로토타입", "설치 파일", "준거법", "분쟁", "inquiry@mail.byabalone.com"]) assert.match(terms, new RegExp(text));
  assert.match(template, /<strong>필수<\/strong>\s*개인정보/);
  assert.match(template, /<strong>선택<\/strong>\s*문의 이메일로 새 프로그램과 서비스 소식/);
  assert.match(template, /href="\.\/privacy\/"/);
  assert.match(template, /href="\.\/terms\/"/);
  assert.match(client, /2026-08-31-abalone-privacy/);
  assert.match(core, /2026-08-31-abalone-privacy/);
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
  assert.match(detailRoute, /Sample Monitor 제작 사례 — Abalone/);
  assert.match(installRoute, /Sample Monitor 설치 안내 — Abalone/);
});

test("[REG:seo.legacy_bridge] the GitHub Pages compatibility artifact is noindexed", async () => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  const script = await readFile(path.join(root, "scripts", "build-legacy-site.mjs"), "utf8");
  assert.match(workflow, /npm run build && npm run build:legacy/);
  assert.match(script, /noindex, nofollow/);
  assert.match(script, /Disallow: \/nohdol-auto-showcase\//);
});

test("the catalog contains ten disclosed standalone program demos across three audiences", () => {
  const prototypes = catalog.apps.filter((app) => app.kind === "prototype");
  assert.equal(prototypes.length, 10);
  assert.deepEqual(new Set(prototypes.map((app) => app.audience)), new Set(["개인 업무", "대기업", "전문직"]));
  for (const app of prototypes) {
    assert.equal(app.authEndpoint, null);
    assert.equal(app.installPreview, true);
    assert.match(app.demoLabel, /예시/);
    assert.doesNotMatch(app.demoLabel, /기능 시연|기능 데모/);
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
  assert.match(appScript, /설치 안내/);
  assert.doesNotMatch(appScript, /실제 연동|기능 데모|기능 시연 화면|파일 없음/);
  assert.doesNotMatch(appScript, /설치 준비 중|배포 준비 중/);
});
