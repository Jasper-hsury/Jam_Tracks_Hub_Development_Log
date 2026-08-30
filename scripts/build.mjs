import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CATEGORY_LABELS, buildSearchDocument, deriveData } from "./site-core.mjs";
import { runValidation } from "./validate-data.mjs";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const read = (path) => readFile(new URL(path, root), "utf8");
const esc = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
})[character]);
const copy = (value) => `<span data-lang-copy="en">${esc(value.en)}</span><span data-lang-copy="zh-TW">${esc(value.zhTW)}</span>`;
const label = (key, locales) => `<span data-i18n="${key}">${esc(locales.en[key])}</span>`;
const dateCopy = (date) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return copy({
    en: new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(parsed),
    zhTW: new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(parsed)
  });
};
const option = (value, text) => `<option value="${esc(value)}">${esc(text)}</option>`;

function renderSourceRefs(event, locales) {
  if (!event.sourceRefs?.length && !event.details) return "";
  const refs = (event.sourceRefs || []).map((ref) => `<li><a href="${esc(ref.url)}">${esc(ref.label)}</a></li>`).join("");
  return `<details class="evidence"><summary>${label("evidence", locales)}</summary>${event.details ? `<p>${copy(event.details)}</p>` : ""}${refs ? `<ul>${refs}</ul>` : ""}</details>`;
}

function renderEvent(event, context, locales) {
  const release = event.releaseId ? context.releaseById.get(event.releaseId) : null;
  const series = event.seriesId ? context.seriesById.get(event.seriesId) : null;
  const rollback = context.rollbackByTarget.get(event.id);
  const status = context.statusFor(event);
  const products = event.productIds.map((id) => context.productById.get(id)).filter(Boolean);
  const productNames = products.map((product) => copy(product.name)).join(" · ");
  const seriesItems = series?.itemLinks?.map((item) => `<li><a href="${esc(item.url)}">${esc(`${series.prefix}${item.number}`)}</a></li>`).join("") || "";
  const rollbackLink = event.reverts ? `<p class="relation">${label("restores", locales)}: <a href="#${esc(event.reverts)}">${copy(context.sortedEvents.find((item) => item.id === event.reverts).title)}</a></p>` : "";
  const revertedBy = rollback ? `<p class="relation">${label("reverted", locales)}: <a href="#${esc(rollback.id)}">${copy(rollback.title)}</a></p>` : "";
  const searchDocument = buildSearchDocument(event, context);
  return `<article class="event-card level-${esc(event.level)} ${release ? "is-release" : ""} ${event.kind === "rollback" ? "is-rollback" : ""}" id="${esc(event.id)}" data-event-id="${esc(event.id)}" data-year="${event.date.slice(0, 4)}" data-products="${esc(event.productIds.join(" "))}" data-category="${esc(event.categoryId)}" data-release="${esc(event.releaseId || "")}" data-status="${esc(status)}" data-search="${esc(searchDocument)}">
    <div class="event-meta"><time datetime="${event.date}">${dateCopy(event.date)}</time><span class="category category-${event.categoryId}">${copy(CATEGORY_LABELS[event.categoryId])}</span><span class="status status-${status}">${label(status, locales)}</span></div>
    <h3>${copy(event.title)}</h3>
    <p class="event-summary">${copy(event.summary)}</p>
    <p class="product-links">${productNames}</p>
    ${event.createdInGitDate && event.createdInGitDate !== event.date ? `<dl class="date-pair"><div><dt>${label("createdInGit", locales)}</dt><dd>${dateCopy(event.createdInGitDate)}</dd></div><div><dt>${label("firstPublished", locales)}</dt><dd>${dateCopy(event.date)}</dd></div></dl>` : ""}
    ${release ? `<p class="release-link"><a href="#${esc(release.id)}"><code>${esc(release.version)}</code> · ${copy(release.title)}</a></p>` : ""}
    ${series ? `<details class="series"><summary>${copy(series.title)} · ${series.itemLinks.length} items</summary><p>${copy(series.summary)}</p><ul>${seriesItems}</ul></details>` : ""}
    ${rollbackLink}${revertedBy}${renderSourceRefs(event, locales)}
  </article>`;
}

