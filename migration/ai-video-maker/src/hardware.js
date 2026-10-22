// @ts-check

const PROFILES = Object.freeze({
  'm1-lite': Object.freeze({
    id: 'm1-lite',
    label: 'Apple Silicon M1 Lite',
    execution: 'mock-only',
    maxConcurrentScenes: 1,
    modelDownloads: Object.freeze([]),
    notes: 'Provider adapters remain remote or deterministic; this profile downloads no models.',
  }),
  'portable-cpu': Object.freeze({
    id: 'portable-cpu',
    label: 'Portable CPU',
    execution: 'mock-only',
    maxConcurrentScenes: 1,
    modelDownloads: Object.freeze([]),
    notes: 'Safe fallback for development machines; this profile downloads no models.',
  }),
});

export function listHardwareProfiles() {
  return Object.values(PROFILES).map((profile) => ({ ...profile, modelDownloads: [...profile.modelDownloads] }));
}

/** @param {string} requestedId */
export function selectHardwareProfile(requestedId = 'm1-lite') {
  const profile = PROFILES[requestedId] ?? PROFILES['m1-lite'];
  return { ...profile, modelDownloads: [...profile.modelDownloads] };
}
