import test from "node:test";
import assert from "node:assert/strict";
import { deriveData } from "../scripts/site-core.mjs";
import { compareVersions, loadData, scanPublicContent, validateData } from "../scripts/validate-data.mjs";

const clone = (value) => structuredClone(value);

test("canonical datasets pass every validation rule", async () => {
  const data = await loadData();
  assert.deepEqual(validateData(data), []);
});

test("IDs are unique across canonical entity types", async () => {
  const data = await loadData();
  const ids = [...data.products, ...data.events, ...data.releases, ...data.series, ...data.roadmap, ...data.dossiers].map((record) => record.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("product dossiers have unique routes and resolve products and history", async () => {
  const data = await loadData();
  assert.equal(data.dossiers.length, 10);
  assert.equal(new Set(data.dossiers.map((dossier) => dossier.slug)).size, data.dossiers.length);
  const productIds = new Set(data.products.map((product) => product.id));
  const eventIds = new Set(data.events.map((event) => event.id));
  for (const dossier of data.dossiers) {
    assert.ok(productIds.has(dossier.productId));
    assert.ok(dossier.relatedEventIds.every((id) => eventIds.has(id)));
  }
});

test("dossier validation rejects broken schema, product references, and local paths", async () => {
  const data = await loadData();
  const brokenSection = clone(data);
  brokenSection.dossiers[0].sections[0].type = "rawHtml";
  assert.match(validateData(brokenSection).join("\n"), /unsupported section type/);
  const brokenProduct = clone(data);
  brokenProduct.dossiers[0].productId = "product-missing";
  assert.match(validateData(brokenProduct).join("\n"), /unknown product/);
  const localPath = clone(data);
  localPath.dossiers[0].sourceRefs[0].path = "/Users/example/private.txt";
  assert.match(validateData(localPath).join("\n"), /source path must be repository-relative|local absolute path/);
});

test("foreign references and dates reject invalid data", async () => {
  const data = await loadData();
  const brokenProduct = clone(data);
  brokenProduct.events[0].productIds = ["product-missing"];
  assert.match(validateData(brokenProduct).join("\n"), /unknown product/);
  const brokenRelease = clone(data);
  brokenRelease.events[0].releaseId = "release-missing";
  assert.match(validateData(brokenRelease).join("\n"), /unknown release/);
  const brokenDate = clone(data);
  brokenDate.events[0].createdInGitDate = "2026-07-01";
  assert.match(validateData(brokenDate).join("\n"), /after publication date/);
});

test("rollback relationships derive reverted status and reject cycles", async () => {
  const data = await loadData();
  const context = deriveData(data);
  const target = data.events.find((event) => event.id === "event-20260830-typography-normalization");
  assert.equal(context.statusFor(target), "reverted");
  const rollback = data.events.find((event) => event.reverts);
  assert.equal(rollback.reverts, target.id);
  const cyclic = clone(data);
  cyclic.events.find((event) => event.id === target.id).reverts = rollback.id;
  assert.match(validateData(cyclic).join("\n"), /rollback cycle|reverts is only allowed/);
});

test("security events require high-level disclosure markers", async () => {
  const data = await loadData();
  const broken = clone(data);
  delete broken.events.find((event) => event.kind === "security").securityDisclosure;
  assert.match(validateData(broken).join("\n"), /securityDisclosure must be high_level/);
  assert.deepEqual(scanPublicContent(data), []);
});

test("release rules preserve tag-only v1.4.0 and pick the highest published version as latest", async () => {
  const data = await loadData();
  const tagOnly = data.releases.find((release) => release.version === "v1.4.0");
  assert.equal(tagOnly.status, "tag_only");
  assert.equal(tagOnly.releaseUrl, undefined);
  assert.equal(tagOnly.tagUrl, "https://github.com/Jasper-hsury/Jam_Tracks_Hub/tree/v1.4.0");
  const versions = data.releases.filter((release) => release.status === "published").map((release) => release.version);
  const highest = [...versions].sort(compareVersions).at(-1);
  assert.equal(deriveData(data).latestPublishedRelease.version, highest);
  const brokenPublished = clone(data);
  delete brokenPublished.releases.find((release) => release.status === "published").releaseUrl;
  assert.match(validateData(brokenPublished).join("\n"), /published release URL required/);
});

test("compareVersions orders release versions numerically", () => {
  assert.ok(compareVersions("v4.1.10", "v4.1.9") > 0);
  assert.ok(compareVersions("v4.0.0", "v3.5.3") > 0);
  assert.equal(compareVersions("v4.1.2", "v4.1.2"), 0);
});

test("validation flags a newer release whose date or sequence hides it behind an older one", async () => {
  const data = await loadData();
  const latest = deriveData(data).latestPublishedRelease;
  const misdated = clone(data);
  const next = { ...clone(latest), id: "release-v99.0.0", version: "v99.0.0", tag: "v99.0.0", date: "2026-01-01" };
  misdated.releases.push(next);
  assert.match(validateData(misdated).join("\n"), /latest published release must be the highest version v99\.0\.0/);
  const withoutEvent = clone(data);
  withoutEvent.releases.push({ ...next, date: "2099-01-01", sequence: 10 });
  assert.match(validateData(withoutEvent).join("\n"), /latest release v99\.0\.0 needs its release event event-20990101-release-v99-0-0/);
  const unpublished = clone(data);
  unpublished.releases.find((release) => release.id === latest.id).status = "tag_only";
  assert.match(validateData(unpublished).join("\n"), new RegExp(`${latest.version.replaceAll(".", "\\.")} must be published`));
});

test("v2.0.2 through v2.0.5 preserve stable release and event relationships", async () => {
  const data = await loadData();
  const expectedReleases = new Map([
    ["release-v2.0.2", "5c6403e20ede2c691e2d2a73888bdc1fab3eeace"],
    ["release-v2.0.3", "bdf5b694cd4bb7ea153ddfc258378b97144f50ee"],
    ["release-v2.0.4", "9f524d86138b583bd5126a8a9b39c6a3237033e5"],
    ["release-v2.0.5", "045efd59878e8fe2b8097117cb8ba4809d3573cf"]
  ]);
  for (const [id, tagCommit] of expectedReleases) {
    const release = data.releases.find((item) => item.id === id);
    assert.equal(release?.status, "published");
    assert.equal(release?.tagCommit, tagCommit);
  }

  const expectedEvents = new Map([
    ["event-20260831-release-v2-0-2", "release-v2.0.2"],
    ["event-20260903-release-v2-0-3", "release-v2.0.3"],
    ["event-20260903-release-v2-0-4", "release-v2.0.4"],
    ["event-20260904-key-finder-vue-migration", "release-v2.0.5"],
    ["event-20260904-song-workspace-vue-migration", "release-v2.0.5"],
    ["event-20260905-release-v2-0-5", "release-v2.0.5"]
  ]);
  for (const [id, releaseId] of expectedEvents) assert.equal(data.events.find((event) => event.id === id)?.releaseId, releaseId);
  const septemberThird = deriveData(data).sortedEvents.filter((event) => event.date === "2026-09-03");
  assert.deepEqual(septemberThird.map((event) => event.id), ["event-20260903-release-v2-0-4", "event-20260903-release-v2-0-3"]);
  assert.deepEqual(validateData(data), []);
});

test("v2.0.6 links one analytics milestone while keeping merge and release dates distinct", async () => {
  const data = await loadData();
  const context = deriveData(data);
  const release = data.releases.find((item) => item.id === "release-v2.0.6");
  assert.equal(release.id, "release-v2.0.6");
  assert.equal(release.status, "published");
  assert.equal(release.tag, "v2.0.6");
  assert.equal(release.tagCommit, "54fd0c867fd064bbfa2f0f074e09da170c89e729");
  assert.equal(release.title.en, "Reliable All-Time Analytics Snapshots");
  assert.equal(release.releaseUrl, "https://github.com/Jasper-hsury/Jam_Tracks_Hub/releases/tag/v2.0.6");
  const localDate = (utc) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(utc));
  assert.equal(release.date, localDate("2026-09-16T23:37:47Z"));
  const children = context.releaseChildren.get(release.id);
  assert.equal(children.length, 1);
  const [event] = children;
  assert.equal(event.id, "event-20260916-all-time-analytics-reliability");
  assert.equal(event.date, localDate("2026-09-16T14:13:37Z"));
  assert.ok(event.date < release.date);
  assert.equal(event.kind, "infrastructure");
  assert.equal(event.categoryId, "platform");
  assert.deepEqual(event.productIds, ["product-jam-tracks-hub"]);
  assert.ok(context.sortedEvents.indexOf(event) < context.sortedEvents.findIndex((item) => item.id === "event-20260905-release-v2-0-5"));
  for (const lang of ["en", "zhTW"]) {
    assert.match(event.summary[lang], /Umami/);
    assert.match(event.summary[lang], /All Time/);
  }
  assert.ok(event.sourceRefs.some((ref) => ref.kind === "pr" && ref.url === "https://github.com/Jasper-hsury/Jam_Tracks_Hub/pull/56"));
  assert.ok(event.sourceRefs.some((ref) => ref.kind === "commit" && ref.url.endsWith("/1a2a72a93b6fced3124e8f2a6bacc7fe158df313")));
  assert.ok(event.sourceRefs.some((ref) => ref.kind === "release" && ref.url === release.releaseUrl));
});

test("v3.0.0 through v3.4.0 record the Liner Notes redesign in Taipei time", async () => {
  const data = await loadData();
  const context = deriveData(data);
  const localDate = (utc) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(utc));
  const expected = [
    ["3.0.0", 84, "7805eb90bcb09dda00b0ffeafcbe0712dd94645a", "2026-10-14T07:05:15Z", "2026-10-14T07:07:08Z"],
    ["3.1.0", 85, "354e63bae5a3ce294db440fe85474a650c2c3f48", "2026-10-14T07:58:49Z", "2026-10-14T08:00:16Z"],
    ["3.2.0", 86, "d31a41f1075ce74920c189d3c8fc2e0c8e3d09c0", "2026-10-14T22:52:34Z", "2026-10-14T22:56:15Z"],
    ["3.3.0", 87, "984f1cb13e12fa76359dffc5a9b44a3153930768", "2026-10-15T00:21:12Z", "2026-10-15T00:23:48Z"],
    ["3.4.0", 89, "ddb04b142bf2d2c3fd332cb2c044748d67d15779", "2026-10-15T06:28:10Z", "2026-10-15T06:33:37Z"]
  ];
  for (const [version, pr, tagCommit, mergedAt, publishedAt] of expected) {
    const release = data.releases.find((item) => item.id === `release-v${version}`);
    assert.equal(release?.status, "published");
    assert.equal(release.tagCommit, tagCommit);
    assert.equal(release.date, localDate(publishedAt));
    assert.equal(release.releaseUrl, `https://github.com/Jasper-hsury/Jam_Tracks_Hub/releases/tag/v${version}`);
    const children = context.releaseChildren.get(release.id);
    assert.equal(children.length, 1);
    const [event] = children;
    assert.equal(event.id, `event-${localDate(mergedAt).replaceAll("-", "")}-release-v${version.replaceAll(".", "-")}`);
    assert.equal(event.date, localDate(mergedAt));
    assert.equal(event.categoryId, "release");
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "pr" && ref.url.endsWith(`/pull/${pr}`)));
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "commit" && ref.url.endsWith(`/${tagCommit}`)));
    assert.ok(event.keywords.includes("Liner Notes"));
    for (const lang of ["en", "zhTW"]) assert.ok(event.details[lang].trim());
  }
  assert.equal(data.releases.find((item) => item.version === "v3.2.0").date, "2026-10-15");
  const newest = context.sortedEvents.slice(13, 18).map((event) => event.id);
  assert.deepEqual(newest, [
    "event-20261015-release-v3-4-0",
    "event-20261015-release-v3-3-0",
    "event-20261015-release-v3-2-0",
    "event-20261014-release-v3-1-0",
    "event-20261014-release-v3-0-0"
  ]);
  assert.deepEqual(validateData(data), []);
});

