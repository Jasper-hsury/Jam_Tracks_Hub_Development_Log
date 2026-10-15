import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CATEGORY_LABELS, buildDossierSearchDocument, buildSearchDocument, deriveData } from "./site-core.mjs";
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
const shortDateCopy = (date) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return copy({
    en: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed),
    zhTW: new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", timeZone: "UTC" }).format(parsed)
  });
};
const monthCopy = (month) => {
  const parsed = new Date(`${month}-01T00:00:00Z`);
  return copy({
    en: new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", timeZone: "UTC" }).format(parsed),
    zhTW: new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", timeZone: "UTC" }).format(parsed)
  });
};
const shortVersion = (version) => version.replace(/\.0$/, "");
const icon = (path) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
const ICONS = {
  chevron: "m7 10 5 5 5-5",
  external: "M7 17 17 7M9 7h8v8",
  search: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13ZM15.5 15.5 20 20",
  filters: "M4 6h16M7 12h10M10 18h4",
  close: "M6 6l12 12M18 6 6 18",
  theme: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  up: "M12 19V5M6 11l6-6 6 6"
};
const backToTopButton = (locales) => `<button type="button" id="back-to-top" class="back-to-top" aria-label="${esc(locales.en.backToTop)}" data-i18n-aria-label="backToTop" hidden>${icon(ICONS.up)}</button>`;
const recordSvg = `<svg class="record" viewBox="0 0 300 300" aria-hidden="true" focusable="false"><circle class="record-vinyl" cx="150" cy="150" r="148"></circle><circle class="record-groove" cx="150" cy="150" r="128"></circle><circle class="record-groove" cx="150" cy="150" r="110"></circle><circle class="record-groove" cx="150" cy="150" r="92"></circle><circle class="record-groove" cx="150" cy="150" r="74"></circle><circle class="record-label" cx="150" cy="150" r="50"></circle><circle class="record-hole" cx="150" cy="150" r="5"></circle></svg>`;
const option = (value, text) => `<option value="${esc(value)}">${esc(text)}</option>`;

function renderSourceRefs(event, locales) {
  if (!event.sourceRefs?.length && !event.details) return "";
  const refs = (event.sourceRefs || []).map((ref) => `<li><a href="${esc(ref.url)}">${esc(ref.label)}</a></li>`).join("");
  return `<details class="evidence"><summary><span>${label("evidence", locales)}</span>${icon(ICONS.chevron)}</summary>${event.details ? `<p>${copy(event.details)}</p>` : ""}${refs ? `<ul>${refs}</ul>` : ""}</details>`;
}

