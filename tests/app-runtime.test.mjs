import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// A small DOM adapter executes the shipped runtime, including event ordering.
// Layout and native controls are checked separately in the browser matrix.
async function fixture(query = "") {
  const locales = Object.fromEntries(await Promise.all(["en", "zh-TW"].map(async (lang) => [lang, JSON.parse(await readFile(new URL(`../src/locales/${lang}.json`, import.meta.url)))])));
  const element = (dataset = {}) => ({
    dataset, value: "all", textContent: "", children: [], attributes: {}, listeners: {}, hidden: false,
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    dispatch(type) { this.listeners[type]?.({ target: this }); },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    focus() { this.focused = true; }
  });
  const options = { years: ["2026"], products: ["product-song-workspace"], categories: ["release"], releases: ["release-v2.0.5"], statuses: ["released"] };
  const optionLabels = {
    products: { "product-song-workspace": { en: "Song Workspace", "zh-TW": "歌曲工作區" } },
    categories: { release: { en: "Release", "zh-TW": "版本發布" } },
    statuses: { released: { en: "Released", "zh-TW": "已發布" } }
  };
  const groups = { year: "years", product: "products", category: "categories", release: "releases", status: "statuses" };
  const controls = Object.fromEntries(Object.entries(groups).map(([key, group]) => {
    const control = element({ filter: key });
    const choices = Object.fromEntries(["all", ...options[group]].map((value) => [value, { textContent: optionLabels[group]?.[value]?.en || value }]));
    control.querySelector = (selector) => choices[selector.match(/value=['"](.*?)['"]/)[1]];
    Object.defineProperty(control, "selectedOptions", { get: () => [choices[control.value]] });
    return [key, control];
  }));
  const nodes = Object.fromEntries(["site-data", "history-search", "result-count", "active-filters", "no-results", "hidden-target", "dossier-search-results", "dossier-search-list", "theme-toggle", "theme-label", "reset-filters", "show-target"].map((id) => [`#${id}`, element()]));
  nodes[".filters-shell"] = element();
  nodes["#result-count"].firstChild = { textContent: "" };
  nodes["#site-data"].textContent = JSON.stringify({ locales, options, optionLabels, searchDocuments: { workspace: "song workspace", other: "homepage" } });
  const cards = [element({ eventId: "workspace", year: "2026", products: "product-song-workspace", category: "release", release: "release-v2.0.5", status: "released" }), element({ eventId: "other", year: "2026", products: "product-homepage", category: "product", release: "", status: "active" })];
  const languages = [element({ setLang: "en" }), element({ setLang: "zh-TW" })];
  const localized = element({ i18n: "noResults" });
  const aria = element({ i18nAriaLabel: "activeFilters" });
  const document = {
    body: { dataset: {} }, documentElement: { dataset: { theme: "light" } },
    querySelector: (selector) => nodes[selector],
    querySelectorAll: (selector) => ({ "[data-event-id]": cards, "[data-filter]": Object.values(controls), "[data-set-lang]": languages, "[data-i18n]": [localized], "[data-i18n-aria-label]": [aria] }[selector] || []),
    createElement: () => element(), addEventListener() {}
  };
  const location = new URL(`http://localhost/${query}`);
  const storage = new Map();
  vm.runInNewContext(await readFile(new URL("../src/scripts/app.js", import.meta.url), "utf8"), {
    document, location, URLSearchParams, CSS: { escape: (value) => value },
    history: { replaceState: (_state, _title, url) => { location.href = new URL(url, location).href; } },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}
  });
  return {
    controls, nodes, document, location, aria, localized,
    select(key, value) { controls[key].value = value; controls[key].dispatch("change"); },
    language(lang) { languages.find((button) => button.dataset.setLang === lang).dispatch("click"); },
    chips: () => nodes["#active-filters"].children.map((chip) => chip.textContent),
    visible: () => cards.filter((card) => !card.hidden).map((card) => card.dataset.eventId)
  };
}

test("runtime preserves canonical product and results across EN → zh-TW → EN", async () => {
  const app = await fixture();
  app.select("product", "product-song-workspace");
  assert.deepEqual(app.chips(), ["Song Workspace ×"]);
  const results = app.visible();
  app.language("zh-TW");
  assert.deepEqual(app.chips(), ["歌曲工作區 ×"]);
  assert.equal(app.controls.product.selectedOptions[0].textContent, "歌曲工作區");
  assert.equal(app.aria.attributes["aria-label"], "目前篩選");
  assert.deepEqual(app.visible(), results);
  assert.equal(app.location.searchParams.get("product"), "product-song-workspace");
  app.language("en");
  assert.deepEqual(app.chips(), ["Song Workspace ×"]);
  assert.deepEqual(app.visible(), results);
  assert.equal(app.nodes["#result-count"].firstChild.textContent, "1 ");
});

test("runtime localizes all chip types on initial deep link and locale switch", async () => {
  const app = await fixture("?lang=zh-TW&year=2026&product=product-song-workspace&category=release&release=release-v2.0.5&status=released");
  assert.deepEqual(app.chips(), ["2026 ×", "歌曲工作區 ×", "版本發布 ×", "release-v2.0.5 ×", "已發布 ×"]);
  app.language("en");
  assert.deepEqual(app.chips(), ["2026 ×", "Song Workspace ×", "Release ×", "release-v2.0.5 ×", "Released ×"]);
  assert.equal(app.controls.category.value, "release");
  assert.equal(app.controls.status.value, "released");
});

test("runtime removes one filter independently and reset preserves locale/theme", async () => {
  const app = await fixture("?lang=zh-TW&product=product-song-workspace&status=released");
  app.nodes["#theme-toggle"].dispatch("click");
  app.nodes["#active-filters"].children[0].dispatch("click");
  assert.equal(app.controls.product.value, "all");
  assert.equal(app.controls.status.value, "released");
  app.nodes["#history-search"].value = "missing";
  app.nodes["#history-search"].dispatch("input");
  assert.equal(app.visible().length, 0);
  assert.equal(app.localized.textContent, "沒有符合的歷史項目。");
  assert.equal(app.location.searchParams.has("search"), false);
  app.nodes["#reset-filters"].dispatch("click");
  assert.deepEqual(app.chips(), []);
  assert.equal(app.visible().length, 2);
  assert.ok(Object.values(app.controls).every((control) => control.value === "all"));
  assert.equal(app.nodes["#history-search"].value, "");
  assert.equal(app.nodes["#history-search"].focused, true);
  assert.equal(app.document.documentElement.lang, "zh-TW");
  assert.equal(app.document.documentElement.dataset.theme, "dark");
  assert.equal(app.location.search, "?lang=zh-TW");
});
