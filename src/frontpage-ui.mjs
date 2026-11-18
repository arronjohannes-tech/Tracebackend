export function enhanceFrontpage(root, translate) {
  const views = root.querySelector("main");
  if (!views) return;
  if (views.dataset.frontpageUiInitialized === "true") return;
  views.dataset.frontpageUiInitialized = "true";

  function addCopyDisclosures() {
    for (const paragraph of views.querySelectorAll(".view p:not(.eyebrow):not([role='status']):not(.form-status)")) {
      if (paragraph.querySelector(".copy-disclosure, a, button, input, select")) continue;
      if (!paragraph.textContent.trim()) continue;

      const content = root.createElement("span");
      content.className = "copy-disclosure-content";
      content.hidden = true;
      while (paragraph.firstChild) content.append(paragraph.firstChild);

      const toggle = root.createElement("button");
      toggle.type = "button";
      toggle.className = "copy-disclosure";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", translate("prod.copy.show"));
      toggle.title = translate("prod.copy.show");
      toggle.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="7.5"></circle><path d="M10 9v5m0-8h.01"></path>
      </svg>`;

      paragraph.classList.add("copy-disclosure-paragraph");
      paragraph.prepend(toggle, content);
    }
  }

  function labelTableCells() {
    for (const table of views.querySelectorAll(".view table")) {
      const headerRow = table.tHead?.rows[table.tHead.rows.length - 1];
      if (!headerRow) continue;
      const labels = Array.from(headerRow.cells, (cell) => cell.textContent.trim());
      for (const row of table.tBodies) {
        for (const item of row.rows) {
          Array.from(item.cells).forEach((cell, index) => {
            if (cell.tagName === "TD" && !cell.hasAttribute("colspan") && labels[index]) {
              cell.dataset.label = labels[index];
            }
          });
        }
      }
    }
  }

  function enhance() {
    addCopyDisclosures();
    labelTableCells();
  }

  views.addEventListener("click", (event) => {
    const toggle = event.target.closest(".copy-disclosure");
    if (!toggle) return;
    const content = toggle.nextElementSibling;
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    content.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", translate(expanded ? "prod.copy.hide" : "prod.copy.show"));
    toggle.title = translate(expanded ? "prod.copy.hide" : "prod.copy.show");
  });

  const observer = new MutationObserver(enhance);
  observer.observe(views, { childList: true, subtree: true });
  enhance();
}