function renderEvent(event, context, locales) {
  const release = event.releaseId ? context.releaseById.get(event.releaseId) : null;
  const series = event.seriesId ? context.seriesById.get(event.seriesId) : null;
  const rollback = context.rollbackByTarget.get(event.id);
  const status = context.statusFor(event);
  const products = event.productIds.map((id) => context.productById.get(id)).filter(Boolean);
  const productChips = products.map((product) => `<li>${copy(product.name)}</li>`).join("");
  const seriesItems = series?.itemLinks?.map((item) => `<li><a href="${esc(item.url)}">${esc(`${series.prefix}${item.number}`)}</a></li>`).join("") || "";
  const rollbackLink = event.reverts ? `<p class="relation">${label("restores", locales)}: <a href="#${esc(event.reverts)}">${copy(context.sortedEvents.find((item) => item.id === event.reverts).title)}</a></p>` : "";
  const revertedBy = rollback ? `<p class="relation">${label("reverted", locales)}: <a href="#${esc(rollback.id)}">${copy(rollback.title)}</a></p>` : "";
  const searchDocument = buildSearchDocument(event, context);
  const isReleaseEntry = Boolean(release) && event.categoryId === "release";
  const marker = isReleaseEntry
    ? `<span class="event-sleeve" aria-hidden="true">${esc(shortVersion(release.version))}</span>`
    : `<span class="event-dot ${event.kind === "rollback" ? "is-rollback" : ""}" aria-hidden="true"></span>`;
  const meta = [
    event.categoryId !== "release" ? `<span class="category category-${event.categoryId}">${copy(CATEGORY_LABELS[event.categoryId])}</span>` : "",
    status !== "released" ? `<span class="status status-${status}">${label(status, locales)}</span>` : ""
  ].join("");
  return `<article class="event-card level-${esc(event.level)} ${release ? "is-release" : ""} ${isReleaseEntry ? "is-release-entry" : ""} ${event.kind === "rollback" ? "is-rollback" : ""}" id="${esc(event.id)}" data-event-id="${esc(event.id)}" data-year="${event.date.slice(0, 4)}" data-products="${esc(event.productIds.join(" "))}" data-category="${esc(event.categoryId)}" data-release="${esc(event.releaseId || "")}" data-status="${esc(status)}" data-search="${esc(searchDocument)}">
    <p class="event-date"><time datetime="${event.date}">${shortDateCopy(event.date)}</time></p>
    <div class="event-marker">${marker}</div>
    <div class="event-body">
    ${meta ? `<div class="event-meta">${meta}</div>` : ""}
    <h3>${copy(event.title)}</h3>
    <p class="event-summary">${copy(event.summary)}</p>
    <ul class="product-links">${productChips}</ul>
    ${event.createdInGitDate && event.createdInGitDate !== event.date ? `<dl class="date-pair"><div><dt>${label("createdInGit", locales)}</dt><dd>${dateCopy(event.createdInGitDate)}</dd></div><div><dt>${label("firstPublished", locales)}</dt><dd>${dateCopy(event.date)}</dd></div></dl>` : ""}
    ${series ? `<details class="series"><summary>${copy(series.title)} · ${series.itemLinks.length} ${label("items", locales)}</summary><p>${copy(series.summary)}</p><ul>${seriesItems}</ul></details>` : ""}
    ${rollbackLink}${revertedBy}${renderSourceRefs(event, locales)}
    </div>
    <div class="event-side">${release ? `<a class="release-link" href="#${esc(release.id)}"><code>${esc(release.version)}</code><span class="visually-hidden"> · ${copy(release.title)}</span></a>` : ""}</div>
  </article>`;
}

function renderTimeline(context, locales) {
  const years = [...new Set(context.sortedEvents.map((event) => event.date.slice(0, 4)))];
  return years.map((year) => {
    const yearEvents = context.sortedEvents.filter((event) => event.date.startsWith(year));
    const months = [...new Set(yearEvents.map((event) => event.date.slice(0, 7)))];
    const monthHtml = months.map((month) => {
      const monthEvents = yearEvents.filter((event) => event.date.startsWith(month));
      return `<section class="month-group" id="month-${month}" data-month="${month}" aria-labelledby="month-title-${month}"><div class="month-head"><h3 class="month-title" id="month-title-${month}">${monthCopy(month)}</h3><p class="month-count"><span class="month-count-value">${monthEvents.length}</span> ${label("entries", locales)}</p></div><div class="event-list">${monthEvents.map((event) => renderEvent(event, context, locales)).join("")}</div></section>`;
    }).join("");
    return `<section class="year-group" id="year-${year}" data-year-group="${year}"><h2 class="visually-hidden">${year}</h2>${monthHtml}</section>`;
  }).join("");
}

function renderMonthRail(context, locales) {
  const months = [...new Set(context.sortedEvents.map((event) => event.date.slice(0, 7)))];
  const links = months.map((month) => {
    const count = context.sortedEvents.filter((event) => event.date.startsWith(month)).length;
    return `<li><a href="#month-${month}" data-month-link="${month}">${monthCopy(month)}<span class="month-rail-count">${count}</span></a></li>`;
  }).join("");
  return `<aside class="month-rail" aria-labelledby="month-rail-title"><p id="month-rail-title">${label("monthsNav", locales)}</p><ol>${links}</ol></aside>`;
}

