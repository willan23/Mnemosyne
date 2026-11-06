'use strict';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const hasValidSessionUid = (data) => hasText(data?.uid) && data.uid.length <= 128 &&
  data.uid !== '.' && data.uid !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(data.uid);

function needsPersonalScopeBackfill(data) {
  if (!data || typeof data !== 'object' || !hasValidSessionUid(data)) return false;
  return !Object.prototype.hasOwnProperty.call(data, 'teamId');
}

/** Classify a session without returning IDs, content, tokens, or URLs. */
function classifySessionExposure(data) {
  const session = data && typeof data === 'object' ? data : {};
  const research = session.webResearch && typeof session.webResearch === 'object'
    ? session.webResearch : {};
  const attachments = Array.isArray(session.attachments) ? session.attachments : [];
  const urls = attachments
    .map((attachment) => attachment && typeof attachment === 'object' ? attachment.url : null)
    .filter((url) => typeof url === 'string');

  return {
    missingEnc: !session.enc || typeof session.enc !== 'object',
    plaintextText: hasText(session.text),
    plaintextTitle: hasText(session.title),
    plaintextGenerationPrompt: hasText(session.generatedPrompt) || hasText(session.generatedImagePrompt),
    plaintextResearchMetadata: hasText(research.query) ||
      (Array.isArray(research.keyConcepts) && research.keyConcepts.length > 0) ||
      (Array.isArray(research.sources) && research.sources.length > 0),
    attachmentsPresent: attachments.length > 0,
    inlineAttachment: urls.some((url) => url.startsWith('data:')),
    tokenizedAttachment: urls.some((url) => /[?&]token=/i.test(url)),
    teamSession: hasText(session.teamId),
    sharedSession: Array.isArray(session.sharedWithIds) && session.sharedWithIds.length > 0,
    missingPersonalScope: needsPersonalScopeBackfill(session),
    invalidTeamScope: Object.prototype.hasOwnProperty.call(session, 'teamId') &&
      session.teamId !== null && !hasText(session.teamId),
  };
}

module.exports = { classifySessionExposure, needsPersonalScopeBackfill, hasValidSessionUid };
