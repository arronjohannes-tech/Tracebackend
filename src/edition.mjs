export const EDITIONS = ["demo", "prod"];
const STORAGE_KEY = "tracehub.edition";

export function editionPage(edition) {
  return edition === "demo" ? "index-demo.html" : "index-prod.html";
}

export function initEditionSwitch(current, storage = localStorage) {
  storage.setItem(STORAGE_KEY, current);
  const links = [...document.querySelectorAll("[data-edition-link]")];
  links.forEach((link) => {
    const isCurrent = link.dataset.editionLink === current;
    link.classList.toggle("active", isCurrent);
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    link.addEventListener("click", () => {
      storage.setItem(STORAGE_KEY, link.dataset.editionLink);
      // The view is kept in the hash so the other edition opens in the same area.
      link.setAttribute("href", `${editionPage(link.dataset.editionLink)}${location.hash}`);
    });
  });
}