function renderProduct(product, context, locales) {
  const stats = context.productStats.get(product.id);
  const dossier = context.dossierByProductId.get(product.id);
  return `<article class="product-card" id="${product.id}">
    <p class="eyebrow">${label(product.classification === "PRIMARY_PUBLIC_PRODUCT" ? "primaryProduct" : product.classification === "SECONDARY_PUBLIC_PAGE" ? "secondaryPage" : "supportPage", locales)}</p>
    <h3>${copy(product.name)}</h3><p>${copy(product.description)}</p>
    <dl class="product-dates">
      <div><dt>${label("createdInGit", locales)}</dt><dd>${stats.createdDate ? dateCopy(stats.createdDate) : "—"}</dd></div>
      <div><dt>${label("firstPublished", locales)}</dt><dd>${stats.publishedDate ? dateCopy(stats.publishedDate) : "—"}</dd></div>
      <div><dt>${label("latestPublicUpdate", locales)}</dt><dd>${stats.latestDate ? dateCopy(stats.latestDate) : "—"}</dd></div>
    </dl>
    <div class="card-actions">${dossier ? `<a class="text-link" data-dossier-link data-dossier-path="./products/${esc(dossier.slug)}/" href="./products/${esc(dossier.slug)}/">${label("viewProject", locales)}</a>` : ""}<button type="button" class="text-button" data-product-history="${product.id}">${label("viewTimeline", locales)} · ${stats.eventCount}</button>${product.href ? `<a class="live-link" href="${esc(product.href)}">${label("viewLive", locales)} ↗</a>` : ""}</div>
  </article>`;
}

function renderClassification(classification, locales) {
  const key = classification === "verified" ? "verified" : classification === "reconstructed" ? "reconstructed" : "unknown";
  return `<span class="evidence-class classification-${classification}">${label(key, locales)}</span>`;
}

function renderFact(fact, locales, className = "") {
  return `<div class="fact ${className}">${renderClassification(fact.classification, locales)}<p>${copy(fact.text)}</p></div>`;
}

function renderDossierSection(section, locales) {
  const intro = section.intro ? renderFact(section.intro, locales, "section-intro") : "";
  let content = "";
  if (section.type === "text") content = section.items.map((item) => renderFact(item, locales)).join("");
  if (["featureList", "decision"].includes(section.type)) {
    const gridClass = section.type === "decision" ? "decision-grid" : "feature-grid";
    const cardClass = section.type === "decision" ? "decision-card" : "feature-card";
    content = `<div class="${gridClass}">${section.items.map((item) => `<article class="${cardClass}"><h3>${copy(item.title)}</h3>${renderFact(item.body, locales)}</article>`).join("")}</div>`;
  }
  if (["architecture", "responsive"].includes(section.type)) {
    const list = section.items.map((item) => `<div><dt>${copy(item.label)}</dt><dd>${renderFact(item.body, locales)}</dd></div>`).join("");
    content = section.type === "responsive" ? `<div class="responsive-grid">${section.items.map((item) => `<article class="responsive-card"><h3>${copy(item.label)}</h3>${renderFact(item.body, locales)}</article>`).join("")}</div>` : `<dl class="architecture-list">${list}</dl>`;
  }
  if (section.type === "timeline") {
    content = `<ol class="evolution-list">${section.items.map((item) => {
      const title = item.eventId
        ? `<a data-lang-href="../../index.html#${esc(item.eventId)}" href="../../index.html#${esc(item.eventId)}">${copy(item.title)}</a>`
        : `<a href="${esc(item.sourceUrl)}">${copy(item.title)} ↗</a>`;
      return `<li class="evolution-item"><div><time datetime="${item.date}">${dateCopy(item.date)}</time><span class="impact-label">${label(item.impact === "direct" ? "directChange" : "sharedImpact", locales)}</span></div><div><h3>${title}</h3>${renderFact(item.body, locales)}</div></li>`;
    }).join("")}</ol>`;
  }
  return `<section class="dossier-section" id="${esc(section.id)}"><h2>${copy(section.title)}</h2>${intro}${content}</section>`;
}

