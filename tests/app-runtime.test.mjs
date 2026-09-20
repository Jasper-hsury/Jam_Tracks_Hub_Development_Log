import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { CATEGORY_LABELS, deriveData } from "../scripts/site-core.mjs";
import { loadData } from "../scripts/validate-data.mjs";

// A small DOM adapter executes the shipped runtime, including event ordering.
// Layout and native controls are checked separately in the browser matrix.
async function fixture(query = "", inventory = null) {
  const locales = Object.fromEntries(await Promise.all(["en", "zh-TW"].map(async (lang) => [lang, JSON.parse(await readFile(new URL(`../src/locales/${lang}.json`, import.meta.url)))])));
  const element = (dataset = {}) => ({
    dataset, value: "all", textContent: "", children: [], attributes: {}, listeners: {}, hidden: false,
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    dispatch(type) { this.listeners[type]?.({ target: this }); },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    focus() { this.focused = true; },
    scrollIntoView(options) { this.scrolls = [...(this.scrolls || []), options]; }
  });
  const options = inventory?.options || { years: ["2026"], products: ["product-song-workspace"], categories: ["release"], releases: ["release-v2.0.5"], statuses: ["released"] };
  const optionLabels = inventory?.optionLabels || {
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
  for (const card of cards) {
    card.id = card.dataset.eventId;
    card.matches = (selector) => selector === "[data-event-id]";
  }
  const languages = [element({ setLang: "en" }), element({ setLang: "zh-TW" })];
  const localized = element({ i18n: "noResults" });
  const aria = element({ i18nAriaLabel: "activeFilters" });
  const document = {
    body: { dataset: {} }, documentElement: { dataset: { theme: "light" } },
    querySelector: (selector) => nodes[selector],
    getElementById: (id) => cards.find((card) => card.id === id) || null,
    querySelectorAll: (selector) => ({ "[data-event-id]": cards, "[data-filter]": Object.values(controls), "[data-set-lang]": languages, "[data-i18n]": [localized], "[data-i18n-aria-label]": [aria] }[selector] || []),
    createElement: () => element(), addEventListener() {}
  };
  const location = new URL(`http://localhost/${query}`);
  const storage = new Map();
  const windowListeners = {};
  vm.runInNewContext(await readFile(new URL("../src/scripts/app.js", import.meta.url), "utf8"), {
    document, location, URLSearchParams, CSS: { escape: (value) => value },
    history: { replaceState: (_state, _title, url) => { location.href = new URL(url, location).href; } },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, listener) { windowListeners[type] = listener; }
  });
  return {
    controls, nodes, document, location, aria, localized, cards, storage,
    hash(value) { location.hash = value; windowListeners.hashchange(); },
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

test("every canonical product, category and status option follows the active locale", async () => {
  const context = deriveData(await loadData());
  const en = JSON.parse(await readFile(new URL("../src/locales/en.json", import.meta.url)));
  const zh = JSON.parse(await readFile(new URL("../src/locales/zh-TW.json", import.meta.url)));
  const bilingual = (value) => ({ en: value.en, "zh-TW": value.zhTW });
  const optionLabels = {
    products: Object.fromEntries(context.visibleProducts.map((product) => [product.id, bilingual(product.name)])),
    categories: Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([id, names]) => [id, bilingual(names)])),
    statuses: Object.fromEntries(["released", "reverted", "superseded", "deprecated"].map((id) => [id, { en: en[id], "zh-TW": zh[id] }]))
  };
  const options = { years: ["2026"], releases: ["release-v2.0.5"], ...Object.fromEntries(Object.entries(optionLabels).map(([group, names]) => [group, Object.keys(names)])) };
  for (const [key, group] of Object.entries({ product: "products", category: "categories", status: "statuses" })) {
    for (const [value, labels] of Object.entries(optionLabels[group])) {
      const app = await fixture("", { options, optionLabels });
      app.select(key, value);
      const results = app.visible();
      for (const lang of ["en", "zh-TW", "en"]) {
        app.language(lang);
        assert.deepEqual(app.chips(), [`${labels[lang]} ×`], `${key}/${value}/${lang}`);
        assert.equal(app.controls[key].value, value);
        assert.deepEqual(app.visible(), results);
        assert.equal(app.location.searchParams.get(key), value);
      }
    }
  }
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

for (const hash of ["#%", "#%E0%A4%A"]) {
  test(`runtime initializes with malformed hash ${hash} and keeps controls and preferences working`, async () => {
    const app = await fixture(`?lang=en${hash}`);
    assert.deepEqual(app.visible(), ["workspace", "other"]);
    assert.equal(app.nodes["#result-count"].firstChild.textContent, "2 ");
    assert.equal(app.nodes["#hidden-target"].hidden, true);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, undefined);
    app.nodes["#theme-toggle"].dispatch("click");
    app.select("product", "product-song-workspace");
    assert.deepEqual(app.visible(), ["workspace"]);
    assert.deepEqual(app.chips(), ["Song Workspace ×"]);
    app.language("zh-TW");
    assert.equal(app.document.documentElement.lang, "zh-TW");
    assert.deepEqual(app.chips(), ["歌曲工作區 ×"]);
    assert.deepEqual(app.visible(), ["workspace"]);
    assert.equal(app.controls.product.value, "product-song-workspace");
    app.nodes["#history-search"].value = "missing";
    app.nodes["#history-search"].dispatch("input");
    assert.deepEqual(app.visible(), []);
    assert.equal(app.nodes["#no-results"].hidden, false);
    assert.equal(app.nodes["#result-count"].firstChild.textContent, "0 ");
    app.nodes["#reset-filters"].dispatch("click");
    assert.deepEqual(app.visible(), ["workspace", "other"]);
    assert.deepEqual(app.chips(), []);
    assert.ok(Object.values(app.controls).every((control) => control.value === "all"));
    assert.equal(app.nodes["#history-search"].value, "");
    assert.equal(app.nodes["#history-search"].focused, true);
    assert.equal(app.nodes["#result-count"].firstChild.textContent, "2 ");
    assert.equal(app.document.documentElement.lang, "zh-TW");
    app.language("en");
    assert.equal(app.document.documentElement.lang, "en");
    assert.equal(app.document.documentElement.dataset.theme, "dark");
    assert.equal(app.storage.get("jam-tracks-hub-log-theme"), "dark");
    assert.equal(app.location.hash, hash);
    assert.equal(app.nodes["#hidden-target"].hidden, true);
  });
}

for (const [name, hash] of [["no hash", ""], ["empty hash", "#"], ["unknown target", "#missing"], ["no double decoding", "#%2577orkspace"]]) {
  test(`runtime preserves harmless ${name} behavior`, async () => {
    const app = await fixture(`?lang=en${hash}`);
    assert.deepEqual(app.visible(), ["workspace", "other"]);
    app.nodes["#history-search"].value = "homepage";
    app.nodes["#history-search"].dispatch("input");
    assert.deepEqual(app.visible(), ["other"]);
    assert.equal(app.nodes["#hidden-target"].hidden, true);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, undefined);
    // Existing writeUrl uses location.hash, which is empty for a trailing #.
    assert.equal(app.location.href, `http://localhost/?lang=en${hash === "#" ? "" : hash}`);
  });
}