function renderTimeline(context, locales) {
  const years = [...new Set(context.sortedEvents.map((event) => event.date.slice(0, 4)))];
  return years.map((year) => {
    const yearEvents = context.sortedEvents.filter((event) => event.date.startsWith(year));
    const months = [...new Set(yearEvents.map((event) => event.date.slice(0, 7)))];
    const monthHtml = months.map((month) => {
      const monthDate = new Date(`${month}-01T00:00:00Z`);
      const monthName = copy({
        en: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(monthDate),
        zhTW: new Intl.DateTimeFormat("zh-TW", { month: "long", timeZone: "UTC" }).format(monthDate)
      });
      return `<section class="month-group" data-month="${month}"><h3 class="month-title">${monthName}</h3><div class="event-list">${yearEvents.filter((event) => event.date.startsWith(month)).map((event) => renderEvent(event, context, locales)).join("")}</div></section>`;
    }).join("");
    return `<section class="year-group" id="year-${year}" data-year-group="${year}"><h2>${year}</h2>${monthHtml}</section>`;
  }).join("");
}

function renderProduct(product, context, locales) {
  const stats = context.productStats.get(product.id);
  return `<article class="product-card" id="${product.id}">
    <p class="eyebrow">${esc(product.classification.replaceAll("_", " "))}</p>
    <h3>${copy(product.name)}</h3><p>${copy(product.description)}</p>
    <dl class="product-dates">
      <div><dt>${label("createdInGit", locales)}</dt><dd>${stats.createdDate ? dateCopy(stats.createdDate) : "—"}</dd></div>
      <div><dt>${label("firstPublished", locales)}</dt><dd>${stats.publishedDate ? dateCopy(stats.publishedDate) : "—"}</dd></div>
      <div><dt>${label("latestPublicUpdate", locales)}</dt><dd>${stats.latestDate ? dateCopy(stats.latestDate) : "—"}</dd></div>
    </dl>
    <p class="card-actions"><button type="button" class="text-button" data-product-history="${product.id}">${label("viewHistory", locales)} · ${stats.eventCount} ${label("events", locales)}</button>${product.href ? `<a href="${esc(product.href)}">↗</a>` : ""}</p>
  </article>`;
}

function renderRelease(release, context, locales) {
  const children = context.releaseChildren.get(release.id) || [];
  const published = release.status === "published";
  const link = published ? release.releaseUrl : release.tagUrl;
  return `<article class="release-card ${published ? "" : "tag-only"}" id="${release.id}">
    <div><code>${esc(release.version)}</code><span class="status ${published ? "status-released" : "status-tag"}">${label(published ? "published" : "tagOnly", locales)}</span></div>
    <h3>${copy(release.title)}</h3><p>${copy(release.summary)}</p><time datetime="${release.date}">${dateCopy(release.date)}</time>
    ${!published ? `<p class="tag-note">${label("noPublishedRelease", locales)}</p>` : ""}
    <p><a href="${esc(link)}">${published ? label("published", locales) : label("tagOnly", locales)} ↗</a></p>
    ${children.length ? `<details><summary>${children.length} ${label("events", locales)}</summary><ul>${children.map((event) => `<li><a href="#${event.id}">${copy(event.title)}</a></li>`).join("")}</ul></details>` : ""}
  </article>`;
}

function selectControl(key, options, locales) {
  return `<label><span>${label(key, locales)}</span><select id="filter-${key}" data-filter="${key}">${option("all", locales.en.all)}${options}</select></label>`;
}

