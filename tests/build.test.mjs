import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSite } from "../scripts/build.mjs";

test("build creates complete progressive-enhancement and print output", async () => {
  const { data } = await buildSite();
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const print = await readFile(new URL("../dist/print.html", import.meta.url), "utf8");
  assert.match(index, /Jam Tracks Hub begins/);
  assert.match(index, /Jam Tracks Hub 正式起步/);
  assert.match(index, /Traditional Chinese support arrives/);
  assert.match(index, /data-lang-copy="zh-TW"/);
  assert.match(index, /id="theme-toggle"/);
  assert.match(index, /jam-tracks-hub-log-theme/);
  assert.match(index, /Dark mode/);
  assert.match(index, /\.\/assets\/site\.css/);
  assert.match(index, /\.\/assets\/app\.js/);
  assert.doesNotMatch(index, /\/Users\//);
  assert.doesNotMatch(index, /href="\/assets\//);
  assert.equal((index.match(/<h1/g) || []).length, 1);
  for (const event of data.events) assert.match(print, new RegExp(event.id));
  for (const release of data.releases) assert.match(print, new RegExp(release.id.replaceAll(".", "\\.")));
  assert.doesNotMatch(print, /Future Roadmap/);
  assert.doesNotMatch(print, /<script/);
});

test("generated index contains meaningful history before JavaScript runs", async () => {
  await buildSite();
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.ok((index.match(/class="event-card/g) || []).length >= 20);
  assert.match(index, /No published GitHub Release/);
  assert.match(index, /Created in Git/);
  assert.match(index, /First published/);
  assert.match(index, /event-20260830-typography-rollback/);
});

test("build generates stable bilingual product dossier routes with correct base paths", async () => {
  const { data } = await buildSite();
  for (const dossier of data.dossiers) {
    const html = await readFile(new URL(`../dist/products/${dossier.slug}/index.html`, import.meta.url), "utf8");
    assert.match(html, /\.\.\/\.\.\/assets\/site\.css/);
    assert.match(html, /\.\.\/\.\.\/assets\/dossier\.css/);
    assert.match(html, /data-lang-copy="zh-TW"/);
    assert.match(html, /id="print-dossier"/);
    assert.match(html, new RegExp(`product=${dossier.productId}`));
    assert.equal((html.match(/<h1/g) || []).length, 1);
    assert.doesNotMatch(html, /\/Users\//);
  }
});

test("Chord Dictionary dossier is a substantive evidence-labeled retrospective", async () => {
  await buildSite();
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const dossier = await readFile(new URL("../dist/products/chord-dictionary/index.html", import.meta.url), "utf8");
  assert.match(index, /\.\/products\/chord-dictionary\//);
  assert.match(index, /data-product-history="product-chord-dictionary"/);
  assert.match(dossier, /Page design &amp; information architecture/);
  assert.match(dossier, /Technical structure/);
  assert.match(dossier, /Responsive strategy/);
  assert.match(dossier, /Decisions &amp; trade-offs/);
  assert.match(dossier, /Regressions &amp; corrections/);
  assert.match(dossier, /classification-verified/);
  assert.match(dossier, /classification-reconstructed/);
  assert.match(dossier, /classification-unknown/);
  assert.match(dossier, /commit\/a901651/);
});

test("related dossier history and releases resolve from canonical records", async () => {
  await buildSite();
  const workspace = await readFile(new URL("../dist/products/song-workspace/index.html", import.meta.url), "utf8");
  assert.match(workspace, /event-20260828-song-workspace-v1/);
  assert.match(workspace, /release-v1\.3\.0/);
  assert.match(workspace, /Performance Mode/);
  assert.doesNotMatch(workspace, /\/Users\//);
});

test("dossier responsive and print contracts cover the acceptance matrix", async () => {
  const css = await readFile(new URL("../src/styles/dossier.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media print/);
  assert.match(css, /minmax\(0, 1fr\)/);
  const widths = [375, 390, 430, 768, 820, 834, 1024, 1180, 1194, 1280, 1440];
  const modes = widths.map((width) => width <= 620 ? "mobile" : width <= 900 ? "tablet" : "desktop");
  assert.deepEqual(modes, ["mobile", "mobile", "mobile", "tablet", "tablet", "tablet", "desktop", "desktop", "desktop", "desktop", "desktop"]);
});

test("dossier print hides the screen-only skip link while preserving its accessible target", async () => {
  await buildSite();
  const dossier = await readFile(new URL("../dist/products/chord-dictionary/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../dist/assets/dossier.css", import.meta.url), "utf8");

  assert.match(dossier, /<a class="skip-link" href="#dossier-content">/);
  assert.match(dossier, /<article class="dossier-content" id="dossier-content">/);
  assert.match(css, /@media print\s*{[^}]*\.dossier-page \.skip-link[^}]*display:\s*none\s*!important;/s);
});

test("build exposes the v2.0.5 boundary through timeline, deep links, releases, and print", async () => {
  await buildSite();
  const index = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const print = await readFile(new URL("../dist/print.html", import.meta.url), "utf8");
  for (const id of [
    "event-20260831-release-v2-0-2",
    "event-20260903-release-v2-0-3",
    "event-20260903-release-v2-0-4",
    "event-20260904-key-finder-vue-migration",
    "event-20260904-song-workspace-vue-migration",
    "event-20260905-release-v2-0-5"
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
    assert.match(print, new RegExp(`id="${id}"`));
  }
  assert.match(index, /id="release-v2\.0\.5"/);
  assert.match(index, /href="#event-20260905-release-v2-0-5"/);
  assert.match(print, /v2\.0\.5 — Vue frontend migration complete/);
});