test("v3.5.3 through v4.0.1 record the polish, the Jazz Stage redesign and the image fix in Taipei time", async () => {
  const data = await loadData();
  const context = deriveData(data);
  const localDate = (utc) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(utc));
  const expected = [
    ["3.5.3", 94, "b927bae4d3d6fbb1d76ec3c216fcbbedc5617b6a", "2026-10-16T23:48:47Z", "2026-10-16T23:56:00Z", ["product-jam-tracks-hub", "product-tracks", "product-song-workspace"]],
    ["4.0.0", 97, "8f8f9798f4fe734a8bd9281ca67b424c399b3314", "2026-10-18T15:14:42Z", "2026-10-18T15:22:22Z", ["product-jam-tracks-hub", "product-homepage", "product-scale-explorer", "product-service-support"]],
    ["4.0.1", 98, "c8131f859ff8fd96a61bd413fad746fcd9abef9f", "2026-10-18T23:38:18Z", "2026-10-18T23:43:33Z", ["product-scale-explorer"]]
  ];
  for (const [version, pr, tagCommit, mergedAt, publishedAt, products] of expected) {
    const release = data.releases.find((item) => item.id === `release-v${version}`);
    assert.equal(release?.status, "published");
    assert.equal(release.tagCommit, tagCommit);
    assert.equal(release.date, localDate(publishedAt));
    const [event] = context.releaseChildren.get(release.id);
    assert.equal(event.id, `event-${localDate(mergedAt).replaceAll("-", "")}-release-v${version.replaceAll(".", "-")}`);
    assert.equal(event.date, localDate(mergedAt));
    assert.equal(event.categoryId, "release");
    for (const product of products) assert.ok(event.productIds.includes(product), `${version} lists ${product}`);
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "pr" && ref.url.endsWith(`/pull/${pr}`)));
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "commit" && ref.url.endsWith(`/${tagCommit}`)));
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "release" && ref.url === release.releaseUrl));
    for (const lang of ["en", "zhTW"]) assert.ok(event.details[lang].trim());
  }
  assert.deepEqual(context.sortedEvents.slice(7, 10).map((event) => event.id), [
    "event-20261019-release-v4-0-1",
    "event-20261018-release-v4-0-0",
    "event-20261017-release-v3-5-3"
  ]);
  const dossiers = new Map(data.dossiers.map((dossier) => [dossier.slug, dossier]));
  assert.match(dossiers.get("homepage").currentState.text.en, /JAM TRACKS HUB title/);
  assert.match(dossiers.get("scale-explorer").currentState.text.en, /follows the page language/);
  for (const slug of ["tracks", "chord-dictionary", "scale-explorer", "key-finder", "chord-progressions", "progression-writer", "fretboard-trainer", "song-workspace"]) {
    assert.ok(dossiers.get(slug).relatedEventIds.includes("event-20261017-release-v3-5-3"), `${slug} links v3.5.3`);
  }
  assert.ok(dossiers.get("scale-explorer").relatedEventIds.includes("event-20261019-release-v4-0-1"));
  assert.deepEqual(validateData(data), []);
});