function renderIndexBody(data, context, locales) {
  const years = [...new Set(context.sortedEvents.map((event) => event.date.slice(0, 4)))];
  const newestMajor = context.sortedEvents.find((event) => event.level === "primary");
  const productOptions = context.visibleProducts.map((product) => option(product.id, product.name.en)).join("");
  const categoryOptions = Object.entries(CATEGORY_LABELS).map(([id, value]) => option(id, value.en)).join("");
  const releaseOptions = [...data.releases].sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence).map((release) => option(release.id, release.version)).join("");
  const statusOptions = ["released", "reverted", "superseded", "deprecated"].map((status) => option(status, locales.en[status])).join("");
  const timeline = renderTimeline(context, locales);
  return `<a class="skip-link" href="#history">${label("skipHistory", locales)}</a>
  <header class="site-header"><a class="brand" href="#top">Jam Tracks Hub <span>${label("siteTitle", locales)}</span></a><nav aria-label="Primary"><a href="#history">History</a><a href="#products">Products</a><a href="#releases">Releases</a><a href="./print.html">${label("printView", locales)}</a></nav><div class="language-switch" role="group" aria-label="${esc(locales.en.language)}"><button type="button" data-set-lang="en" aria-pressed="true">EN</button><button type="button" data-set-lang="zh-TW" aria-pressed="false">繁中</button></div></header>
  <main id="top">
    <section class="hero"><div class="hero-copy"><p class="eyebrow">Jam Tracks Hub</p><h1>${label("siteTitle", locales)}</h1><p class="lede">${label("subtitle", locales)}</p><div class="hero-actions"><a class="button primary" href="#history">${label("exploreHistory", locales)}</a><a class="button secondary" href="https://jamtrackshub.com/">${label("visitSite", locales)}</a></div><a class="source-link" href="https://github.com/Jasper-hsury/Jam_Tracks_Hub_Development_Log">${label("viewSource", locales)} ↗</a></div><aside class="hero-record"><p>${label("latestStable", locales)}</p><strong>${esc(context.latestPublishedRelease.version)}</strong><span>${copy(context.latestPublishedRelease.title)}</span><hr><p>${label("historyCoverage", locales)}</p><strong class="record-date">${label("since", locales)}</strong></aside></section>
    <section class="snapshot" aria-label="Current snapshot"><div><span>${label("latestStable", locales)}</span><strong>${esc(context.latestPublishedRelease.version)}</strong></div><div><span>${label("latestUpdate", locales)}</span><strong>${copy(newestMajor.title)}</strong></div></section>
    <section class="metrics" aria-label="Derived metrics"><article><strong>${context.metrics.publishedReleases}</strong><span>${label("publishedReleases", locales)}</span></article><article><strong>${context.metrics.productAreas}</strong><span>${label("productAreas", locales)}</span></article><article><strong>${context.metrics.developmentSince.slice(0, 4)}</strong><span>${label("developmentSince", locales)}</span></article></section>
    <section class="explore" aria-labelledby="explore-title"><div class="section-heading compact"><p class="eyebrow">${label("explore", locales)}</p><h2 id="explore-title">${label("timeline", locales)}</h2></div><details class="filters-shell" open><summary>${label("filtersYears", locales)}</summary><div class="filter-controls"><label class="search-control"><span>${label("searchLabel", locales)}</span><input id="history-search" type="search" autocomplete="off" placeholder="${esc(locales.en.searchPlaceholder)}"></label>${selectControl("year", years.map((year) => option(year, year)).join(""), locales)}${selectControl("product", productOptions, locales)}${selectControl("category", categoryOptions, locales)}${selectControl("release", releaseOptions, locales)}${selectControl("status", statusOptions, locales)}<button type="button" id="reset-filters" class="reset-button">${label("reset", locales)}</button></div></details><div class="result-row"><p id="result-count" role="status" aria-live="polite">${data.events.length} ${label("results", locales)}</p><div id="active-filters" class="active-filters" aria-label="Active filters"></div></div></section>
    <div id="hidden-target" class="hidden-target" hidden><p>${label("hiddenTarget", locales)}</p><button type="button" id="show-target">${label("showItem", locales)}</button></div>
    <section class="history-layout" id="history" tabindex="-1"><aside class="year-rail"><p>${label("historyNav", locales)}</p><nav>${years.map((year) => `<button type="button" data-year-jump="${year}">${year}</button>`).join("")}</nav></aside><div class="timeline"><div class="section-heading"><h2>${label("timeline", locales)}</h2><p>${label("timelineIntro", locales)}</p></div>${timeline}<p id="no-results" class="no-results" hidden>No matching history items.</p></div></section>
    <section class="page-section" id="products"><div class="section-heading"><p class="eyebrow">Index</p><h2>${label("productEvolution", locales)}</h2><p>${label("productEvolutionIntro", locales)}</p></div><div class="product-grid">${context.visibleProducts.map((product) => renderProduct(product, context, locales)).join("")}</div></section>
    <section class="page-section release-section" id="releases"><div class="section-heading"><p class="eyebrow">Versions</p><h2>${label("releaseIndex", locales)}</h2></div><div class="release-grid">${[...data.releases].sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence).map((release) => renderRelease(release, context, locales)).join("")}</div></section>
    <section class="page-section roadmap-section" id="roadmap"><div class="section-heading"><p class="eyebrow">Looking ahead</p><h2>${label("roadmap", locales)}</h2></div>${data.roadmap.length ? `<div class="roadmap-grid">${data.roadmap.map((item) => `<article><h3>${copy(item.title)}</h3><p>${copy(item.summary)}</p></article>`).join("")}</div>` : `<p class="empty-state">${label("roadmapEmpty", locales)}</p>`}</section>
    <section class="page-section methodology" id="methodology"><div><p class="eyebrow">Sources</p><h2>${label("methodology", locales)}</h2></div><p>${label("methodologyText", locales)}</p><p><a href="https://github.com/Jasper-hsury/Jam_Tracks_Hub">Jam Tracks Hub source repository ↗</a></p></section>
  </main><footer><p>${label("footerText", locales)}</p><p><a href="./print.html">${label("printView", locales)}</a> · <a href="https://jamtrackshub.com/">jamtrackshub.com</a></p></footer>`;
}

