import { DEFAULT_CONFIG, type Config, type PrivacyConfig } from "../types";

export interface ConfigValidationError {
  field: string;
  message: string;
}

/**
 * Validate and coerce a partial config patch. Returns errors for invalid fields.
 * Used by the options page (R7) and setConfig.
 */
export function validateConfigPatch(
  patch: Partial<Config> & { privacy?: Partial<PrivacyConfig> },
): { ok: true; value: Partial<Config> } | { ok: false; errors: ConfigValidationError[] } {
  const errors: ConfigValidationError[] = [];
  const out: Partial<Config> = {};

  if (patch.thresholdDays !== undefined) {
    const n = Number(patch.thresholdDays);
    if (!Number.isInteger(n) || n < 1) {
      errors.push({ field: "thresholdDays", message: "Must be an integer ≥ 1" });
    } else if (n > 3650) {
      errors.push({ field: "thresholdDays", message: "Must be ≤ 3650" });
    } else {
      out.thresholdDays = n;
    }
  }

  if (patch.reportHour !== undefined) {
    const n = Number(patch.reportHour);
    if (!Number.isInteger(n) || n < 0 || n > 23) {
      errors.push({ field: "reportHour", message: "Must be an integer 0–23" });
    } else {
      out.reportHour = n;
    }
  }

  if (patch.retentionSnapshots !== undefined) {
    const n = Number(patch.retentionSnapshots);
    if (!Number.isInteger(n) || n < 1) {
      errors.push({ field: "retentionSnapshots", message: "Must be an integer ≥ 1" });
    } else if (n > 3650) {
      errors.push({ field: "retentionSnapshots", message: "Must be ≤ 3650" });
    } else {
      out.retentionSnapshots = n;
    }
  }

  if (patch.badgeEnabled !== undefined) {
    out.badgeEnabled = Boolean(patch.badgeEnabled);
  }

  if (patch.recomputeIntervalMinutes !== undefined) {
    const n = Number(patch.recomputeIntervalMinutes);
    if (!Number.isFinite(n) || n < 0.5) {
      errors.push({
        field: "recomputeIntervalMinutes",
        message: "Must be ≥ 0.5 (Chrome alarms minimum)",
      });
    } else if (n > 1440) {
      errors.push({ field: "recomputeIntervalMinutes", message: "Must be ≤ 1440" });
    } else {
      out.recomputeIntervalMinutes = n;
    }
  }

  if (patch.debug !== undefined) {
    out.debug = Boolean(patch.debug);
  }

  if (patch.privacy !== undefined) {
    const p: Partial<PrivacyConfig> = {};
    if (patch.privacy.truncateUrls !== undefined) {
      p.truncateUrls = Boolean(patch.privacy.truncateUrls);
    }
    if (patch.privacy.storeQueryStrings !== undefined) {
      p.storeQueryStrings = Boolean(patch.privacy.storeQueryStrings);
    }
    if (Object.keys(p).length > 0) {
      out.privacy = p as PrivacyConfig;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: out };
}

/** Merge stored config with defaults (missing keys get defaults). */
export function mergeConfig(stored: unknown): Config {
  if (!stored || typeof stored !== "object") {
    return { ...DEFAULT_CONFIG, privacy: { ...DEFAULT_CONFIG.privacy } };
  }
  const s = stored as Partial<Config>;
  const privacy = {
    ...DEFAULT_CONFIG.privacy,
    ...(s.privacy && typeof s.privacy === "object" ? s.privacy : {}),
  };
  return {
    schemaVersion: typeof s.schemaVersion === "number" ? s.schemaVersion : DEFAULT_CONFIG.schemaVersion,
    thresholdDays:
      typeof s.thresholdDays === "number" && s.thresholdDays >= 1
        ? s.thresholdDays
        : DEFAULT_CONFIG.thresholdDays,
    reportHour:
      typeof s.reportHour === "number" && s.reportHour >= 0 && s.reportHour <= 23
        ? s.reportHour
        : DEFAULT_CONFIG.reportHour,
    retentionSnapshots:
      typeof s.retentionSnapshots === "number" && s.retentionSnapshots >= 1
        ? s.retentionSnapshots
        : DEFAULT_CONFIG.retentionSnapshots,
    badgeEnabled:
      typeof s.badgeEnabled === "boolean" ? s.badgeEnabled : DEFAULT_CONFIG.badgeEnabled,
    recomputeIntervalMinutes:
      typeof s.recomputeIntervalMinutes === "number" && s.recomputeIntervalMinutes >= 0.5
        ? s.recomputeIntervalMinutes
        : DEFAULT_CONFIG.recomputeIntervalMinutes,
    privacy: {
      truncateUrls: Boolean(privacy.truncateUrls),
      storeQueryStrings:
        privacy.storeQueryStrings === undefined
          ? DEFAULT_CONFIG.privacy.storeQueryStrings
          : Boolean(privacy.storeQueryStrings),
    },
    debug: typeof s.debug === "boolean" ? s.debug : DEFAULT_CONFIG.debug,
  };
}
