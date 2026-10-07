import { configRead } from './config';

const originalParse = JSON.parse;

/**
 * Returns a lowercase MIME type from a player format.
 *
 * @param {unknown} format
 * @returns {string}
 */
function getMimeType(format) {
  if (
    !format ||
    typeof format !== 'object' ||
    typeof format.mimeType !== 'string'
  ) {
    return '';
  }

  return format.mimeType.toLowerCase();
}

/**
 * Determines the codec family used by a video or audio format.
 *
 * @param {unknown} format
 * @returns {'av1' | 'vp9' | 'avc' | 'audio' | 'other'}
 */
function getCodecFamily(format) {
  const mimeType = getMimeType(format);

  if (mimeType.indexOf('audio/') === 0) {
    return 'audio';
  }

  if (
    mimeType.indexOf('av01') !== -1 ||
    mimeType.indexOf('av1') !== -1
  ) {
    return 'av1';
  }

  if (
    mimeType.indexOf('vp09') !== -1 ||
    mimeType.indexOf('vp9') !== -1
  ) {
    return 'vp9';
  }

  if (
    mimeType.indexOf('avc1') !== -1 ||
    mimeType.indexOf('avc3') !== -1 ||
    mimeType.indexOf('h264') !== -1
  ) {
    return 'avc';
  }

  return 'other';
}

/**
 * Produces a safe summary for diagnostic logging.
 *
 * Stream URLs, signatures, ciphers, cookies and authentication
 * information are intentionally not included.
 *
 * @param {Record<string, unknown>} format
 * @returns {Record<string, unknown>}
 */
function createSafeFormatSummary(format) {
  return {
    itag: format.itag,
    codec: getCodecFamily(format),
    mimeType: getMimeType(format),
    width: format.width,
    height: format.height,
    fps: format.fps,
    bitrate: format.bitrate,
    audioQuality: format.audioQuality
  };
}

/**
 * Logs codec information only when codec diagnostics are enabled.
 *
 * @param {string} message
 * @param {unknown} [value]
 */
function codecLog(message, value) {
  if (!configRead('enableCodecDebug')) {
    return;
  }

  if (value === undefined) {
    console.info('[codec-policy] ' + message);
    return;
  }

  console.info('[codec-policy] ' + message, value);
}

/**
 * Logs a safe summary of a format array.
 *
 * @param {string} name
 * @param {unknown} formats
 */
function logFormats(name, formats) {
  if (!configRead('enableCodecDebug') || !Array.isArray(formats)) {
    return;
  }

  codecLog(
    name,
    formats.map((format) => createSafeFormatSummary(format))
  );
}

/**
 * Applies this policy:
 *
 * 1. Preserve all audio-only formats.
 * 2. Remove all AV1 video formats.
 * 3. Prefer VP9 video when available.
 * 4. Use AVC/H.264 when VP9 is unavailable.
 * 5. Preserve unknown non-AV1 formats only when neither VP9 nor AVC exists.
 *
 * @param {unknown} formats
 * @returns {unknown}
 */
function filterFormats(formats) {
  if (!Array.isArray(formats)) {
    return formats;
  }

  const audioFormats = [];
  const vp9Formats = [];
  const avcFormats = [];
  const otherEntries = [];
  const otherVideoFormats = [];

  let removedAv1Formats = 0;

  for (const format of formats) {
    const mimeType = getMimeType(format);
    const codec = getCodecFamily(format);

    if (codec === 'audio') {
      audioFormats.push(format);
      continue;
    }

    if (codec === 'av1') {
      removedAv1Formats += 1;
      continue;
    }

    if (codec === 'vp9') {
      vp9Formats.push(format);
      continue;
    }

    if (codec === 'avc') {
      avcFormats.push(format);
      continue;
    }

    if (mimeType.indexOf('video/') === 0) {
      otherVideoFormats.push(format);
      continue;
    }

    otherEntries.push(format);
  }

  codecLog('Removed AV1 formats: ' + removedAv1Formats);

  if (vp9Formats.length > 0) {
    codecLog('Selected VP9 video formats');

    return audioFormats.concat(vp9Formats, otherEntries);
  }

  if (avcFormats.length > 0) {
    codecLog('VP9 unavailable; selected AVC/H.264 video formats');

    return audioFormats.concat(avcFormats, otherEntries);
  }

  codecLog('VP9 and AVC unavailable; preserving other non-AV1 formats');

  return audioFormats.concat(otherVideoFormats, otherEntries);
}

/**
 * Applies the codec policy to a streamingData object.
 *
 * @param {unknown} streamingData
 * @returns {boolean}
 */
function applyToStreamingData(streamingData) {
  if (!streamingData || typeof streamingData !== 'object') {
    return false;
  }

  const hasFormats = Array.isArray(streamingData.formats);
  const hasAdaptiveFormats = Array.isArray(
    streamingData.adaptiveFormats
  );

  if (!hasFormats && !hasAdaptiveFormats) {
    return false;
  }

  logFormats('formats before filtering', streamingData.formats);
  logFormats(
    'adaptiveFormats before filtering',
    streamingData.adaptiveFormats
  );

  if (hasFormats) {
    streamingData.formats = filterFormats(streamingData.formats);
  }

  if (hasAdaptiveFormats) {
    streamingData.adaptiveFormats = filterFormats(
      streamingData.adaptiveFormats
    );
  }

  logFormats('formats after filtering', streamingData.formats);
  logFormats(
    'adaptiveFormats after filtering',
    streamingData.adaptiveFormats
  );

  return true;
}

/**
 * Looks for a YouTube player response and applies the codec policy.
 *
 * @param {unknown} parsedValue
 * @returns {unknown}
 */
function applyCodecPolicy(parsedValue) {
  if (!configRead('enableCodecPolicy')) {
    return parsedValue;
  }

  if (!parsedValue || typeof parsedValue !== 'object') {
    return parsedValue;
  }

  let policyApplied = false;

  if (applyToStreamingData(parsedValue.streamingData)) {
    policyApplied = true;
  }

  if (
    parsedValue.playerResponse &&
    typeof parsedValue.playerResponse === 'object' &&
    applyToStreamingData(parsedValue.playerResponse.streamingData)
  ) {
    policyApplied = true;
  }

  if (policyApplied) {
    codecLog('Codec policy applied to YouTube player response');
  }

  return parsedValue;
}

/**
 * Wrap JSON.parse using the same approach already used by adblock.js,
 * shorts.js and remove-endscreen.ts.
 */
JSON.parse = function () {
  const parsedValue = originalParse.apply(this, arguments);

  try {
    return applyCodecPolicy(parsedValue);
  } catch (error) {
    console.error(
      '[codec-policy] Failed to process player response:',
      error
    );

    /*
     * Never block playback just because our custom compatibility
     * filter encountered an unexpected response.
     */
    return parsedValue;
  }
};