function renderPrintBody(data, context) {
  const releases = [...data.releases].sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence);
  const products = context.visibleProducts;
  return `<header><p>Jam Tracks Hub</p><h1>Development & Release Log</h1><p>Public history since June 6, 2026 · Printed from the static, canonical record.</p></header>
  <main><section><h2>Release Index</h2>${releases.map((release) => `<article class="print-release" id="${release.id}"><h3>${esc(release.version)} — ${esc(release.title.en)}</h3><p><strong>${release.status === "published" ? "Published Release" : "Tag only — No published GitHub Release"}</strong> · ${esc(release.date)}</p><p>${esc(release.summary.en)}</p><p>${esc(release.status === "published" ? release.releaseUrl : release.tagUrl)}</p>${context.releaseChildren.get(release.id).length ? `<h4>Related events</h4><ul>${context.releaseChildren.get(release.id).map((event) => `<li>${esc(event.date)} — ${esc(event.title.en)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</section>
  <section><h2>Product references</h2><ul class="product-reference">${products.map((product) => `<li><strong>${esc(product.name.en)}</strong> — ${esc(product.description.en)}</li>`).join("")}</ul></section>
  <section><h2>Complete Development History</h2>${context.sortedEvents.map((event) => `<article class="print-event" id="${event.id}"><p><time>${esc(event.date)}</time> · ${esc(CATEGORY_LABELS[event.categoryId].en)} · ${esc(context.statusFor(event))}</p><h3>${esc(event.title.en)}</h3><p>${esc(event.summary.en)}</p>${event.details ? `<p>${esc(event.details.en)}</p>` : ""}${event.createdInGitDate && event.createdInGitDate !== event.date ? `<p>Created in Git: ${event.createdInGitDate} · First published: ${event.date}</p>` : ""}${event.reverts ? `<p>Restores: ${esc(event.reverts)}</p>` : ""}${event.sourceRefs?.length ? `<h4>Evidence</h4><ul>${event.sourceRefs.map((ref) => `<li>${esc(ref.label)} — ${esc(ref.url)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</section></main>`;
}

export async function buildSite() {
  const data = await runValidation();
  const [indexTemplate, printTemplate, en, zhTW] = await Promise.all([
    read("src/templates/index.html"), read("src/templates/print.html"),
    read("src/locales/en.json").then(JSON.parse), read("src/locales/zh-TW.json").then(JSON.parse)
  ]);
  const locales = { en, zhTW };
  const context = deriveData(data);
  const searchDocuments = Object.fromEntries(context.sortedEvents.map((event) => [event.id, buildSearchDocument(event, context)]));
  const siteData = JSON.stringify({
    events: context.sortedEvents.map((event) => ({ id: event.id, date: event.date, productIds: event.productIds, categoryId: event.categoryId, releaseId: event.releaseId || "", status: context.statusFor(event) })),
    options: {
      years: [...new Set(context.sortedEvents.map((event) => event.date.slice(0, 4)))],
      products: context.visibleProducts.map((product) => product.id),
      categories: Object.keys(CATEGORY_LABELS),
      releases: data.releases.map((release) => release.id),
      statuses: ["released", "reverted", "superseded", "deprecated"]
    },
    optionLabels: {
      products: Object.fromEntries(context.visibleProducts.map((product) => [product.id, { en: product.name.en, "zh-TW": product.name.zhTW }])),
      categories: Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([id, value]) => [id, { en: value.en, "zh-TW": value.zhTW }])),
      statuses: Object.fromEntries(["released", "reverted", "superseded", "deprecated"].map((status) => [status, { en: en[status], "zh-TW": zhTW[status] }]))
    },
    searchDocuments,
    locales: { en, "zh-TW": zhTW }
  }).replaceAll("<", "\\u003c");
  const index = indexTemplate.replace("{{BODY}}", renderIndexBody(data, context, locales)).replace("{{SITE_DATA}}", siteData);
  const print = printTemplate.replace("{{BODY}}", renderPrintBody(data, context));
  await rm(dist, { recursive: true, force: true });
  await mkdir(new URL("assets/", dist), { recursive: true });
  await writeFile(new URL("index.html", dist), index);
  await writeFile(new URL("print.html", dist), print);
  await cp(new URL("src/styles/site.css", root), new URL("assets/site.css", dist));
  await cp(new URL("src/styles/print.css", root), new URL("assets/print.css", dist));
  await cp(new URL("src/scripts/app.js", root), new URL("assets/app.js", dist));
  return { data, context, output: { index, print } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildSite();
    console.log(`Built dist/index.html and dist/print.html from ${result.data.events.length} canonical events.`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
