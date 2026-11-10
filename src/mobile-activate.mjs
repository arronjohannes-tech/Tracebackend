export const ACTIVATION_TOKEN_MIN_LENGTH = 32;
export const ACTIVATION_TOKEN_MAX_LENGTH = 256;

export function takeActivationToken(locationRef = window.location, historyRef = window.history) {
  const fragment = locationRef.hash;
  historyRef.replaceState(null, "", `${locationRef.pathname}${locationRef.search}`);
  const token = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment).get("token") ?? "";
  return token.length >= ACTIVATION_TOKEN_MIN_LENGTH && token.length <= ACTIVATION_TOKEN_MAX_LENGTH ? token : "";
}

export function activationAppUrl(token) {
  const url = new URL("tracehub://activate");
  url.searchParams.set("token", token);
  return url.toString();
}

const translations = {
  de: {
    title: "Tracehub auf dem Mobilgerät aktivieren",
    intro: "Öffnen Sie den sicheren Aktivierungslink in der Tracehub-App, um dort Ihr Passwort festzulegen.",
    open: "Tracehub-App öffnen",
    missing: "Dieser Aktivierungslink enthält kein gültiges Token. Fordern Sie einen neuen Link bei Ihrer Organisation an.",
    noApp: "Wenn die App nicht installiert ist, installieren Sie sie über den von Ihrer Organisation bereitgestellten Weg. Öffnen Sie danach diesen Link erneut.",
    privacy: "Dieser Link ist vertraulich. Geben Sie ihn nicht weiter.",
  },
  en: {
    title: "Activate Tracehub on your mobile device",
    intro: "Open the secure activation link in the Tracehub app to set your password there.",
    open: "Open Tracehub app",
    missing: "This activation link does not contain a valid token. Request a new link from your organization.",
    noApp: "If the app is not installed, install it using the distribution method provided by your organization, then open this link again.",
    privacy: "This link is private. Do not share it.",
  },
  am: {
    title: "Tracehubን በሞባይል መሣሪያዎ ያንቁ",
    intro: "የይለፍ ቃልዎን በዚያ ለማዘጋጀት ደህንነቱ የተጠበቀውን የማንቃት አገናኝ በTracehub መተግበሪያ ይክፈቱ።",
    open: "Tracehub መተግበሪያን ክፈት",
    missing: "ይህ የማንቃት አገናኝ ትክክለኛ ቶከን የለውም። ከድርጅትዎ አዲስ አገናኝ ይጠይቁ።",
    noApp: "መተግበሪያው ካልተጫነ፣ ድርጅትዎ ባቀረበው መንገድ ይጫኑት እና ይህን አገናኝ እንደገና ይክፈቱ።",
    privacy: "ይህ አገናኝ የግል ነው። ለሌሎች አያጋሩት።",
  },
};

export function renderActivationLanding({
  documentRef = document,
  locationRef = window.location,
  historyRef = window.history,
  language = navigator.language,
} = {}) {
  const locale = language.toLowerCase().startsWith("am")
    ? "am"
    : language.toLowerCase().startsWith("de") ? "de" : "en";
  const text = translations[locale];
  documentRef.documentElement.lang = locale;
  documentRef.title = text.title;
  const token = takeActivationToken(locationRef, historyRef);
  documentRef.querySelector("#activation-title").textContent = text.title;
  documentRef.querySelector("#activation-intro").textContent = text.intro;
  documentRef.querySelector("#activation-no-app").textContent = text.noApp;
  documentRef.querySelector("#activation-privacy").textContent = text.privacy;
  const openLink = documentRef.querySelector("#activation-open");
  const error = documentRef.querySelector("#activation-error");
  openLink.hidden = true;
  error.hidden = true;
  if (token) {
    openLink.href = activationAppUrl(token);
    openLink.textContent = text.open;
    openLink.hidden = false;
  } else {
    error.textContent = text.missing;
    error.hidden = false;
  }
}

if (typeof document !== "undefined") renderActivationLanding();
