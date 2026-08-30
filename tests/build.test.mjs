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
