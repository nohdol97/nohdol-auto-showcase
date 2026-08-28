import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
  assert.throws(() => validateCatalog(invalid), /alt text and caption/);
});

test("build writes only public app metadata and never an authentication code", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "showcase-pages-"));
  const output = path.join(temporary, "site");
  await buildPages({ catalog: path.join(root, "apps.json"), site: path.join(root, "site"), output });
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const generated = await readFile(path.join(output, "apps.json"), "utf8");
  assert.match(html, /프로그램별 인증코드/);
  assert.doesNotMatch(generated, /INSTALL_ACCESS_CODE|releases\/download|browser_download_url/);
});
