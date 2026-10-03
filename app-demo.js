import { calculateCompletion, validateMassBalance } from "./src/domain.mjs?v=1";
import { initEditionSwitch } from "./src/edition.mjs?v=1";
import {
  SUPPORTED_LANGUAGES,
  applyTranslations,
  translate,
} from "./src/i18n.mjs?v=1";

const completion = calculateCompletion({
  supplier: true,
  plots: true,
  lineage: true,
  evidence: true,
  legalReview: false,
  geoReview: true,
  declaration: true,
  approval: false,
  product: true,
});

const balance = validateMassBalance(
  [{ quantityKg: 19240 }],
  [{ quantityKg: 18500 }, { quantityKg: 740 }],
);

const views = [...document.querySelectorAll(".view")];
const navLinks = [...document.querySelectorAll(".nav-link")];
const pageTitle = document.querySelector("#page-title");
const toast = document.querySelector("#toast");
const languageButtons = [...document.querySelectorAll("[data-language]")];
const accountToggle = document.querySelector("#account-toggle");
const accountDropdown = document.querySelector("#account-dropdown");
const profileDialog = document.querySelector("#profile-dialog");
const layoutToggle = document.querySelector("#layout-toggle");
const layoutLabel = document.querySelector("#layout-label");
let toastTimer;
let activeLanguage = getInitialLanguage();

function getInitialLanguage() {
  const stored = localStorage.getItem("sctracker.language");
  if (SUPPORTED_LANGUAGES.includes(stored)) {
    return stored;
  }

  const browserLanguage = navigator.language.toLowerCase();
  if (browserLanguage.startsWith("am")) {
    return "am";
  }
  if (browserLanguage.startsWith("en")) {
    return "en";
  }
  return "de";
}

function renderDynamicContent() {
  const t = (key) => translate(activeLanguage, key);
  const lineage = [
    {
      type: t("lineage.sourceLots"),
      title: "SL-041 · SL-044 · SL-052",
      detail: t("lineage.rawCoffee"),
    },
    {
      type: t("lineage.processing"),
      title: "Dry Mill DM-2026-88",
      detail: t("lineage.loss"),
    },
    {
      type: t("lineage.exportBatch"),
      title: "B-2026-091",
      detail: t("lineage.released"),
    },
    {
      type: t("lineage.shipment"),
      title: "IMP-2026-0142",
      detail: t("lineage.allocated"),
    },
  ];

  const riskSignals = [
    {
      label: t("signal.completeness"),
      score: "82%",
      detail: t("signal.missingEvidence"),
      warning: true,
    },
    {
      label: t("signal.geoQuality"),
      score: "94%",
      detail: t("signal.openPolygon"),
      warning: false,
    },
    {
      label: t("signal.deforestation"),
      score: t("signal.low"),
      detail: t("signal.eoAnalysis"),
      warning: false,
    },
    {
      label: t("signal.legality"),
      score: t("signal.review"),
      detail: t("signal.documentExpires"),
      warning: true,
    },
    {
      label: t("signal.traceability"),
      score: "99%",
      detail: t("signal.quantityCase"),
      warning: true,
    },
  ];

  document.querySelector("#completion-score").textContent = `${completion}%`;
  document.querySelector("#lineage").innerHTML = lineage
    .map(
      (node) => `
        <div class="lineage-node">
          <small>${node.type}</small>
          <strong>${node.title}</strong>
          <em>${node.detail}</em>
        </div>
      `,
    )
    .join("");

  document.querySelector("#risk-grid").innerHTML = riskSignals
    .map(
      (signal) => `
        <article class="risk-card ${signal.warning ? "warning" : ""}">
          <small>${signal.label}</small>
          <strong>${signal.score}</strong>
          <small>${signal.detail}</small>
        </article>
      `,
    )
    .join("");
}

function showView(viewId) {
  const selected = views.find((view) => view.id === viewId) ?? views[0];

  views.forEach((view) => view.classList.toggle("active", view === selected));
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.view === selected.id);
  });
  pageTitle.textContent = translate(activeLanguage, selected.dataset.titleKey);
}

function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return;
  }

  activeLanguage = language;
  localStorage.setItem("sctracker.language", language);
  document.documentElement.lang = language;
  applyTranslations(document, language);
  renderDynamicContent();
  showView(location.hash.slice(1) || "overview");

  languageButtons.forEach((button) => {
    const isActive = button.dataset.language === language;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setLayout(layout) {
  const nextLayout = layout === "classic" ? "classic" : "command";
  document.documentElement.dataset.layout = nextLayout;
  localStorage.setItem("sctracker.layout", nextLayout);
  layoutToggle?.setAttribute("aria-pressed", String(nextLayout === "command"));
  if (layoutLabel) layoutLabel.textContent = nextLayout === "command" ? "COMMAND" : "CLASSIC";
}

function closeAccountMenu() {
  if (!accountDropdown || !accountToggle) return;
  accountDropdown.hidden = true;
  accountToggle.setAttribute("aria-expanded", "false");
}

function logoutFromBackend() {
  toast.textContent = "Demo: keine echte Sitzung vorhanden";
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}
accountToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = !accountDropdown.hidden;
  accountDropdown.hidden = isOpen;
  accountToggle.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-menu")) closeAccountMenu();
});

document.querySelectorAll("[data-account-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    closeAccountMenu();
    if (button.dataset.accountAction === "profile") {
      profileDialog?.showModal();
      return;
    }
    await logoutFromBackend();
  });
});

document.querySelectorAll("[data-profile-close]").forEach((button) => {
  button.addEventListener("click", () => profileDialog?.close());
});

profileDialog?.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});

layoutToggle?.addEventListener("click", () => {
  setLayout(document.documentElement.dataset.layout === "command" ? "classic" : "command");
});

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const viewId = link.dataset.view;
    history.replaceState(null, "", `#${viewId}`);
    showView(viewId);
  });
});

languageButtons.forEach((button) => {
  button.addEventListener("click", () => setLanguage(button.dataset.language));
});

document.querySelectorAll("[data-toast-key]").forEach((button) => {
  button.addEventListener("click", () => {
    toast.textContent = translate(activeLanguage, button.dataset.toastKey);
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  });
});

if (!balance.balanced) {
  console.warn("Demo shipment mass balance is not balanced", balance);
}

setLayout(localStorage.getItem("sctracker.layout") ?? "command");
setLanguage(activeLanguage);

initEditionSwitch("demo");