function renderDossierBody(dossier, product, context, data, locales) {
  const stats = context.productStats.get(product.id);
  const relatedEvents = dossier.relatedEventIds.map((id) => context.sortedEvents.find((event) => event.id === id)).filter(Boolean);
  const relatedReleaseIds = [...new Set(relatedEvents.map((event) => event.releaseId).filter(Boolean))];
  const relatedReleases = relatedReleaseIds.map((id) => context.releaseById.get(id)).filter(Boolean);
  const fixedToc = [
    ["overview", "projectOverview"], ["purpose", "whyItExists"], ["original-version", "originalVersion"],
    ...dossier.sections.map((section) => [section.id, section.title]),
    ["current-state", "currentState"], ["lessons", "lessons"], ["related-history", "relatedHistory"],
    ["evidence", "evidence"], ["unknowns", "unknowns"]
  ];
  const tocLabel = (value) => typeof value === "string" ? label(value, locales) : copy(value);
  const purpose = `<div class="purpose-grid">${dossier.purpose.map((item) => `<article class="purpose-card"><h3>${copy(item.label)}</h3>${renderFact(item.body, locales)}</article>`).join("")}</div>`;
  const original = `<div class="original-version"><time datetime="${dossier.originalVersion.date}">${dateCopy(dossier.originalVersion.date)}</time>${renderFact(dossier.originalVersion.summary, locales)}<div><h3>${label("initialFeatures", locales)}</h3><ul class="fact-list">${dossier.originalVersion.features.map((fact) => `<li>${renderFact(fact, locales)}</li>`).join("")}</ul></div><div><h3>${label("initialStructure", locales)}</h3><ul class="fact-list">${dossier.originalVersion.structure.map((fact) => `<li>${renderFact(fact, locales)}</li>`).join("")}</ul></div></div>`;
  const unknowns = dossier.unknowns.length ? dossier.unknowns.map((fact) => renderFact(fact, locales)).join("") : renderFact({ classification: "unknown", text: { en: "No additional unknowns are recorded.", zhTW: "目前沒有其他未知項目。" } }, locales);
  const sourceList = dossier.sourceRefs.map((ref) => `<li><a href="${esc(ref.url)}">${copy(ref.label)} ↗</a>${ref.path ? `<code class="source-path">${esc(ref.path)}</code>` : ""}</li>`).join("");
  const header = renderSiteHeader(locales, {
    brandHref: 'data-lang-href="../../index.html" href="../../index.html"',
    navLinks: `<a data-lang-href="../../index.html#products" href="../../index.html#products">${label("productEvolution", locales)}</a><a data-lang-href="../../index.html?product=${esc(product.id)}#history" href="../../index.html?product=${esc(product.id)}#history">${label("viewTimeline", locales)}</a><button type="button" id="print-dossier" class="text-button">${label("printDossier", locales)}</button>`
  });
  return `<a class="skip-link" href="#dossier-content">${label("skipDossier", locales)}</a>
  ${header}
  <main><section class="dossier-hero"><p class="dossier-breadcrumb"><a data-lang-href="../../index.html" href="../../index.html">${label("siteTitle", locales)}</a> / ${label("productDossier", locales)}</p><div class="dossier-hero-grid"><div><p class="eyebrow">${label("productDossier", locales)}</p><h1>${copy(product.name)}</h1><div class="lede">${copy(dossier.hero.text)}</div><p class="dossier-classification-note">${label("classificationNote", locales)}</p><div class="hero-actions"><a class="button primary" href="${esc(product.href)}">${label("viewLive", locales)} ↗</a><a class="button secondary" data-lang-href="../../index.html?product=${esc(product.id)}#history" href="../../index.html?product=${esc(product.id)}#history">${label("viewTimeline", locales)}</a></div></div><aside class="dossier-credits" aria-labelledby="dossier-credits-title"><p class="credits-label" id="dossier-credits-title">${label("credits", locales)}</p><dl class="dossier-facts"><div><dt>${label("publicStatus", locales)}</dt><dd>${label("publishedStatus", locales)}</dd></div><div><dt>${label("currentRoute", locales)}</dt><dd><a href="${esc(product.href)}">${esc(new URL(product.href).pathname)}</a></dd></div><div><dt>${label("createdInGit", locales)}</dt><dd>${dateCopy(stats.createdDate)}</dd></div><div><dt>${label("firstPublished", locales)}</dt><dd>${dateCopy(stats.publishedDate)}</dd></div><div><dt>${label("latestSignificantUpdate", locales)}</dt><dd>${dateCopy(dossier.latestSignificantUpdate)}</dd></div></dl></aside></div></section>
  <div class="dossier-layout"><aside class="dossier-toc" aria-label="${esc(locales.en.sectionNavigation)}" data-i18n-aria-label="sectionNavigation"><p>${label("onThisPage", locales)}</p><ol>${fixedToc.map(([id, value]) => `<li><a href="#${esc(id)}">${tocLabel(value)}</a></li>`).join("")}</ol></aside><article class="dossier-content" id="dossier-content">
    <section class="dossier-section" id="overview"><h2>${label("projectOverview", locales)}</h2>${renderFact(dossier.overview, locales)}</section>
    <section class="dossier-section" id="purpose"><h2>${label("whyItExists", locales)}</h2>${purpose}</section>
    <section class="dossier-section" id="original-version"><h2>${label("originalVersion", locales)}</h2>${original}</section>
    ${dossier.sections.map((section) => renderDossierSection(section, locales)).join("")}
    <section class="dossier-section" id="current-state"><h2>${label("currentState", locales)}</h2>${renderFact(dossier.currentState, locales)}</section>
    <section class="dossier-section" id="lessons"><h2>${label("lessons", locales)}</h2><ul class="fact-list">${dossier.lessons.map((fact) => `<li>${renderFact(fact, locales)}</li>`).join("")}</ul></section>
    <section class="dossier-section" id="related-history"><h2>${label("relatedHistory", locales)}</h2><h3>${label("historyEvents", locales)}</h3><ul class="related-list">${relatedEvents.map((event) => `<li><time datetime="${event.date}">${esc(event.date)}</time> — <a data-lang-href="../../index.html#${esc(event.id)}" href="../../index.html#${esc(event.id)}">${copy(event.title)}</a></li>`).join("")}</ul>${relatedReleases.length ? `<h3>${label("relatedReleases", locales)}</h3><ul class="related-list">${relatedReleases.map((release) => `<li><a data-lang-href="../../index.html#${esc(release.id)}" href="../../index.html#${esc(release.id)}"><code>${esc(release.version)}</code> — ${copy(release.title)}</a></li>`).join("")}</ul>` : ""}</section>
    <section class="dossier-section" id="evidence"><h2>${label("evidence", locales)}</h2><ul class="evidence-list">${sourceList}</ul></section>
    <section class="dossier-section" id="unknowns"><h2>${label("unknowns", locales)}</h2>${unknowns}</section>
    <div class="dossier-actions-bottom"><a class="button secondary" data-lang-href="../../index.html#products" href="../../index.html#products">${label("backToProductEvolution", locales)}</a><a class="button secondary" data-lang-href="../../index.html?product=${esc(product.id)}#history" href="../../index.html?product=${esc(product.id)}#history">${label("viewTimeline", locales)}</a></div>
  </article></div></main><footer><p>${label("footerText", locales)}</p><p><a data-lang-href="../../index.html" href="../../index.html">${label("siteTitle", locales)}</a> · <a href="${esc(product.href)}">${copy(product.name)}</a></p></footer>${backToTopButton(locales)}`;
}

