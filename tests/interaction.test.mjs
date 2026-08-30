import test from "node:test";
import assert from "node:assert/strict";
import { buildDossierSearchDocument, buildSearchDocument, deriveData, eventMatches, normalizeText, sanitizeState } from "../scripts/site-core.mjs";
import { loadData } from "../scripts/validate-data.mjs";

async function contextFixture() {
  const data = await loadData();
  const context = deriveData(data);
  context.searchDocuments = new Map(data.events.map((event) => [event.id, buildSearchDocument(event, context)]));
  return { data, context };
}

test("search handles English, Chinese, full-width W-number, version, year, and product", async () => {
  const { data, context } = await contextFixture();
  const matches = (query) => data.events.filter((event) => eventMatches(event, { year: "all", product: "all", category: "all", release: "all", status: "all", search: query }, context));
  assert.ok(matches("workspace").length > 0);
  assert.ok(matches("繁體中文").length > 0);
  assert.ok(matches("Ｗ１９").some((event) => event.id.includes("w19")));
  assert.ok(matches("v2.0.1").some((event) => event.releaseId === "release-v2.0.1"));
  assert.equal(matches("2026").length, data.events.length);
  assert.ok(matches("Key Finder").length > 0);
  assert.equal(normalizeText("  ＫＥＹ　Finder "), "key finder");
});

test("query tokens use AND matching", async () => {
  const { data, context } = await contextFixture();
  const state = { year: "all", product: "all", category: "all", release: "all", status: "all", search: "workspace v1.3.0" };
  const results = data.events.filter((event) => eventMatches(event, state, context));
  assert.deepEqual(results.map((event) => event.releaseId), ["release-v1.3.0"]);
});

test("authoritative filters combine", async () => {
  const { data, context } = await contextFixture();
  const state = { year: "2026", product: "product-song-workspace", category: "release", release: "release-v1.2.0", status: "released", search: "interface" };
  const results = data.events.filter((event) => eventMatches(event, state, context));
  assert.equal(results.length, 1);
  assert.equal(results[0].releaseId, "release-v1.2.0");
});

test("invalid URL parameters fall back safely", () => {
  const options = {
    year: new Set(["all", "2026"]), product: new Set(["all", "product-homepage"]),
    category: new Set(["all", "product"]), release: new Set(["all", "release-v2.0.1"]),
    status: new Set(["all", "released"])
  };
  const state = sanitizeState({ year: "1999", product: "private", category: "bad", release: "bad", status: "bad", lang: "invalid" }, options);
  assert.deepEqual({ year: state.year, product: state.product, category: state.category, release: state.release, status: state.status, lang: state.lang }, { year: "all", product: "all", category: "all", release: "all", status: "all", lang: "en" });
});

test("dossier search documents expose product, design, and architecture terms", async () => {
  const data = await loadData();
  const products = new Map(data.products.map((product) => [product.id, product]));
  const documents = new Map(data.dossiers.map((dossier) => [dossier.slug, buildDossierSearchDocument(dossier, products.get(dossier.productId))]));
  assert.match(documents.get("chord-dictionary"), /chord diagrams|guitar-chord reference/);
  assert.match(documents.get("chord-dictionary"), /responsive/);
  assert.match(documents.get("song-workspace"), /performance mode/);
  assert.match(documents.get("key-finder"), /cloudflare/);
  assert.match(documents.get("key-finder"), /render compute/);
});