test("v4.0.2 through v4.1.1 record the v4 polish, Chord Lab and the Key Finder console fix in Taipei time", async () => {
  const data = await loadData();
  const context = deriveData(data);
  const localDate = (utc) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(utc));
  const expected = [
    ["4.0.2", 100, "ba3f7019b54852484bd6ff32dfd2a4eafa6280d4", "2026-10-19T04:08:51Z", "2026-10-19T04:17:29Z", ["product-homepage"]],
    ["4.0.3", 101, "8b761be0b4691ddd57a5bf2a8ab9757f56cb0f86", "2026-10-19T13:27:44Z", "2026-10-19T13:44:05Z", ["product-jam-tracks-hub", "product-tracks", "product-progression-writer", "product-song-workspace"]],
    ["4.0.4", 103, "80c4bec3bd4dd77a70fe83625853479d685d1dba", "2026-10-21T00:00:01Z", "2026-10-21T00:21:28Z", ["product-chord-dictionary", "product-progression-writer", "product-song-workspace"]],
    ["4.0.5", 105, "a55e38eb143b3c9221c8b204c204d92056bc6822", "2026-10-21T06:24:52Z", "2026-10-21T06:33:14Z", ["product-homepage", "product-progression-writer", "product-song-workspace"]],
    ["4.1.0", 129, "021c740f0a56d8fbf117b13bbc27c7eed116930a", "2026-11-22T12:58:40Z", "2026-11-22T13:21:42Z", ["product-chord-lab"]],
    ["4.1.1", 130, "e00292c872d8f38bcbb42a5455cb90e039758207", "2026-11-22T13:11:40Z", "2026-11-22T13:17:19Z", ["product-key-finder"]]
  ];
  for (const [version, pr, tagCommit, mergedAt, publishedAt, products] of expected) {
    const release = data.releases.find((item) => item.id === `release-v${version}`);
    assert.equal(release?.status, "published");
    assert.equal(release.tagCommit, tagCommit);
    assert.equal(release.date, localDate(publishedAt));
    const [event] = context.releaseChildren.get(release.id);
    assert.equal(event.id, `event-${localDate(mergedAt).replaceAll("-", "")}-release-v${version.replaceAll(".", "-")}`);
    assert.equal(event.date, localDate(mergedAt));
    assert.equal(event.categoryId, "release");
    for (const product of products) assert.ok(event.productIds.includes(product), `${version} lists ${product}`);
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "pr" && ref.url.endsWith(`/pull/${pr}`)));
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "commit" && ref.url.endsWith(`/${tagCommit}`)));
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "release" && ref.url === release.releaseUrl));
    for (const lang of ["en", "zhTW"]) assert.ok(event.details[lang].trim());
  }
  assert.deepEqual(context.sortedEvents.slice(1, 7).map((event) => event.id), [
    "event-20261122-release-v4-1-1",
    "event-20261122-release-v4-1-0",
    "event-20261021-release-v4-0-5",
    "event-20261021-release-v4-0-4",
    "event-20261019-release-v4-0-3",
    "event-20261019-release-v4-0-2"
  ]);
  const chordLab = context.productById.get("product-chord-lab");
  assert.equal(chordLab?.kind, "tool");
  assert.ok(context.visibleProducts.findIndex((product) => product.id === "product-chord-lab") === context.visibleProducts.findIndex((product) => product.id === "product-chord-dictionary") + 1);
  assert.equal(context.productStats.get("product-chord-lab").publishedDate, "2026-11-22");
  assert.equal(context.releaseChildren.get("release-v4.1.0")[0].kind, "page_launch");
  assert.equal(context.releaseChildren.get("release-v4.1.1")[0].level, "normal");
  assert.equal(context.sortedEvents.find((event) => event.level === "primary" && event.date < "2026-11-23").id, "event-20261122-release-v4-1-0");
  const dossiers = new Map(data.dossiers.map((dossier) => [dossier.slug, dossier]));
  for (const [slug, eventId] of [
    ["homepage", "event-20261019-release-v4-0-2"],
    ["tracks", "event-20261019-release-v4-0-3"],
    ["chord-dictionary", "event-20261021-release-v4-0-4"],
    ["progression-writer", "event-20261021-release-v4-0-5"],
    ["song-workspace", "event-20261021-release-v4-0-5"],
    ["key-finder", "event-20261122-release-v4-1-1"]
  ]) assert.ok(dossiers.get(slug).relatedEventIds.includes(eventId), `${slug} links ${eventId}`);
  assert.match(dossiers.get("chord-dictionary").currentState.text.en, /Chord Lab \(v4\.1\.0, PR #129\)/);
  assert.deepEqual(validateData(data), []);
});