for (const hash of ["#workspace", "#%77orkspace"]) {
  test(`runtime preserves visible and later filtered target ${hash}`, async () => {
    const app = await fixture(`?lang=en${hash}`);
    assert.deepEqual(app.visible(), ["workspace", "other"]);
    assert.equal(app.nodes["#hidden-target"].hidden, true);
    app.nodes["#history-search"].value = "homepage";
    app.nodes["#history-search"].dispatch("input");
    assert.deepEqual(app.visible(), ["other"]);
    assert.equal(app.nodes["#hidden-target"].hidden, false);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, "workspace");
    assert.equal(app.location.hash, hash);
  });
}

for (const hash of ["#other", "#%6Fther"]) {
  test(`runtime preserves filtered-out target and show-item action ${hash}`, async () => {
    const app = await fixture(`?lang=en&product=product-song-workspace${hash}`);
    assert.deepEqual(app.visible(), ["workspace"]);
    assert.equal(app.nodes["#hidden-target"].hidden, false);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, "other");
    app.nodes["#show-target"].dispatch("click");
    assert.deepEqual(app.visible(), ["workspace", "other"]);
    assert.deepEqual(app.chips(), []);
    assert.ok(Object.values(app.controls).every((control) => control.value === "all"));
    assert.equal(app.nodes["#hidden-target"].hidden, true);
    assert.equal(app.nodes["#result-count"].firstChild.textContent, "2 ");
    assert.equal(app.cards.find((card) => card.id === "other").scrolls.length, 1);
    assert.equal(app.cards.find((card) => card.id === "other").scrolls[0].block, "center");
    assert.equal(app.location.hash, hash);
  });
}

for (const hash of ["#%", "#%E0%A4%A"]) {
  test(`runtime recovers from valid → ${hash} → valid without stale notice or target`, async () => {
    const app = await fixture("?lang=en&product=product-song-workspace#other");
    assert.equal(app.nodes["#hidden-target"].hidden, false);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, "other");
    app.hash(hash);
    assert.equal(app.nodes["#hidden-target"].hidden, true);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, undefined);
    assert.equal(app.location.hash, hash);
    assert.deepEqual(app.visible(), ["workspace"]);
    app.hash("#workspace");
    assert.equal(app.nodes["#hidden-target"].hidden, true);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, undefined);
    app.hash("#%6Fther");
    assert.equal(app.nodes["#hidden-target"].hidden, false);
    assert.equal(app.nodes["#hidden-target"].dataset.targetId, "other");
    app.nodes["#show-target"].dispatch("click");
    assert.deepEqual(app.visible(), ["workspace", "other"]);
    assert.equal(app.cards.find((card) => card.id === "other").scrolls.length, 1);
  });
}

test("hash handling does not swallow unrelated target-lookup errors", async () => {
  const app = await fixture();
  const error = new Error("target lookup failed");
  app.document.getElementById = () => { throw error; };
  assert.throws(() => app.hash("#workspace"), (caught) => caught === error);
});
