import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CATEGORY_LABELS, compareEventsNewest, deriveData } from "./site-core.mjs";

const root = new URL("../", import.meta.url);
const dataUrl = (name) => new URL(`src/data/${name}.json`, root);

export async function loadData() {
  const readJson = async (name) => JSON.parse(await readFile(dataUrl(name), "utf8"));
  const dossierDirectory = new URL("src/data/dossiers/", root);
  const dossierFiles = (await readdir(dossierDirectory)).filter((name) => name.endsWith(".json")).sort();
  return {
    products: await readJson("products"),
    events: await readJson("events"),
    releases: await readJson("releases"),
    series: await readJson("content-series"),
    roadmap: await readJson("roadmap"),
    dossiers: await Promise.all(dossierFiles.map(async (name) => JSON.parse(await readFile(new URL(name, dossierDirectory), "utf8"))))
  };
}

const idPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const eventKinds = new Set(["page_launch", "product_update", "site_update", "infrastructure", "security", "rollback", "content_series"]);
const eventLevels = new Set(["primary", "normal", "compact"]);
const eventStatuses = new Set(["released", "superseded", "deprecated"]);
const productKinds = new Set(["site", "page", "tool", "workspace", "content-library"]);
const productStatuses = new Set(["active", "deprecated", "archived"]);
const releaseStatuses = new Set(["published", "tag_only"]);
const roadmapStatuses = new Set(["planned", "exploring", "deferred"]);
const roadmapHorizons = new Set(["near-term", "later"]);
const dossierStatuses = new Set(["published"]);
const dossierSectionTypes = new Set(["text", "featureList", "architecture", "responsive", "timeline", "decision"]);
const evidenceClassifications = new Set(["verified", "reconstructed", "unknown"]);
const dossierSourceKinds = new Set(["commit", "pr", "release", "file", "docs"]);

function isLocalized(value) {
  return value && typeof value.en === "string" && value.en.trim() && typeof value.zhTW === "string" && value.zhTW.trim();
}

