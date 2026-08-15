/**
 * Parse a base64 data URL, INCLUDING the ones browsers actually produce.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Two call sites each hand-rolled `/^data:([^;]+);base64,(.+)$/`, and that
 * pattern is wrong for a media type that carries parameters — which is the
 * normal case for recorded audio:
 *
 *     data:application/pdf;base64,...              → matched
 *     data:audio/webm;codecs=opus;base64,...       → DID NOT MATCH
 *
 * `[^;]+` cannot cross the `;` in front of `codecs=opus`, and there is no way
 * for the engine to backtrack into a match, so every clip MediaRecorder makes
 * was rejected before a byte of it was looked at. The voice button on the
 * vacancy interview failed 100% of the time with "Expected a base64 audio data
 * URL" — a message that reads like the browser sent something malformed, when
 * in fact it sent exactly what the spec says it should (RFC 2397 §3: the
 * mediatype may carry any number of `;attribute=value` parameters).
 *
 * The upload path had the same bug latent: it only stayed hidden because a
 * `File` picked from disk usually reports a bare type like `application/pdf`.
 *
 * ── WHAT IT RETURNS ────────────────────────────────────────────────────────
 *
 * `mimeType` is the BARE type, lower-cased, with parameters stripped — that is
 * what an allow-list should be compared against, since `audio/webm` and
 * `audio/webm;codecs=opus` are the same format and no allow-list should have to
 * enumerate codec spellings. `params` keeps the rest for anything that cares.
 */
"use strict";

/** `data:` + optional mediatype and parameters + `;base64,` + payload. */
const DATA_URL = /^data:([^,]*);base64,([\s\S]*)$/;

/**
 * @param {string} dataUrl
 * @returns {{ mimeType: string, params: string[], buffer: Buffer } | null}
 *   null when the string is not a base64 data URL at all.
 */
function parseDataUrl(dataUrl) {
  const m = DATA_URL.exec(String(dataUrl || ""));
  if (!m) return null;
  const [type, ...params] = m[1].split(";");
  return {
    // An omitted mediatype means text/plain per RFC 2397; callers with an
    // allow-list will refuse it, which is the right outcome.
    mimeType: (type || "text/plain").trim().toLowerCase(),
    params: params.map((p) => p.trim()).filter(Boolean),
    buffer: Buffer.from(m[2], "base64"),
  };
}

module.exports = { parseDataUrl };