function renderRelease(release, context, locales, number) {
  const children = context.releaseChildren.get(release.id) || [];
  const published = release.status === "published";
  const link = published ? release.releaseUrl : release.tagUrl;
  return `<li class="release-card ${published ? "" : "tag-only"}" id="${release.id}">
    <span class="release-number" aria-hidden="true">${String(number).padStart(2, "0")}</span>
    <code>${esc(release.version)}</code>
    <div class="release-body">
      <h4>${copy(release.title)}${published ? "" : ` <span class="status status-tag">${label("tagOnly", locales)}</span>`}</h4>
      <p>${copy(release.summary)}</p>
      ${!published ? `<p class="tag-note">${label("noPublishedRelease", locales)}</p>` : ""}
      ${children.length ? `<details><summary>${children.length} ${label("events", locales)}</summary><ul>${children.map((event) => `<li><a href="#${event.id}">${copy(event.title)}</a></li>`).join("")}</ul></details>` : ""}
    </div>
    <time datetime="${release.date}">${shortDateCopy(release.date)}</time>
    <a class="release-external" href="${esc(link)}"><span class="visually-hidden">${published ? label("published", locales) : label("tagOnly", locales)} ${esc(release.version)}</span>${icon(ICONS.external)}</a>
  </li>`;
}