test("v4.1.2 groups the tools by task and Chord Lab has a dossier", async () => {
  const data = await loadData();
  const context = deriveData(data);
  const release = data.releases.find((item) => item.id === "release-v4.1.2");
  assert.equal(release?.status, "published");
  assert.equal(release.tagCommit, "7e9e005455e82ba4356cd48a3b4fec6861347176");
  assert.equal(release.date, "2026-11-23");
  const [event] = context.releaseChildren.get(release.id);
  assert.equal(event.id, "event-20261123-release-v4-1-2");
  assert.equal(context.sortedEvents[0].id, event.id);
  assert.equal(context.sortedEvents.find((item) => item.level === "primary").id, event.id);
  for (const product of ["product-homepage", "product-chord-lab"]) assert.ok(event.productIds.includes(product));
  assert.ok(event.sourceRefs.some((ref) => ref.kind === "pr" && ref.url.endsWith("/pull/132")));
  assert.ok(event.sourceRefs.some((ref) => ref.kind === "release" && ref.url === release.releaseUrl));
  const dossier = data.dossiers.find((item) => item.slug === "chord-lab");
  assert.equal(dossier?.productId, "product-chord-lab");
  assert.equal(dossier.latestSignificantUpdate, "2026-11-23");
  assert.deepEqual(dossier.relatedEventIds, ["event-20261122-release-v4-1-0", "event-20261123-release-v4-1-2"]);
  assert.deepEqual(dossier.sections.map((section) => section.type), ["architecture", "responsive", "decision", "timeline"]);
  assert.equal(context.visibleDossiers.findIndex((item) => item.slug === "chord-lab"), context.visibleDossiers.findIndex((item) => item.slug === "chord-dictionary") + 1);
  const homepage = data.dossiers.find((item) => item.slug === "homepage");
  assert.ok(homepage.relatedEventIds.includes(event.id));
  assert.match(homepage.currentState.text.en, /v4\.1\.2 \(PR #132\)/);
  assert.deepEqual(validateData(data), []);
});

test("v3.5.0 through v3.5.2 record the handwritten title and layout fixes in Taipei time", async () => {
  const data = await loadData();
  const context = deriveData(data);
  const localDate = (utc) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(utc));
  const expected = [
    ["3.5.0", 91, "293ce9b09e157db7ae9a49a5b2044a5cf83d4384", "2026-10-16T02:12:07Z", "2026-10-16T02:14:47Z", ["product-homepage"]],
    ["3.5.1", 92, "bb6cad332eed02de5087f8155450a4ddcb1fc90e", "2026-10-16T06:41:10Z", "2026-10-16T06:43:05Z", ["product-homepage", "product-chord-progressions"]],
    ["3.5.2", 93, "b2d13f4a17577c85797148198eea117524b7a22d", "2026-10-16T12:10:57Z", "2026-10-16T12:13:33Z", ["product-tracks", "product-song-workspace", "product-privacy"]]
  ];
  for (const [version, pr, tagCommit, mergedAt, publishedAt, products] of expected) {
    const release = data.releases.find((item) => item.id === `release-v${version}`);
    assert.equal(release?.status, "published");
    assert.equal(release.tagCommit, tagCommit);
    assert.equal(release.date, localDate(publishedAt));
    const [event] = context.releaseChildren.get(release.id);
    assert.equal(event.id, `event-${localDate(mergedAt).replaceAll("-", "")}-release-v${version.replaceAll(".", "-")}`);
    assert.equal(event.categoryId, "release");
    for (const product of products) assert.ok(event.productIds.includes(product), `${version} lists ${product}`);
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "pr" && ref.url.endsWith(`/pull/${pr}`)));
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "commit" && ref.url.endsWith(`/${tagCommit}`)));
    assert.ok(event.sourceRefs.some((ref) => ref.kind === "release" && ref.url === release.releaseUrl));
    for (const lang of ["en", "zhTW"]) assert.ok(event.details[lang].trim());
  }
  assert.deepEqual(context.sortedEvents.slice(10, 13).map((event) => event.id), [
    "event-20261016-release-v3-5-2",
    "event-20261016-release-v3-5-1",
    "event-20261016-release-v3-5-0"
  ]);
  const dossiers = new Map(data.dossiers.map((dossier) => [dossier.slug, dossier]));
  assert.match(dossiers.get("homepage").currentState.text.en, /handwritten title from v3\.5\.0/);
  assert.match(dossiers.get("chord-progressions").currentState.text.en, /chords above full-width shapes/);
  for (const slug of ["tracks", "chord-dictionary", "scale-explorer", "key-finder", "chord-progressions", "progression-writer", "fretboard-trainer", "song-workspace"]) {
    assert.ok(dossiers.get(slug).relatedEventIds.includes("event-20261016-release-v3-5-2"), `${slug} links v3.5.2`);
  }
  assert.deepEqual(validateData(data), []);
});

