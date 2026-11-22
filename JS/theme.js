// Run in <head> before styles: follow the device without a switch or saved override.
(() => {
  const preference = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
  const applyTheme = () => {
    document.documentElement.dataset.theme = preference?.matches ? "dark" : "light";
  };
  applyTheme();
  if (preference?.addEventListener) preference.addEventListener("change", applyTheme);
  else if (preference?.addListener) preference.addListener(applyTheme);
})();
