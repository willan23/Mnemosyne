/** Evaluation only. A span score is not factual confidence, authorization, or a final answer. */
export const ANSWERABILITY_LIMITS = Object.freeze({ tokens: 512, owners: 2, answerTokens: 32, maxAnswerTokens: 64 });
const fail = () => { throw Error('answerability_unavailable'); };
const list = value => Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const sigmoid = value => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

/** Context owners must be validated by the caller before tokenization and again before publishing. */
export function scoreAnswerability({ startLogits, endLogits, attentionMask, ownerIds, allowedOwnerIds, clsIndex = 0, maxAnswerTokens = ANSWERABILITY_LIMITS.answerTokens }) {
  if (!list(startLogits) || !list(endLogits) || !list(attentionMask) || !Array.isArray(ownerIds) || !Array.isArray(allowedOwnerIds) ||
      allowedOwnerIds.length < 1 || allowedOwnerIds.length > ANSWERABILITY_LIMITS.owners || !allowedOwnerIds.every(id) ||
      new Set(allowedOwnerIds).size !== allowedOwnerIds.length || !Number.isInteger(clsIndex) || !Number.isInteger(maxAnswerTokens) ||
      maxAnswerTokens < 1 || maxAnswerTokens > ANSWERABILITY_LIMITS.maxAnswerTokens) fail();
  const length = startLogits.length, owners = new Set(allowedOwnerIds);
  if (length < 1 || length > ANSWERABILITY_LIMITS.tokens || endLogits.length !== length || attentionMask.length !== length ||
      ownerIds.length !== length || clsIndex < 0 || clsIndex >= length) fail();
  for (let at = 0; at < length; at++) {
    if (!Number.isFinite(startLogits[at]) || !Number.isFinite(endLogits[at]) || ![0, 1].includes(attentionMask[at]) ||
        ownerIds[at] !== null && (!owners.has(ownerIds[at]) || attentionMask[at] !== 1)) fail();
  }
  if (attentionMask[clsIndex] !== 1 || ownerIds[clsIndex] !== null) fail();
  const nullLogitScore = startLogits[clsIndex] + endLogits[clsIndex]; if (!Number.isFinite(nullLogitScore)) fail();
  let span = null;
  for (let start = 0; start < length; start++) {
    const ownerId = ownerIds[start]; if (ownerId === null) continue;
    for (let end = start; end < Math.min(length, start + maxAnswerTokens); end++) {
      if (ownerIds[end] !== ownerId || attentionMask[end] !== 1) break;
      const logitScore = startLogits[start] + endLogits[end]; if (!Number.isFinite(logitScore)) fail();
      if (!span || logitScore > span.logitScore) span = { start, end, ownerId, logitScore };
    }
  }
  const margin = span ? span.logitScore - nullLogitScore : null; if (margin !== null && !Number.isFinite(margin)) fail();
  return Object.freeze({
    span: span ? Object.freeze(span) : null, nullLogitScore, margin,
    answerabilityScore: margin === null ? 0 : sigmoid(margin), nullPreferred: margin === null || margin <= 0,
  });
}
