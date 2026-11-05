export function canRequestSatellite(role) {
  return ["org_admin", "reviewer", "field_agent"].includes(role);
}

export function satelliteOutcome(operation, plotId) {
  if (operation.phase === "mock_screened") return "mock";
  if (operation.status === "not_configured") return "notConfigured";
  if (operation.status === "failed") return "failed";
  if (["queued", "processing"].includes(operation.status)) return "running";
  if (operation.results?.some((result) => result.plotId === plotId)) return "completed";
  return "noResult";
}