function validDate(value) {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function validateFact(fact, field, errors) {
  assert(fact && evidenceClassifications.has(fact.classification), `${field}: evidence classification required`, errors);
  assert(isLocalized(fact?.text), `${field}: localized fact text required`, errors);
}

function validateDossierSection(section, dossier, eventIds, errors) {
  const field = `${dossier.id}.${section.id || "section"}`;
  assert(idPattern.test(section.id || ""), `${field}: invalid section ID`, errors);
  assert(dossierSectionTypes.has(section.type), `${field}: unsupported section type`, errors);
  assert(isLocalized(section.title), `${field}: localized section title required`, errors);
  assert(Array.isArray(section.items) && section.items.length > 0, `${field}: non-empty items required`, errors);
  if (section.intro) validateFact(section.intro, `${field}.intro`, errors);
  for (const [index, item] of (section.items || []).entries()) {
    const itemField = `${field}.items[${index}]`;
    if (section.type === "text") validateFact(item, itemField, errors);
    if (["featureList", "decision"].includes(section.type)) {
      assert(isLocalized(item.title), `${itemField}: localized title required`, errors);
      validateFact(item.body, `${itemField}.body`, errors);
    }
    if (["architecture", "responsive"].includes(section.type)) {
      assert(isLocalized(item.label), `${itemField}: localized label required`, errors);
      validateFact(item.body, `${itemField}.body`, errors);
    }
    if (section.type === "timeline") {
      assert(validDate(item.date), `${itemField}: valid date required`, errors);
      assert(Boolean(item.eventId || item.sourceUrl), `${itemField}: eventId or sourceUrl required`, errors);
      if (item.eventId) assert(eventIds.has(item.eventId), `${itemField}: unknown event ${item.eventId}`, errors);
      if (item.sourceUrl) assert(/^https:\/\/github\.com\/Jasper-hsury\/Jam_Tracks_Hub\/(?:commit|pull|releases\/tag)\//.test(item.sourceUrl), `${itemField}: invalid timeline source URL`, errors);
      assert(["direct", "shared"].includes(item.impact), `${itemField}: impact must be direct or shared`, errors);
      assert(isLocalized(item.title), `${itemField}: localized title required`, errors);
      validateFact(item.body, `${itemField}.body`, errors);
    }
  }
}

function checkUniqueIds(groups, errors) {
  const seen = new Map();
  for (const [groupName, records] of Object.entries(groups)) {
    for (const record of records) {
      assert(idPattern.test(record.id || ""), `${groupName}: invalid stable ID ${record.id}`, errors);
      if (seen.has(record.id)) errors.push(`duplicate ID ${record.id} in ${seen.get(record.id)} and ${groupName}`);
      seen.set(record.id, groupName);
    }
  }
}

export function scanPublicContent(data) {
  const text = JSON.stringify(data);
  const findings = [];
  const patterns = [
    [/\/Users\//i, "local absolute path"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, "private key"],
    [/(?:api[_-]?key|password|secret|token)\s*[=:]\s*["'][^"']{8,}/i, "credential-like assignment"],
    [/authorization\s*:\s*bearer\s+[a-z0-9._-]{10,}/i, "bearer credential"],
    [/http\.request\.|ip\.src|cf\.threat_score/i, "WAF expression"],
    [/\b\d+\s+requests?\s+(?:per|\/)\s+(?:second|minute|hour)\b/i, "exact rate threshold"]
  ];
  for (const [pattern, label] of patterns) if (pattern.test(text)) findings.push(label);
  return findings;
}

export function validateData(data) {
  const errors = [];
  const { products, events, releases, series, roadmap, dossiers = [] } = data;
  checkUniqueIds({ products, events, releases, series, roadmap, dossiers }, errors);
  const productIds = new Set(products.map((item) => item.id));
  const eventIds = new Set(events.map((item) => item.id));
  const releaseIds = new Set(releases.map((item) => item.id));
  const seriesIds = new Set(series.map((item) => item.id));
  const categories = new Set(Object.keys(CATEGORY_LABELS));

  assert(categories.size === 7, "category taxonomy must contain exactly seven categories", errors);

  for (const product of products) {
    assert(isLocalized(product.name), `${product.id}: localized name required`, errors);
    assert(isLocalized(product.description), `${product.id}: localized description required`, errors);
    assert(productKinds.has(product.kind), `${product.id}: invalid product kind`, errors);
    assert(productStatuses.has(product.status), `${product.id}: invalid product status`, errors);
    assert(Number.isInteger(product.displayOrder), `${product.id}: integer displayOrder required`, errors);
  }

  for (const release of releases) {
    assert(validDate(release.date), `${release.id}: invalid release date`, errors);
    assert(Number.isInteger(release.sequence), `${release.id}: integer sequence required`, errors);
    assert(releaseStatuses.has(release.status), `${release.id}: invalid release status`, errors);
    assert(isLocalized(release.title) && isLocalized(release.summary), `${release.id}: localized release copy required`, errors);
    assert(release.tagUrl === `https://github.com/Jasper-hsury/Jam_Tracks_Hub/tree/${release.tag}`, `${release.id}: exact public tag URL required`, errors);
    if (release.status === "published") {
      assert(/^https:\/\/github\.com\/Jasper-hsury\/Jam_Tracks_Hub\/releases\/tag\/.+/.test(release.releaseUrl || ""), `${release.id}: published release URL required`, errors);
    } else {
      assert(!release.releaseUrl, `${release.id}: tag-only release must not have releaseUrl`, errors);
    }
  }

  for (const item of series) {
    assert(/^\d{4}-\d{2}$/.test(item.period), `${item.id}: invalid period`, errors);
    assert(productIds.has(item.productId), `${item.id}: unknown product`, errors);
    assert(isLocalized(item.title) && isLocalized(item.summary), `${item.id}: localized series copy required`, errors);
    assert(Number.isInteger(item.startNumber) && Number.isInteger(item.endNumber) && item.startNumber <= item.endNumber, `${item.id}: invalid number bounds`, errors);
    const numbers = (item.itemLinks || []).map((link) => link.number);
    assert(new Set(numbers).size === numbers.length, `${item.id}: duplicate series item`, errors);
    assert(numbers.every((number) => number >= item.startNumber && number <= item.endNumber), `${item.id}: series item outside bounds`, errors);
  }

  const eventById = new Map(events.map((event) => [event.id, event]));
  for (const event of events) {
    assert(validDate(event.date), `${event.id}: invalid event date`, errors);
    assert(Number.isInteger(event.sequence), `${event.id}: integer sequence required`, errors);
    assert(isLocalized(event.title) && isLocalized(event.summary), `${event.id}: localized event copy required`, errors);
    assert(eventKinds.has(event.kind), `${event.id}: invalid event kind`, errors);
    assert(eventLevels.has(event.level), `${event.id}: invalid event level`, errors);
    assert(eventStatuses.has(event.status), `${event.id}: invalid explicit event status`, errors);
    assert(categories.has(event.categoryId), `${event.id}: invalid category`, errors);
    assert(Array.isArray(event.productIds) && event.productIds.length > 0, `${event.id}: productIds required`, errors);
    for (const productId of event.productIds || []) assert(productIds.has(productId), `${event.id}: unknown product ${productId}`, errors);
    if (event.createdInGitDate) {
      assert(validDate(event.createdInGitDate), `${event.id}: invalid createdInGitDate`, errors);
      assert(event.createdInGitDate <= event.date, `${event.id}: createdInGitDate is after publication date`, errors);
    }
    if (event.releaseId) assert(releaseIds.has(event.releaseId), `${event.id}: unknown release`, errors);
    if (event.seriesId) assert(seriesIds.has(event.seriesId), `${event.id}: unknown content series`, errors);
    if (event.kind === "content_series") assert(Boolean(event.seriesId), `${event.id}: content series event requires seriesId`, errors);
    if (event.kind === "security" || event.categoryId === "security") {
      assert(event.securityDisclosure === "high_level", `${event.id}: securityDisclosure must be high_level`, errors);
    }
    if (event.reverts) {
      assert(event.kind === "rollback", `${event.id}: reverts is only allowed for rollback events`, errors);
      assert(eventIds.has(event.reverts), `${event.id}: rollback target does not exist`, errors);
      const target = eventById.get(event.reverts);
      if (target) assert(target.date < event.date || (target.date === event.date && target.sequence < event.sequence), `${event.id}: rollback target must be earlier`, errors);
    }
  }

  for (const event of events) {
    const seen = new Set([event.id]);
    let cursor = event;
    while (cursor?.reverts) {
      if (seen.has(cursor.reverts)) {
        errors.push(`${event.id}: rollback cycle detected`);
        break;
      }
      seen.add(cursor.reverts);
      cursor = eventById.get(cursor.reverts);
    }
  }

  for (const item of roadmap) {
    assert(isLocalized(item.title) && isLocalized(item.summary), `${item.id}: localized roadmap copy required`, errors);
    assert(roadmapStatuses.has(item.status), `${item.id}: invalid roadmap status`, errors);
    assert(roadmapHorizons.has(item.horizon), `${item.id}: invalid roadmap horizon`, errors);
    assert(categories.has(item.categoryId), `${item.id}: invalid roadmap category`, errors);
    for (const productId of item.productIds || []) assert(productIds.has(productId), `${item.id}: unknown roadmap product`, errors);
  }

  const dossierProductIds = new Set();
  const dossierSlugs = new Set();
  for (const dossier of dossiers) {
    assert(dossierStatuses.has(dossier.status), `${dossier.id}: invalid dossier status`, errors);
    assert(productIds.has(dossier.productId), `${dossier.id}: unknown product ${dossier.productId}`, errors);
    assert(!dossierProductIds.has(dossier.productId), `${dossier.id}: duplicate dossier product ${dossier.productId}`, errors);
    dossierProductIds.add(dossier.productId);
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dossier.slug || ""), `${dossier.id}: invalid dossier slug`, errors);
    assert(!dossierSlugs.has(dossier.slug), `${dossier.id}: duplicate dossier slug ${dossier.slug}`, errors);
    dossierSlugs.add(dossier.slug);
    assert(validDate(dossier.latestSignificantUpdate), `${dossier.id}: invalid latest significant update`, errors);
    validateFact(dossier.hero, `${dossier.id}.hero`, errors);
    validateFact(dossier.overview, `${dossier.id}.overview`, errors);
    assert(Array.isArray(dossier.purpose) && dossier.purpose.length > 0, `${dossier.id}: purpose facts required`, errors);
    for (const [index, purpose] of (dossier.purpose || []).entries()) {
      assert(isLocalized(purpose.label), `${dossier.id}.purpose[${index}]: localized label required`, errors);
      validateFact(purpose.body, `${dossier.id}.purpose[${index}].body`, errors);
    }
    assert(validDate(dossier.originalVersion?.date), `${dossier.id}: original version date required`, errors);
    validateFact(dossier.originalVersion?.summary, `${dossier.id}.originalVersion.summary`, errors);
    for (const [index, fact] of (dossier.originalVersion?.features || []).entries()) validateFact(fact, `${dossier.id}.originalVersion.features[${index}]`, errors);
    for (const [index, fact] of (dossier.originalVersion?.structure || []).entries()) validateFact(fact, `${dossier.id}.originalVersion.structure[${index}]`, errors);
    assert((dossier.originalVersion?.features || []).length > 0, `${dossier.id}: original features required`, errors);
    assert((dossier.originalVersion?.structure || []).length > 0, `${dossier.id}: original structure required`, errors);
    const sectionIds = new Set();
    assert(Array.isArray(dossier.sections) && dossier.sections.length > 0, `${dossier.id}: sections required`, errors);
    for (const section of dossier.sections || []) {
      assert(!sectionIds.has(section.id), `${dossier.id}: duplicate section ID ${section.id}`, errors);
      sectionIds.add(section.id);
      validateDossierSection(section, dossier, eventIds, errors);
    }
    validateFact(dossier.currentState, `${dossier.id}.currentState`, errors);
    assert((dossier.lessons || []).length > 0, `${dossier.id}: lessons required`, errors);
    for (const [index, fact] of (dossier.lessons || []).entries()) validateFact(fact, `${dossier.id}.lessons[${index}]`, errors);
    for (const [index, fact] of (dossier.unknowns || []).entries()) {
      validateFact(fact, `${dossier.id}.unknowns[${index}]`, errors);
      assert(fact.classification === "unknown", `${dossier.id}.unknowns[${index}]: must use unknown classification`, errors);
    }
    assert(Array.isArray(dossier.relatedEventIds) && dossier.relatedEventIds.length > 0, `${dossier.id}: related events required`, errors);
    assert(new Set(dossier.relatedEventIds || []).size === (dossier.relatedEventIds || []).length, `${dossier.id}: duplicate related event`, errors);
    for (const eventId of dossier.relatedEventIds || []) {
      assert(eventIds.has(eventId), `${dossier.id}: unknown related event ${eventId}`, errors);
      assert(eventById.get(eventId)?.productIds.includes(dossier.productId), `${dossier.id}: related event ${eventId} does not reference product`, errors);
    }
    assert(Array.isArray(dossier.sourceRefs) && dossier.sourceRefs.length > 0, `${dossier.id}: source references required`, errors);
    for (const [index, ref] of (dossier.sourceRefs || []).entries()) {
      const refField = `${dossier.id}.sourceRefs[${index}]`;
      assert(dossierSourceKinds.has(ref.kind), `${refField}: invalid source kind`, errors);
      assert(isLocalized(ref.label), `${refField}: localized label required`, errors);
      assert(/^https:\/\/github\.com\/Jasper-hsury\/Jam_Tracks_Hub\/(?:commit|pull|releases\/tag|blob|tree)\//.test(ref.url || ""), `${refField}: public source URL required`, errors);
      if (ref.path) assert(!ref.path.startsWith("/") && !ref.path.includes(".."), `${refField}: source path must be repository-relative`, errors);
    }
  }

  const sorted = [...events].sort(compareEventsNewest);
  assert(sorted[sorted.length - 1]?.date === "2026-06-06", "history must begin on 2026-06-06", errors);
  assert(events.some((event) => event.date < "2026-07-25" && event.sourceRefs?.some((ref) => ref.kind === "commit") && !event.sourceRefs?.some((ref) => ref.kind === "pr")), "early non-PR history is required", errors);
  assert(events.some((event) => event.createdInGitDate && event.createdInGitDate < event.date), "created-in-Git versus published distinction is required", errors);
  assert(!JSON.stringify(series).includes("w9.html"), "W9 must not be invented", errors);
  const v140 = releases.find((release) => release.version === "v1.4.0");
  assert(v140?.status === "tag_only" && !v140?.releaseUrl, "v1.4.0 must remain tag-only", errors);
  assert(releases.find((release) => release.version === "v2.0.0")?.status === "published", "v2.0.0 must be published", errors);
  assert(releases.find((release) => release.version === "v2.0.1")?.status === "published", "v2.0.1 must be published", errors);
  const derived = deriveData(data);
  assert(derived.latestPublishedRelease?.version === "v2.0.1", "latest published release must be v2.0.1", errors);
  const findings = scanPublicContent(data);
  for (const finding of findings) errors.push(`public-content disclosure scan: ${finding}`);
  return errors;
}

export async function runValidation() {
  const data = await loadData();
  const errors = validateData(data);
  if (errors.length) throw new Error(`Data validation failed:\n- ${errors.join("\n- ")}`);
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const data = await runValidation();
    console.log(`Canonical data valid: ${data.products.length} products, ${data.events.length} events, ${data.releases.length} releases, ${data.series.length} content series, ${data.dossiers.length} product dossiers, ${data.roadmap.length} roadmap items.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
