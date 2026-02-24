const SCROLL_ROOT_SELECTOR = "main, [data-scroll-root], .scrollbar-elegant";

function resetElementScroll(element: HTMLElement | null | undefined) {
  if (!element) return;
  try {
    element.scrollTo({ top: 0, left: 0, behavior: "auto" });
  } catch {
    // Some elements do not support scrollTo in older environments.
  }
  element.scrollTop = 0;
  element.scrollLeft = 0;
}

export function resetRouteScrollPositions() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });

  resetElementScroll(document.scrollingElement as HTMLElement | null);
  resetElementScroll(document.documentElement);
  resetElementScroll(document.body);

  const roots = document.querySelectorAll<HTMLElement>(SCROLL_ROOT_SELECTOR);
  roots.forEach((node) => resetElementScroll(node));
}
