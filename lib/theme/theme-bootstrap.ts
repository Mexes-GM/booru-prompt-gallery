/**
 * Anti-flash theme bootstrap. The shared ThemeProvider only mounts next-themes
 * AFTER hydration (it returns bare children until `mounted`), so the initial
 * HTML carries no theme class and would paint LIGHT for a frame on dark setups.
 * This blocking inline script runs during body parse — before the React app
 * paints — and applies the resolved theme (reading next-themes' "theme" key,
 * defaulting to "system") so the page opens already in the correct theme.
 */
export const themeBootstrapScript = `(function () {
  try {
    var root = document.documentElement;
    var stored = localStorage.getItem("theme") || "system";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = stored === "dark" || (stored !== "light" && prefersDark);
    if (isDark) root.classList.add("dark");
    else root.classList.remove("dark");
    root.style.colorScheme = isDark ? "dark" : "light";
  } catch (e) {}
})();`
