// @ts-check

const APPLE_PLATFORMS = new Set(['apple', 'apple-silicon', 'darwin', 'mac', 'macos', 'osx']);
const APPLE_SILICON_PROFILE_PATTERN = /^(?:m[1-9]|apple[-_ ]?silicon)/i;

/**
 * @typedef {object} RenderPlan
 * @property {'h264_videotoolbox'|'h264_nvenc'|'libx264'} codec
 * @property {boolean} hardwareAcceleration
 * @property {string} reason
 * @property {boolean} requiresModelDownload
 */

/**
 * Select the safest available FFmpeg encoder for a hardware profile.
 *
 * The planner is intentionally pure: it only inspects its arguments and returns
 * a JSON-serializable plan. It does not probe the host, download models, or run
 * FFmpeg.
 *
 * @param {{platform: string, hardwareProfile: string|{id?: string, modelDownloads?: unknown[]}, availableEncoders?: string[]}} options
 * @returns {RenderPlan}
 */
export function planRender({ platform, hardwareProfile, availableEncoders = [] }) {
  const normalizedPlatform = String(platform ?? '').trim().toLowerCase();
  const profileId = typeof hardwareProfile === 'string'
    ? hardwareProfile
    : hardwareProfile?.id ?? '';
  const normalizedProfileId = String(profileId).trim().toLowerCase();
  const encoders = new Set(availableEncoders.map((encoder) => String(encoder).trim().toLowerCase()));
  const isAppleSilicon = APPLE_PLATFORMS.has(normalizedPlatform)
    && APPLE_SILICON_PROFILE_PATTERN.test(normalizedProfileId);
  const requiresModelDownload = normalizedProfileId === 'm1-lite'
    ? false
    : typeof hardwareProfile === 'object'
      && Array.isArray(hardwareProfile.modelDownloads)
      && hardwareProfile.modelDownloads.length > 0;

  if (isAppleSilicon && encoders.has('h264_videotoolbox')) {
    return {
      codec: 'h264_videotoolbox',
      hardwareAcceleration: true,
      reason: 'Apple Silicon VideoToolbox is available and is the preferred hardware encoder.',
      requiresModelDownload,
    };
  }

  if (!isAppleSilicon && encoders.has('h264_nvenc')) {
    return {
      codec: 'h264_nvenc',
      hardwareAcceleration: true,
      reason: 'NVIDIA NVENC is available on a non-Apple platform.',
      requiresModelDownload,
    };
  }

  return {
    codec: 'libx264',
    hardwareAcceleration: false,
    reason: isAppleSilicon
      ? 'VideoToolbox is unavailable, so rendering falls back to the portable libx264 software encoder.'
      : 'No eligible hardware encoder is available, so rendering uses the portable libx264 software encoder.',
    requiresModelDownload,
  };
}

export const planRenderCapabilities = planRender;
