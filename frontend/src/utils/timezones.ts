// `Intl.supportedValuesOf('timeZone')` exposes the runtime's canonical IANA
// zone database (~400 entries), so the selector stays in sync with the tzdata
// the browser and backend operate on instead of a hand-maintained list.
let cachedTimezones: string[] | null = null;

const loadTimezones = (): string[] => {
  if (!cachedTimezones) {
    cachedTimezones =
      typeof Intl.supportedValuesOf === 'function'
        ? [...Intl.supportedValuesOf('timeZone')].sort()
        : [];
  }
  return cachedTimezones;
};

export const getTimezoneOptions = (current?: string): string[] => {
  const zones = loadTimezones();

  // Keep a stored zone selectable even when the runtime omits it (for example a
  // legacy alias), so editing a facility never silently drops its timezone.
  if (current && !zones.includes(current)) {
    return [...zones, current].sort();
  }

  return zones;
};
