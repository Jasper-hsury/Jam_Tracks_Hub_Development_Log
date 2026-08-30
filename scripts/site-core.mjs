export const CATEGORY_LABELS = {
  product: { en: "Product & Features", zhTW: "產品與功能" },
  experience: { en: "Experience & Accessibility", zhTW: "體驗與無障礙" },
  content: { en: "Tracks & Content", zhTW: "音軌與內容" },
  release: { en: "Releases", zhTW: "版本" },
  platform: { en: "Platform & Infrastructure", zhTW: "平台與基礎設施" },
  security: { en: "Security", zhTW: "安全" },
  maintenance: { en: "Maintenance & Recovery", zhTW: "維護與復原" }
};

export const normalizeText = (value = "") => String(value)
  .normalize("NFKC")
  .toLocaleLowerCase()
  .trim()
  .replace(/\s+/gu, " ");

export const compareEventsNewest = (a, b) =>
  b.date.localeCompare(a.date) ||
  b.sequence - a.sequence ||
  a.id.localeCompare(b.id);

export function deriveData({ events, releases, products, series }) {
  const sortedEvents = [...events].sort(compareEventsNewest);
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const seriesById = new Map(series.map((item) => [item.id, item]));
  const rollbackByTarget = new Map(events.filter((event) => event.reverts).map((event) => [event.reverts, event]));
  const statusFor = (event) => rollbackByTarget.has(event.id) ? "reverted" : event.status;
  const published = releases.filter((release) => release.status === "published");
  const latestPublishedRelease = [...published].sort((a, b) =>
    b.date.localeCompare(a.date) || b.sequence - a.sequence || a.id.localeCompare(b.id)
  )[0];
  const visibleProducts = products
    .filter((product) => product.status === "active" && product.classification !== "SYSTEM_SUPPORT_PAGE")
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  const productStats = new Map(visibleProducts.map((product) => {
    const related = sortedEvents.filter((event) => event.productIds.includes(product.id));
    const ascending = [...related].sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence);
    const launch = ascending.find((event) => event.kind === "page_launch") || ascending[0];
    return [product.id, {
      eventCount: related.length,
      createdDate: launch?.createdInGitDate || launch?.date || null,
      publishedDate: launch?.date || null,
      latestDate: related[0]?.date || null
    }];
  }));
  const releaseChildren = new Map(releases.map((release) => [
    release.id,
    sortedEvents.filter((event) => event.releaseId === release.id)
  ]));
  return {
    sortedEvents,
    releaseById,
    productById,
    seriesById,
    rollbackByTarget,
    statusFor,
    latestPublishedRelease,
    visibleProducts,
    productStats,
    releaseChildren,
    metrics: {
      publishedReleases: published.length,
      productAreas: visibleProducts.length,
      developmentSince: [...events].sort((a, b) => a.date.localeCompare(b.date))[0]?.date
    }
  };
}

export function buildSearchDocument(event, { releaseById, productById, seriesById }) {
  const release = event.releaseId ? releaseById.get(event.releaseId) : null;
  const series = event.seriesId ? seriesById.get(event.seriesId) : null;
  const products = event.productIds.map((id) => productById.get(id)).filter(Boolean);
  const values = [
    event.id, event.date, event.date.slice(0, 4), event.title.en, event.title.zhTW,
    event.summary.en, event.summary.zhTW, event.details?.en, event.details?.zhTW,
    CATEGORY_LABELS[event.categoryId]?.en, CATEGORY_LABELS[event.categoryId]?.zhTW,
    ...products.flatMap((product) => [product.name.en, product.name.zhTW]),
    release?.version, release?.tag, release?.title.en, release?.title.zhTW,
    series?.title.en, series?.title.zhTW, series?.summary.en, series?.summary.zhTW,
    ...(series?.itemLinks || []).map((item) => `${series.prefix}${item.number}`),
    ...(event.keywords || [])
  ];
  return normalizeText(values.filter(Boolean).join(" "));
}

export function sanitizeState(input, options) {
  const take = (key) => options[key].has(input[key]) ? input[key] : "all";
  return {
    year: take("year"),
    product: take("product"),
    category: take("category"),
    release: take("release"),
    status: take("status"),
    sort: input.sort === "oldest" ? "oldest" : "newest",
    search: String(input.search || ""),
    lang: input.lang === "zh-TW" ? "zh-TW" : "en"
  };
}

export function eventMatches(event, state, context) {
  const status = context.statusFor(event);
  if (state.year !== "all" && event.date.slice(0, 4) !== state.year) return false;
  if (state.product !== "all" && !event.productIds.includes(state.product)) return false;
  if (state.category !== "all" && event.categoryId !== state.category) return false;
  if (state.release !== "all" && event.releaseId !== state.release) return false;
  if (state.status !== "all" && status !== state.status) return false;
  const tokens = normalizeText(state.search).split(" ").filter(Boolean);
  return tokens.every((token) => context.searchDocuments.get(event.id).includes(token));
}