test("affected dossiers align with the release, Vue migration, and Liner Notes history", async () => {
  const data = await loadData();
  const dossiers = new Map(data.dossiers.map((dossier) => [dossier.slug, dossier]));
  const commonVueEvent = "event-20260905-release-v2-0-5";
  const latestUpdates = {
    "scale-explorer": "2026-10-19",
    tracks: "2026-10-19",
    homepage: "2026-11-23",
    "chord-dictionary": "2026-10-21",
    "progression-writer": "2026-10-21",
    "song-workspace": "2026-10-21",
    "key-finder": "2026-11-22"
  };

  for (const slug of [
    "homepage",
    "tracks",
    "fretboard-trainer",
    "chord-progressions",
    "scale-explorer",
    "chord-dictionary",
    "progression-writer",
    "key-finder",
    "song-workspace"
  ]) {
    const dossier = dossiers.get(slug);
    assert.equal(dossier?.latestSignificantUpdate, latestUpdates[slug] || "2026-10-18");
    assert.match(`${dossier?.currentState.text.en} ${dossier?.currentState.text.zhTW}`, /Jazz Stage/);
    assert.ok(dossier?.relatedEventIds.includes("event-20261018-release-v4-0-0"), `${slug} links v4.0.0`);
    assert.ok(dossier?.relatedEventIds.some((id) => /^event-2026101[45]-release-v3-/.test(id)), `${slug} links its v3 release`);
    assert.match(`${dossier?.currentState.text.en} ${dossier?.currentState.text.zhTW}`, /Liner Notes/);
    assert.ok(dossier?.relatedEventIds.includes(commonVueEvent));
    assert.match(`${dossier?.currentState.text.en} ${dossier?.currentState.text.zhTW}`, /Vue/);
  }

  assert.ok(dossiers.get("tracks").relatedEventIds.includes("event-20260903-release-v2-0-4"));
  assert.match(dossiers.get("tracks").currentState.text.en, /18 supported entries/);
  assert.match(dossiers.get("tracks").currentState.text.en, /no W9 record/);

  assert.ok(dossiers.get("key-finder").relatedEventIds.includes("event-20260904-key-finder-vue-migration"));
  assert.match(dossiers.get("key-finder").currentState.text.en, /Render compute and analysis pipeline/);

  assert.ok(dossiers.get("song-workspace").relatedEventIds.includes("event-20260831-release-v2-0-2"));
  assert.ok(dossiers.get("song-workspace").relatedEventIds.includes("event-20260904-song-workspace-vue-migration"));
  assert.match(dossiers.get("song-workspace").currentState.text.en, /IndexedDB/);
  assert.match(dossiers.get("song-workspace").currentState.text.en, /Existing saved songs remain compatible/);

  const homepage = dossiers.get("homepage");
  const evolution = homepage.sections.find((section) => section.id === "evolution").items;
  const updates = [
    ["event-20260907-homepage-workflow-refinement", "2026-09-07", "46", "8ebc43560119e35bff33069f2d0da5f1fcc76507"],
    ["event-20260920-homepage-bilingual-about-copy", "2026-09-20", "62", "866946f4d51231bb2d25ce656e5050956d475b83"]
  ];
  assert.deepEqual(evolution.slice(-6, -4).map((item) => item.eventId), updates.map(([id]) => id));
  assert.deepEqual(evolution.slice(-4).map((item) => item.eventId), [
    "event-20261014-release-v3-0-0",
    "event-20261016-release-v3-5-0",
    "event-20261016-release-v3-5-1",
    "event-20261018-release-v4-0-0"
  ]);
  for (const [id, date, pr, sha] of updates) {
    const event = data.events.find((item) => item.id === id);
    assert.equal(event?.date, date);
    assert.deepEqual(event.productIds, ["product-homepage"]);
    assert.equal(event.releaseId, undefined);
    assert.ok(homepage.relatedEventIds.includes(id));
    assert.equal(evolution.find((item) => item.eventId === id)?.date, date);
    for (const refs of [event.sourceRefs, homepage.sourceRefs]) {
      assert.ok(refs.some((ref) => ref.url === `https://github.com/Jasper-hsury/Jam_Tracks_Hub/pull/${pr}`));
      assert.ok(refs.some((ref) => ref.url === `https://github.com/Jasper-hsury/Jam_Tracks_Hub/commit/${sha}`));
    }
  }
  assert.match(homepage.currentState.text.en, /four purpose-led workflow groups/);
  assert.match(homepage.currentState.text.en, /three-paragraph About/);
  assert.match(homepage.currentState.text.zhTW, /四組目的導向使用流程/);
  assert.match(homepage.currentState.text.zhTW, /三段式關於/);
});

