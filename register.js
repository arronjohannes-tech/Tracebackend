const form = document.querySelector("#registration-form");
const status = document.querySelector("#registration-status");
const organization = document.querySelector("#registration-organization");
const token = new URLSearchParams(location.hash.slice(1)).get("token");

async function apiRequest(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message ?? "Die Anfrage konnte nicht verarbeitet werden.");
  }
  return body.data;
}

if (!token) {
  status.textContent = "Der Einladungslink fehlt. Bitte verwenden Sie den Link aus der E-Mail.";
} else {
  apiRequest("/api/v1/supplier-invitations/resolve", { token })
    .then((invitation) => {
      form.elements.legalName.value = invitation.legalName;
      form.elements.email.value = invitation.email;
      organization.textContent = `Einladung von ${invitation.organizationName}`;
      status.textContent = "";
      form.hidden = false;
    })
    .catch((error) => {
      status.textContent = error.message;
      organization.textContent = "Einladung nicht verfügbar";
    });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  if (values.password !== values.passwordConfirm) {
    status.textContent = "Die Passwörter stimmen nicht überein.";
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  status.textContent = "Registrierung läuft…";
  try {
    const { passwordConfirm, email, ...supplier } = values;
    const session = await apiRequest("/api/v1/supplier-invitations/register", { ...supplier, token });
    sessionStorage.setItem("accessToken", session.accessToken);
    sessionStorage.setItem("refreshToken", session.refreshToken);
    if (session.selectedOrganizationId) {
      sessionStorage.setItem("selectedOrganizationId", session.selectedOrganizationId);
    }
    window.location.replace("/#suppliers");
  } catch (error) {
    status.textContent = error.message;
    submit.disabled = false;
  }
});