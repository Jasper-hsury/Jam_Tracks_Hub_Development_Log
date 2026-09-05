import test from "node:test";
import assert from "node:assert/strict";
import { deriveData } from "../scripts/site-core.mjs";
import { loadData, scanPublicContent, validateData } from "../scripts/validate-data.mjs";

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
  assert.equal(data.dossiers.length, 9);
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

test("release rules preserve tag-only v1.4.0 and latest published v2.0.5", async () => {
  const data = await loadData();
  const tagOnly = data.releases.find((release) => release.version === "v1.4.0");
  assert.equal(tagOnly.status, "tag_only");
  assert.equal(tagOnly.releaseUrl, undefined);
  assert.equal(tagOnly.tagUrl, "https://github.com/Jasper-hsury/Jam_Tracks_Hub/tree/v1.4.0");
  assert.equal(deriveData(data).latestPublishedRelease.version, "v2.0.5");
  const brokenPublished = clone(data);
  delete brokenPublished.releases.find((release) => release.status === "published").releaseUrl;
  assert.match(validateData(brokenPublished).join("\n"), /published release URL required/);
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

test("affected dossiers align with the release and Vue migration history", async () => {
  const data = await loadData();
  const dossiers = new Map(data.dossiers.map((dossier) => [dossier.slug, dossier]));
  const commonVueEvent = "event-20260905-release-v2-0-5";

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
    assert.equal(dossier?.latestSignificantUpdate, "2026-09-05");
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
});

test("event ordering is deterministic", async () => {
  const data = await loadData();
  const first = deriveData(data).sortedEvents.map((event) => event.id);
  const second = deriveData({ ...data, events: [...data.events].reverse() }).sortedEvents.map((event) => event.id);
  assert.deepEqual(first, second);
});