function renderReleaseEras(releases, context, locales) {
  const sorted = [...releases].sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence);
  const majors = [...new Set(sorted.map((release) => release.version.match(/^v(\d+)/)[1]))];
  const fallback = (key, value) => locales.en[key] ? label(key, locales) : esc(value);
  return majors.map((major, index) => {
    const eraReleases = sorted.filter((release) => release.version.startsWith(`v${major}.`));
    const oldest = eraReleases[eraReleases.length - 1];
    const newest = eraReleases[0];
    const published = eraReleases.filter((release) => release.status === "published").length;
    const range = oldest.date === newest.date ? dateCopy(newest.date) : `${dateCopy(oldest.date)} – ${dateCopy(newest.date)}`;
    const current = index === 0;
    return `<section class="release-era ${current ? "is-current" : ""}" id="era-v${major}" aria-labelledby="era-title-v${major}">
      <div class="era-sleeve" aria-hidden="true"><span class="era-kicker">${label("era", locales)} ${major}${current ? ` · ${label("nowPlaying", locales)}` : ""}</span><strong>v${major}</strong><span class="era-caption">${fallback(`eraV${major}Title`, `v${major}`)}<small>${published} ${label("releasesUnit", locales)}</small></span></div>
      <div class="era-list"><h3 id="era-title-v${major}">${fallback(`eraV${major}Title`, `v${major}`)}</h3><p class="era-range">${range}</p>${locales.en[`eraV${major}Summary`] ? `<p class="era-summary">${label(`eraV${major}Summary`, locales)}</p>` : ""}<ol class="release-list">${eraReleases.map((release, position) => renderRelease(release, context, locales, eraReleases.length - position)).join("")}</ol></div>
    </section>`;
  }).join("");
}

function selectControl(key, options, locales) {
  return `<label><span>${label(key, locales)}</span><select id="filter-${key}" data-filter="${key}">${option("all", locales.en.all)}${options}</select></label>`;
}

function renderSiteHeader(locales, { brandHref, navLinks }) {
  return `<header class="site-header"><a class="brand" ${brandHref}><span class="brand-name">Jam Tracks Hub</span><span class="brand-sub">${label("siteTitle", locales)}</span></a><nav aria-label="${esc(locales.en.primaryNavigation)}" data-i18n-aria-label="primaryNavigation">${navLinks}</nav><div class="header-actions"><button type="button" id="theme-toggle" class="theme-toggle" hidden>${icon(ICONS.theme)}<span id="theme-label" class="visually-hidden">${esc(locales.en.darkMode)}</span></button><div class="language-switch" role="group" aria-label="${esc(locales.en.language)}" data-i18n-aria-label="language"><button type="button" data-set-lang="en" aria-pressed="true">EN</button><button type="button" data-set-lang="zh-TW" aria-pressed="false">繁中</button></div></div></header>`;
}

