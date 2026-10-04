export type CheckState = "ok" | "fail" | "pending";

export type PlotValidationInput = {
    geofenceStatus: string;
    areaHa: number;
    computedAreaHa: number;
    valid: boolean;
    simple: boolean;
    duplicateCount: number;
    eoStatus: string | null;
    eoPhase: string | null;
};

export type PlotValidation = {
    geofence: { state: CheckState; status: string };
    area: { state: CheckState; storedHa: number; computedHa: number };
    selfIntersection: { state: CheckState };
    duplicate: { state: CheckState; count: number };
    eo: { state: CheckState; status: string | null };
};

export const MIN_PLAUSIBLE_AREA_HA = 0.01;
export const MAX_PLAUSIBLE_AREA_HA = 500;
// The recorded area may deviate from the polygon area by 15 % (but at least 0.05 ha) before it is flagged.
const AREA_TOLERANCE_RATIO = 0.15;
const AREA_TOLERANCE_MIN_HA = 0.05;

export function isAreaPlausible(storedHa: number, computedHa: number): boolean {
    if (!Number.isFinite(storedHa) || !Number.isFinite(computedHa)) return false;
    if (computedHa < MIN_PLAUSIBLE_AREA_HA || computedHa > MAX_PLAUSIBLE_AREA_HA) return false;
    return Math.abs(storedHa - computedHa) <= Math.max(AREA_TOLERANCE_MIN_HA, computedHa * AREA_TOLERANCE_RATIO);
}

function geofenceState(status: string): CheckState {
    if (status === "inside" || status === "approved") return "ok";
    if (status === "outside" || status === "review_required") return "fail";
    return "pending";
}

function eoState(status: string | null, phase: string | null): CheckState {
    // The mock screening completes without calling a provider, so it is no real earth-observation result.
    if (status === "completed" && phase !== "mock_screened") return "ok";
    if (status === "failed") return "fail";
    return "pending";
}

export function validatePlot(input: PlotValidationInput): PlotValidation {
    return {
        geofence: { state: geofenceState(input.geofenceStatus), status: input.geofenceStatus },
        area: {
            state: isAreaPlausible(input.areaHa, input.computedAreaHa) ? "ok" : "fail",
            storedHa: input.areaHa,
            computedHa: input.computedAreaHa,
        },
        selfIntersection: { state: input.valid && input.simple ? "ok" : "fail" },
        duplicate: { state: input.duplicateCount > 0 ? "fail" : "ok", count: input.duplicateCount },
        eo: { state: eoState(input.eoStatus, input.eoPhase), status: input.eoStatus },
    };
}
