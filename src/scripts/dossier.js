(() => {
  const payload = JSON.parse(document.querySelector("#dossier-data").textContent);
  const themeToggle = document.querySelector("#theme-toggle");
  const themeLabel = document.querySelector("#theme-label");
  const darkMode = matchMedia("(prefers-color-scheme: dark)");
  const themeStorageKey = "jam-tracks-hub-log-theme";
  const params = new URLSearchParams(location.search);
  let language = params.get("lang") === "zh-TW" ? "zh-TW" : "en";

  const t = (key) => payload.locales[language][key] || payload.locales.en[key] || key;
  const storedTheme = () => {
    try {
      const value = localStorage.getItem(themeStorageKey);
      return value === "light" || value === "dark" ? value : null;
    } catch { return null; }
  };
  const updateThemeControl = () => {
    const nextThemeLabel = t(document.documentElement.dataset.theme === "dark" ? "lightMode" : "darkMode");
    themeToggle.hidden = false;
    themeToggle.setAttribute("aria-label", nextThemeLabel);
    themeToggle.title = nextThemeLabel;
    themeLabel.textContent = nextThemeLabel;
  };
  const setTheme = (theme, persist = true) => {
    document.documentElement.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem(themeStorageKey, theme); } catch { /* Persistence is optional. */ }
    }
    updateThemeControl();
  };
  const localizedHref = (href) => {
    const [withoutHash, hash = ""] = href.split("#");
    const separator = withoutHash.includes("?") ? "&" : "?";
    return `${withoutHash}${separator}lang=${encodeURIComponent(language)}${hash ? `#${hash}` : ""}`;
  };
  const updateLanguage = ({ writeUrl = true } = {}) => {
    document.documentElement.lang = language;
    document.body.dataset.lang = language;
    document.title = `${payload.productName[language]} — ${t("productDossier")} — Jam Tracks Hub`;
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel)); });
    document.querySelectorAll("[data-set-lang]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.setLang === language)));
    document.querySelectorAll("[data-lang-href]").forEach((link) => { link.href = localizedHref(link.dataset.langHref); });
    updateThemeControl();
    if (writeUrl) {
      const next = new URLSearchParams(location.search);
      next.set("lang", language);
      history.replaceState(null, "", `${location.pathname}?${next.toString()}${location.hash}`);
    }
  };

  themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  darkMode.addEventListener("change", (event) => { if (!storedTheme()) setTheme(event.matches ? "dark" : "light", false); });
  document.querySelectorAll("[data-set-lang]").forEach((button) => button.addEventListener("click", () => {
    language = button.dataset.setLang;
    updateLanguage();
  }));
  document.querySelector("#print-dossier").addEventListener("click", () => window.print());
  updateLanguage({ writeUrl: false });
})();