function renderIndexBody(data, context, locales) {
  const years = [...new Set(context.sortedEvents.map((event) => event.date.slice(0, 4)))];
  const newestMajor = context.sortedEvents.find((event) => event.level === "primary");
  const latest = context.latestPublishedRelease;
  const productOptions = context.visibleProducts.map((product) => option(product.id, product.name.en)).join("");
  const categoryOptions = Object.entries(CATEGORY_LABELS).map(([id, value]) => option(id, value.en)).join("");
  const releaseOptions = [...data.releases].sort((a, b) => b.date.localeCompare(a.date) || b.sequence - a.sequence).map((release) => option(release.id, release.version)).join("");
  const statusOptions = ["released", "reverted", "superseded", "deprecated"].map((status) => option(status, locales.en[status])).join("");
  const timeline = renderTimeline(context, locales);
  const header = renderSiteHeader(locales, {
    brandHref: 'href="#top"',
    navLinks: `<a href="#history">${label("navHistory", locales)}</a><a href="#products">${label("navProducts", locales)}</a><a href="#releases">${label("navReleases", locales)}</a><a href="./print.html">${label("printView", locales)}</a>`
  });
  return `<a class="skip-link" href="#history">${label("skipHistory", locales)}</a>
  ${header}
  <main id="top">
    <section class="hero"><div class="hero-copy"><p class="eyebrow">Jam Tracks Hub</p><h1>${label("siteTitle", locales)}</h1><p class="lede">${label("subtitle", locales)}</p><div class="hero-actions"><a class="button primary" href="#history">${label("exploreHistory", locales)}</a><a class="button secondary" href="https://jamtrackshub.com/">${label("visitSite", locales)}${icon(ICONS.external)}</a><a class="source-link" href="https://github.com/Jasper-hsury/Jam_Tracks_Hub_Development_Log">${label("viewSource", locales)}</a></div></div>
      <a class="hero-record" href="#${esc(latest.id)}"><span class="hero-sleeve"><span class="sleeve-kicker">${label("latestStable", locales)}</span><strong>${esc(latest.version)}</strong><span class="sleeve-title">${copy(latest.title)}<small><time datetime="${latest.date}">${dateCopy(latest.date)}</time></small></span></span>${recordSvg}</a></section>
    <section class="hero-meta" aria-label="${esc(locales.en.currentSnapshot)}" data-i18n-aria-label="currentSnapshot"><p class="metrics"><span><strong>${context.metrics.publishedReleases}</strong> ${label("publishedReleases", locales)}</span><span><strong>${context.metrics.productAreas}</strong> ${label("productAreas", locales)}</span><span>${label("since", locales)}</span></p><p class="snapshot"><span>${label("latestUpdate", locales)}:</span> ${copy(newestMajor.title)}</p></section>
    <section class="explore" aria-labelledby="explore-title"><h2 class="visually-hidden" id="explore-title">${label("explore", locales)}</h2><div class="filter-controls"><label class="search-control"><span class="visually-hidden">${label("searchLabel", locales)}</span>${icon(ICONS.search)}<input id="history-search" type="search" autocomplete="off" placeholder="${esc(locales.en.searchPlaceholder)}"></label><details class="filters-shell"><summary>${icon(ICONS.filters)}<span>${label("filters", locales)}</span><span class="filter-count" id="filter-count" hidden></span></summary><div class="filter-fields" role="group" aria-labelledby="filter-sheet-title"><div class="filter-sheet-head"><p id="filter-sheet-title">${label("filtersYears", locales)}</p><button type="button" class="icon-button" id="close-filters" aria-label="${esc(locales.en.closeFilters)}" data-i18n-aria-label="closeFilters">${icon(ICONS.close)}</button></div>${selectControl("category", categoryOptions, locales)}${selectControl("product", productOptions, locales)}${selectControl("release", releaseOptions, locales)}${selectControl("status", statusOptions, locales)}${selectControl("year", years.map((year) => option(year, year)).join(""), locales)}<div class="filter-sheet-foot"><button type="button" class="button primary" id="apply-filters">${label("showResults", locales)}</button></div></div></details></div><div class="result-row"><p id="result-count" role="status" aria-live="polite">${data.events.length} ${label("results", locales)}</p><div id="active-filters" class="active-filters" aria-label="${esc(locales.en.activeFilters)}" data-i18n-aria-label="activeFilters"></div><button type="button" id="reset-filters" class="reset-button">${label("reset", locales)}</button></div></section>
    <aside id="dossier-search-results" class="dossier-search-results" aria-labelledby="dossier-search-title" aria-live="polite" hidden><p class="eyebrow" id="dossier-search-title">${label("dossierMatches", locales)}</p><ul id="dossier-search-list"></ul></aside>
    <div id="hidden-target" class="hidden-target" hidden><p>${label("hiddenTarget", locales)}</p><button type="button" id="show-target">${label("showItem", locales)}</button></div>
    <section class="history-layout" id="history" tabindex="-1" aria-labelledby="timeline-title">${renderMonthRail(context, locales)}<div class="timeline"><div class="section-heading"><p class="eyebrow">${label("index", locales)}</p><h2 id="timeline-title">${label("timeline", locales)}</h2><p>${label("timelineIntro", locales)}</p></div>${timeline}<p id="no-results" class="no-results" hidden>${label("noResults", locales)}</p></div></section>
    <section class="page-section" id="products"><div class="section-heading"><p class="eyebrow">${label("index", locales)}</p><h2>${label("productEvolution", locales)}</h2><p>${label("productEvolutionIntro", locales)}</p></div><div class="product-grid">${context.visibleProducts.map((product) => renderProduct(product, context, locales)).join("")}</div></section>
    <section class="page-section release-section" id="releases"><div class="section-heading"><p class="eyebrow">${label("versions", locales)}</p><h2>${label("releaseIndex", locales)}</h2><p>${label("releaseIndexIntro", locales)}</p></div>${renderReleaseEras(data.releases, context, locales)}</section>
    <section class="page-section roadmap-section" id="roadmap"><div class="section-heading"><p class="eyebrow">${label("lookingAhead", locales)}</p><h2>${label("roadmap", locales)}</h2></div>${data.roadmap.length ? `<div class="roadmap-grid">${data.roadmap.map((item) => `<article><h3>${copy(item.title)}</h3><p>${copy(item.summary)}</p></article>`).join("")}</div>` : `<p class="empty-state">${label("roadmapEmpty", locales)}</p>`}</section>
    <section class="page-section methodology" id="methodology"><div><p class="eyebrow">${label("sources", locales)}</p><h2>${label("methodology", locales)}</h2></div><div><p>${label("methodologyText", locales)}</p><p><a href="https://github.com/Jasper-hsury/Jam_Tracks_Hub">${label("sourceRepository", locales)} ↗</a></p></div></section>
  </main><footer><p>${label("footerText", locales)}</p><p><a href="./print.html">${label("printView", locales)}</a> · <a href="https://jamtrackshub.com/">jamtrackshub.com</a></p></footer>${backToTopButton(locales)}`;
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
  const [indexTemplate, printTemplate, dossierTemplate, en, zhTW] = await Promise.all([
    read("src/templates/index.html"), read("src/templates/print.html"), read("src/templates/dossier.html"),
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
  const dossierSearch = context.visibleDossiers.map((dossier) => {
    const product = context.productById.get(dossier.productId);
    return { id: dossier.id, productId: dossier.productId, slug: dossier.slug, name: { en: product.name.en, "zh-TW": product.name.zhTW }, summary: { en: dossier.hero.text.en, "zh-TW": dossier.hero.text.zhTW }, search: buildDossierSearchDocument(dossier, product) };
  });
  const indexSiteData = JSON.stringify({ ...JSON.parse(siteData), dossiers: dossierSearch }).replaceAll("<", "\\u003c");
  const index = indexTemplate.replace("{{BODY}}", renderIndexBody(data, context, locales)).replace("{{SITE_DATA}}", indexSiteData);
  const print = printTemplate.replace("{{BODY}}", renderPrintBody(data, context));
  await rm(dist, { recursive: true, force: true });
  await mkdir(new URL("assets/", dist), { recursive: true });
  await writeFile(new URL("index.html", dist), index);
  await writeFile(new URL("print.html", dist), print);
  await cp(new URL("src/styles/site.css", root), new URL("assets/site.css", dist));
  await cp(new URL("src/styles/print.css", root), new URL("assets/print.css", dist));
  await cp(new URL("src/styles/dossier.css", root), new URL("assets/dossier.css", dist));
  await cp(new URL("src/scripts/app.js", root), new URL("assets/app.js", dist));
  await cp(new URL("src/scripts/dossier.js", root), new URL("assets/dossier.js", dist));
  const dossierOutputs = {};
  for (const dossier of context.visibleDossiers) {
    const product = context.productById.get(dossier.productId);
    const dossierData = JSON.stringify({ locales: { en, "zh-TW": zhTW }, productName: { en: product.name.en, "zh-TW": product.name.zhTW } }).replaceAll("<", "\\u003c");
    const html = dossierTemplate
      .replace("{{TITLE}}", esc(product.name.en))
      .replace("{{DESCRIPTION}}", esc(dossier.hero.text.en))
      .replace("{{BODY}}", renderDossierBody(dossier, product, context, data, locales))
      .replace("{{DOSSIER_DATA}}", dossierData);
    const outputDirectory = new URL(`products/${dossier.slug}/`, dist);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(new URL("index.html", outputDirectory), html);
    dossierOutputs[dossier.slug] = html;
  }
  return { data, context, output: { index, print, dossiers: dossierOutputs } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildSite();
    console.log(`Built index, print, and ${result.data.dossiers.length} product dossiers from ${result.data.events.length} canonical events.`);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