test("current dossier architecture distinguishes HTML mount shells from cited Vue interfaces", async () => {
  const context = deriveData(await loadData());
  const pages = [
    ["song-workspace", "song-workspace.html", "SongWorkspaceView.vue"],
    ["tracks", "tracks.html", "TracksView.vue"],
    ["progression-writer", "progression-writer.html", "ProgressionWriterView.vue"],
    ["chord-progressions", "chord-progressions.html", "ChordProgressionsView.vue"],
    ["chord-dictionary", "chord-dictionary.html", "ChordDictionaryView.vue"],
    ["scale-explorer", "scale.html", "ScaleExplorerView.vue"],
    ["fretboard-trainer", "fretboard-trainer.html", "FretboardTrainerView.vue"]
  ];
  for (const [slug, html, view] of pages) {
    const dossier = context.visibleDossiers.find((item) => item.slug === slug);
    assert.ok(dossier, `${slug}: published dossier remains visible`);
    assert.ok(context.visibleProducts.some((product) => product.id === dossier.productId));
    const page = dossier.sections.find((section) => section.type === "architecture").items[0].body;
    assert.equal(page.classification, "verified");
    for (const lang of ["en", "zhTW"]) {
      assert.ok(page.text[lang].includes(html), `${slug}/${lang}: identify the HTML shell`);
      assert.ok(page.text[lang].includes(`src/views/${view}`), `${slug}/${lang}: identify the Vue interface`);
    }
    assert.match(page.text.en, /Vue mount shell/);
    assert.match(page.text.zhTW, /Vue 掛載外殼/);
    for (const path of [html, `src/views/${view}`]) {
      assert.ok(dossier.sourceRefs.some((ref) => ref.kind === "file" && ref.path === path
        && /^https:\/\/github\.com\/Jasper-hsury\/Jam_Tracks_Hub\/blob\/[a-f0-9]{40}\//.test(ref.url)
        && ref.url.endsWith(`/${path}`)), `${slug}: immutable source for ${path}`);
    }
  }
});

test("event ordering is deterministic", async () => {
  const data = await loadData();
  const first = deriveData(data).sortedEvents.map((event) => event.id);
  const second = deriveData({ ...data, events: [...data.events].reverse() }).sortedEvents.map((event) => event.id);
  assert.deepEqual(first, second);
});
