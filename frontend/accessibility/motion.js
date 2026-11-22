// Shared motion preference: the "Reduce motion" option or the device setting.
// Scripts must pass this to scrollIntoView/scrollBy/scrollTo, because an explicit
// behavior: "smooth" in JavaScript ignores the CSS scroll-behavior override.

export function prefersReducedMotion() {
  if (document.documentElement.classList.contains("a11y-motion")) return true;
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollBehavior() {
  return prefersReducedMotion() ? "instant" : "smooth";
}
