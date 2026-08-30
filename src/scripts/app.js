(() => {
  const payload = JSON.parse(document.querySelector("#site-data").textContent);
  const cards = [...document.querySelectorAll("[data-event-id]")];
  const controls = Object.fromEntries([...document.querySelectorAll("[data-filter]")].map((control) => [control.dataset.filter, control]));
  const search = document.querySelector("#history-search");
  const resultCount = document.querySelector("#result-count");
  const activeFilters = document.querySelector("#active-filters");
  const noResults = document.querySelector("#no-results");
  const hiddenTarget = document.querySelector("#hidden-target");
  const filtersShell = document.querySelector(".filters-shell");
  const themeToggle = document.querySelector("#theme-toggle");
  const themeLabel = document.querySelector("#theme-label");
  const mobileFilters = matchMedia("(max-width: 760px)");
  const darkMode = matchMedia("(prefers-color-scheme: dark)");
  const themeStorageKey = "jam-tracks-hub-log-theme";
  const valid = {
    year: new Set(["all", ...payload.options.years]),
    product: new Set(["all", ...payload.options.products]),
    category: new Set(["all", ...payload.options.categories]),
    release: new Set(["all", ...payload.options.releases]),
    status: new Set(["all", ...payload.options.statuses])
  };
  const normalize = (value = "") => String(value).normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/gu, " ");
  const fromUrl = () => {
    const params = new URLSearchParams(location.search);
    const state = {
      year: params.get("year") || "all",
      product: params.get("product") || "all",
      category: params.get("category") || "all",
      release: params.get("release") || "all",
      status: params.get("status") || "all",
      sort: "newest",
      search: "",
      lang: params.get("lang") === "zh-TW" ? "zh-TW" : "en"
    };
    for (const key of ["year", "product", "category", "release", "status"]) {
      if (!valid[key].has(state[key])) state[key] = "all";
    }
    return state;
  };
  let state = fromUrl();

  const storedTheme = () => {
    try {
      const value = localStorage.getItem(themeStorageKey);
      return value === "light" || value === "dark" ? value : null;
    } catch { return null; }
  };
  const updateThemeControl = () => {
    const isDark = document.documentElement.dataset.theme === "dark";
    const nextThemeLabel = t(isDark ? "lightMode" : "darkMode");
    themeToggle.hidden = false;
    themeToggle.setAttribute("aria-label", nextThemeLabel);
    themeToggle.title = nextThemeLabel;
    themeLabel.textContent = nextThemeLabel;
  };
  const setTheme = (theme, { persist = true } = {}) => {
    document.documentElement.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem(themeStorageKey, theme); } catch { /* Preference persistence is optional. */ }
    }
    updateThemeControl();
  };

  const syncFilterPanelMode = (query) => { filtersShell.open = !query.matches; };
  syncFilterPanelMode(mobileFilters);
  mobileFilters.addEventListener("change", syncFilterPanelMode);

  const t = (key) => payload.locales[state.lang][key] || payload.locales.en[key] || key;
  const updateLanguage = () => {
    document.documentElement.lang = state.lang;
    document.body.dataset.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-set-lang]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.setLang === state.lang)));
    search.placeholder = t("searchPlaceholder");
    for (const control of Object.values(controls)) control.querySelector("option[value='all']").textContent = t("all");
    for (const [value, names] of Object.entries(payload.optionLabels.products)) controls.product.querySelector(`option[value="${CSS.escape(value)}"]`).textContent = names[state.lang];
    for (const [value, names] of Object.entries(payload.optionLabels.categories)) controls.category.querySelector(`option[value="${CSS.escape(value)}"]`).textContent = names[state.lang];
    for (const [value, names] of Object.entries(payload.optionLabels.statuses)) controls.status.querySelector(`option[value="${CSS.escape(value)}"]`).textContent = names[state.lang];
    updateThemeControl();
  };
  const writeUrl = () => {
    const params = new URLSearchParams();
    for (const key of ["year", "product", "category", "release", "status"]) if (state[key] !== "all") params.set(key, state[key]);
    params.set("lang", state.lang);
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  };
  const cardMatches = (card) => {
    if (state.year !== "all" && card.dataset.year !== state.year) return false;
    if (state.product !== "all" && !card.dataset.products.split(" ").includes(state.product)) return false;
    if (state.category !== "all" && card.dataset.category !== state.category) return false;
    if (state.release !== "all" && card.dataset.release !== state.release) return false;
    if (state.status !== "all" && card.dataset.status !== state.status) return false;
    const tokens = normalize(state.search).split(" ").filter(Boolean);
    return tokens.every((token) => payload.searchDocuments[card.dataset.eventId].includes(token));
  };
  const updateGroups = () => {
    document.querySelectorAll(".month-group").forEach((group) => { group.hidden = !group.querySelector(".event-card:not([hidden])"); });
    document.querySelectorAll(".year-group").forEach((group) => { group.hidden = !group.querySelector(".event-card:not([hidden])"); });
  };
  const renderActiveFilters = () => {
    activeFilters.replaceChildren();
    for (const key of ["year", "product", "category", "release", "status"]) {
      if (state[key] === "all") continue;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.textContent = `${controls[key].selectedOptions[0].textContent} ×`;
      chip.addEventListener("click", () => { state[key] = "all"; controls[key].value = "all"; apply(); });
      activeFilters.append(chip);
    }
    if (state.search) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "filter-chip";
      chip.textContent = `“${state.search}” ×`;
      chip.addEventListener("click", () => { state.search = ""; search.value = ""; apply(); });
      activeFilters.append(chip);
    }
  };
  const inspectHashTarget = () => {
    hiddenTarget.hidden = true;
    if (!location.hash) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target?.matches("[data-event-id]") && target.hidden) {
      hiddenTarget.dataset.targetId = target.id;
      hiddenTarget.hidden = false;
    }
  };
  const apply = ({ updateUrl = true } = {}) => {
    let visible = 0;
    cards.forEach((card) => {
      const matches = cardMatches(card);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    updateGroups();
    noResults.hidden = visible !== 0;
    resultCount.firstChild.textContent = `${visible} `;
    renderActiveFilters();
    updateLanguage();
    if (updateUrl) writeUrl();
    inspectHashTarget();
  };
  const syncControls = () => {
    for (const [key, control] of Object.entries(controls)) control.value = state[key];
    search.value = state.search;
  };

  Object.entries(controls).forEach(([key, control]) => control.addEventListener("change", () => { state[key] = control.value; apply(); }));
  search.addEventListener("input", () => { state.search = search.value; apply(); });
  document.querySelector("#reset-filters").addEventListener("click", () => {
    state = { ...state, year: "all", product: "all", category: "all", release: "all", status: "all", search: "", sort: "newest" };
    syncControls(); apply(); search.focus();
  });
  themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  darkMode.addEventListener("change", (event) => {
    if (!storedTheme()) setTheme(event.matches ? "dark" : "light", { persist: false });
  });
  document.querySelectorAll("[data-set-lang]").forEach((button) => button.addEventListener("click", () => { state.lang = button.dataset.setLang; apply(); }));
  document.querySelectorAll("[data-year-jump]").forEach((button) => button.addEventListener("click", () => {
    state.year = button.dataset.yearJump; controls.year.value = state.year; apply();
    document.querySelector(`#year-${CSS.escape(state.year)}`)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));
  document.querySelectorAll("[data-product-history]").forEach((button) => button.addEventListener("click", () => {
    state.product = button.dataset.productHistory; controls.product.value = state.product; apply();
    document.querySelector("#history").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }));
  document.querySelector("#show-target").addEventListener("click", () => {
    const targetId = hiddenTarget.dataset.targetId;
    state = { ...state, year: "all", product: "all", category: "all", release: "all", status: "all", search: "" };
    syncControls(); apply(); document.getElementById(targetId)?.scrollIntoView({ block: "center" });
  });
  document.addEventListener("keydown", (event) => {
    const editable = event.target.matches("input, select, textarea, [contenteditable='true']");
    if (event.key === "/" && !editable) { event.preventDefault(); search.focus(); }
    if (event.key === "Escape" && event.target === search && search.value) { search.value = ""; state.search = ""; apply(); }
  });
  addEventListener("hashchange", inspectHashTarget);
  addEventListener("popstate", () => { state = fromUrl(); syncControls(); apply({ updateUrl: false }); });
  syncControls();
  apply({ updateUrl: false });
})();
