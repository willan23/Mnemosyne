import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';

export type CommsP2PLegacySource = 'rooms' | 'callerCandidates' | 'calleeCandidates';
export interface CommsP2PServerVersion {seconds: number; nanoseconds: number}
export interface CommsP2PLegacyObservation {
  path: string;
  version: CommsP2PServerVersion;
  metadataDigest: string;
}
export interface CommsP2PLegacyPlan {
  v: 1;
  projectId: string;
  planId: string;
  cutoverId: string;
  kind: 'room' | 'orphan';
  subject: CommsP2PLegacyObservation;
  children: CommsP2PLegacyObservation[];
}
export interface CommsP2PClosedRulesObservation {
  projectId: string;
  rulesSha256: string;
  rulesetName: string;
  releaseUpdateTime: string;
}
export const COMMS_P2P_LEGACY_GRACE_MS = 10 * 60 * 1000;
export const COMMS_P2P_LEGACY_PAGE_SIZE = 50;
export const COMMS_P2P_LEGACY_CHILD_BATCH = 32;
export const COMMS_P2P_LEGACY_ROOT_FIELDS = Object.freeze([
  'v','callerId','calleeId','status','createdAt','updatedAt','expiresAt',
  'legacyCleanupId','legacySignalsPurgedAt',
]);
export const COMMS_P2P_LEGACY_CHILD_FIELDS = Object.freeze(['v','uid','createdAt','digest']);
const invalid = () => new Error('Invalid P2P legacy context');
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw invalid();
  return value as Record<string, unknown>;
}
export function commsP2PLegacyProject(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{5,29}$/.test(value)) throw invalid();
  return value;
}
export function commsP2PLegacyPath(value: unknown): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 6144 ||
      Buffer.from(value, 'utf8').toString('utf8') !== value || /[\x00-\x1f\x7f\\]/.test(value)) throw invalid();
  const parts = value.split('/');
  if (parts.length % 2 || parts.some(part => !part || part === '.' || part === '..' || Buffer.byteLength(part, 'utf8') > 1500)) throw invalid();
  return value;
}
export function commsP2PLegacyRoomPath(value: unknown): string {
  const path = commsP2PLegacyPath(value), parts = path.split('/');
  if (parts.length !== 2 || parts[0] !== 'p2pRooms') throw invalid();
  return path;
}
export function commsP2PLegacyCandidatePath(value: unknown): string {
  const path = commsP2PLegacyPath(value), parts = path.split('/');
  if (parts.length !== 4 || parts[0] !== 'p2pRooms' || !['callerCandidates','calleeCandidates'].includes(parts[2])) throw invalid();
  return path;
}
export function parseCommsP2PServerVersion(value: unknown): CommsP2PServerVersion {
  const row = object(value, ['seconds','nanoseconds']);
  if (!Number.isSafeInteger(row.seconds) || Number(row.seconds) < 0 || Number(row.seconds) > 253402300799 ||
      !Number.isSafeInteger(row.nanoseconds) || Number(row.nanoseconds) < 0 || Number(row.nanoseconds) >= 1e9) throw invalid();
  return {seconds: Number(row.seconds), nanoseconds: Number(row.nanoseconds)};
}
export function commsP2PVersionMillis(value: CommsP2PServerVersion) {
  const version = parseCommsP2PServerVersion(value);
  return version.seconds * 1000 + Math.floor(version.nanoseconds / 1e6);
}
export function compareCommsP2PVersions(a: CommsP2PServerVersion, b: CommsP2PServerVersion) {
  return a.seconds === b.seconds ? a.nanoseconds - b.nanoseconds : a.seconds - b.seconds;
}
export function parseCommsP2PLegacyObservation(value: unknown): CommsP2PLegacyObservation {
  const row = object(value, ['path','version','metadataDigest']);
  if (typeof row.metadataDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.metadataDigest)) throw invalid();
  return {path: commsP2PLegacyPath(row.path), version: parseCommsP2PServerVersion(row.version), metadataDigest: row.metadataDigest};
}
export function parseCommsP2PLegacyPlan(value: unknown): CommsP2PLegacyPlan {
  const row = object(value, ['v','projectId','planId','cutoverId','kind','subject','children']);
  if (row.v !== 1 || !attachmentIdValid(row.planId) || !attachmentIdValid(row.cutoverId) ||
      !['room','orphan'].includes(String(row.kind)) || !Array.isArray(row.children) ||
      row.children.length > 2 * COMMS_P2P_LEGACY_CHILD_BATCH) throw invalid();
  const subject = parseCommsP2PLegacyObservation(row.subject), children = row.children.map(parseCommsP2PLegacyObservation);
  if (row.kind === 'room') {
    commsP2PLegacyRoomPath(subject.path);
    for (const child of children) if (commsP2PLegacyCandidatePath(child.path).split('/').slice(0,2).join('/') !== subject.path) throw invalid();
    for (const side of ['callerCandidates','calleeCandidates']) if (children.filter(child => child.path.split('/')[2] === side).length > COMMS_P2P_LEGACY_CHILD_BATCH) throw invalid();
  } else {commsP2PLegacyCandidatePath(subject.path); if (children.length) throw invalid();}
  const paths = children.map(child => child.path);
  if (new Set(paths).size !== paths.length || paths.some((path,index) => index > 0 && Buffer.compare(Buffer.from(paths[index-1]),Buffer.from(path)) >= 0)) throw invalid();
  return {v: 1, projectId: commsP2PLegacyProject(row.projectId), planId: row.planId, cutoverId: row.cutoverId,
    kind: row.kind as 'room' | 'orphan', subject, children};
}
export function parseCommsP2PClosedRulesObservation(value: unknown): CommsP2PClosedRulesObservation {
  const row = object(value, ['projectId','rulesSha256','rulesetName','releaseUpdateTime']), projectId = commsP2PLegacyProject(row.projectId);
  if (typeof row.rulesSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.rulesSha256) ||
      typeof row.rulesetName !== 'string' || !row.rulesetName.startsWith(`projects/${projectId}/rulesets/`) ||
      !/^[a-zA-Z0-9-]+$/.test(row.rulesetName.slice(`projects/${projectId}/rulesets/`.length)) ||
      typeof row.releaseUpdateTime !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(row.releaseUpdateTime) || !Number.isFinite(Date.parse(row.releaseUpdateTime))) throw invalid();
  return {projectId, rulesSha256: row.rulesSha256, rulesetName: row.rulesetName, releaseUpdateTime: row.releaseUpdateTime};
}
export function legacyCommsP2PRoomKind(data: Record<string, unknown>): 'modern' | 'legacy' | 'unsupported' {
  if (data.v === 2) return 'modern';
  if (data.v !== undefined && data.v !== 1 || !attachmentActorIdValid(data.callerId) ||
      !attachmentActorIdValid(data.calleeId) || data.callerId === data.calleeId ||
      !['offer','active','closed'].includes(String(data.status))) return 'unsupported';
  return 'legacy';
}
