import * as admin from 'firebase-admin';
import {createHash} from 'node:crypto';
import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {commsP2PLegacyProject,commsP2PLegacyPath,commsP2PLegacyRoomPath,commsP2PLegacyCandidatePath,
  parseCommsP2PServerVersion,commsP2PVersionMillis,compareCommsP2PVersions,
  parseCommsP2PLegacyPlan,parseCommsP2PClosedRulesObservation,legacyCommsP2PRoomKind,
  COMMS_P2P_LEGACY_GRACE_MS,COMMS_P2P_LEGACY_PAGE_SIZE,COMMS_P2P_LEGACY_CHILD_BATCH,
  COMMS_P2P_LEGACY_ROOT_FIELDS,COMMS_P2P_LEGACY_CHILD_FIELDS,
  type CommsP2PServerVersion,type CommsP2PLegacyObservation,type CommsP2PLegacyPlan,
  type CommsP2PLegacySource,type CommsP2PClosedRulesObservation} from './commsP2PLegacyContract';

// Admin CLI only; no callable, public API/MCP endpoint or automatic adoption.
export const COMMS_P2P_LEGACY_RECONCILIATION_ENABLED = false;
export interface CommsP2PLegacyDeps {
  firestore: FirebaseFirestore.Firestore;
  projectId: string;
  verifyRules: () => Promise<CommsP2PClosedRulesObservation>;
  enabled?: () => boolean;
  /** Internal emulator fixture only. The Admin CLI always uses the ten-minute default. */
  graceMs?: number;
}
const unavailable = () => new Error('P2P legacy reconciliation unavailable');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key,item) => item && typeof item === 'object' && !Array.isArray(item) ?
    Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
}
export const commsP2PLegacyPlanDigest = (value: unknown) => hash(canonical(parseCommsP2PLegacyPlan(value)));
function binding(deps: CommsP2PLegacyDeps) {
  const project = commsP2PLegacyProject(deps.projectId);
  // The installed SDK exposes this resolved getter at runtime but omits it from
  // its public type. CLI construction always supplies an explicit projectId.
  const target = deps.firestore as unknown as {projectId?: unknown;databaseId?: unknown};
  if (target.projectId !== project || target.databaseId !== '(default)') throw unavailable();
  return project;
}
function version(value: FirebaseFirestore.Timestamp | undefined): CommsP2PServerVersion {
  if (!value) throw unavailable();
  return parseCommsP2PServerVersion({seconds:value.seconds,nanoseconds:value.nanoseconds});
}
const same = (a: unknown,b: unknown) => canonical(a) === canonical(b);
function observe(snapshot: FirebaseFirestore.DocumentSnapshot): CommsP2PLegacyObservation {
  if (!snapshot.exists) throw unavailable();
  return {path:snapshot.ref.path,version:version(snapshot.updateTime),metadataDigest:hash(canonical(snapshot.data()))};
}
function sameObservation(snapshot: FirebaseFirestore.DocumentSnapshot,expected: CommsP2PLegacyObservation) {
  if (!same(observe(snapshot),expected)) throw unavailable();
}
async function rules(deps: CommsP2PLegacyDeps) {
  const project = binding(deps), policy = parseCommsP2PClosedRulesObservation(await deps.verifyRules());
  if (policy.projectId !== project) throw unavailable();
  return policy;
}
function writable(deps: CommsP2PLegacyDeps) {
  binding(deps); if (!(deps.enabled ?? (() => COMMS_P2P_LEGACY_RECONCILIATION_ENABLED))()) throw unavailable();
}
function cutoverData(snapshot: FirebaseFirestore.DocumentSnapshot,project: string,policy: CommsP2PClosedRulesObservation,graceMs=COMMS_P2P_LEGACY_GRACE_MS) {
  const data = snapshot.data();
  if (!data || data.v !== 1 || data.projectId !== project || data.status !== 'closed-sdk' || !same(data.policy,policy)) throw unavailable();
  const activated = version(data.activatedAt), read = version(snapshot.readTime);
  if (!Number.isSafeInteger(graceMs) || graceMs<0 || commsP2PVersionMillis(read) < commsP2PVersionMillis(activated) + graceMs) throw unavailable();
  return activated;
}

/** The CLI verifies the deployed rules source, project and release twice. Activation
 * gets a Firestore server timestamp; client-created legacy dates never authorize purge. */
export async function recordCommsP2PLegacyCutover(cutoverId: string,deps: CommsP2PLegacyDeps) {
  if (!attachmentIdValid(cutoverId)) throw unavailable(); writable(deps);
  const policy = await rules(deps), db = deps.firestore, ref = db.doc(`commsP2PLegacyCutovers/${cutoverId}`);
  await db.runTransaction(async tx => {
    const old = await tx.get(ref);
    if (old.exists) {
      const data = old.data();
      if (data?.v !== 1 || data.projectId !== deps.projectId || !same(data.policy,policy) || !['pending','closed-sdk'].includes(data.status)) throw unavailable();
    } else tx.create(ref,{v:1,projectId:deps.projectId,status:'pending',policy,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  if (!same(await rules(deps),policy)) throw unavailable();
  await db.runTransaction(async tx => {
    const old = await tx.get(ref), data = old.data();
    if (!data || data.v !== 1 || data.projectId !== deps.projectId || !same(data.policy,policy)) throw unavailable();
    if (data.status === 'closed-sdk') return;
    if (data.status !== 'pending') throw unavailable();
    tx.update(ref,{status:'closed-sdk',activatedAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  const saved = await ref.get();
  return {cutoverId,activatedAt:version(saved.data()?.activatedAt),policy};
}

export async function inventoryCommsP2PLegacyPage(value: {source: CommsP2PLegacySource;afterPath: string | null;limit: number},deps: Pick<CommsP2PLegacyDeps,'firestore'|'projectId'>) {
  binding({...deps,verifyRules:async () => {throw unavailable();}});
  if (!value || Object.keys(value).sort().join(',') !== 'afterPath,limit,source' ||
      !['rooms','callerCandidates','calleeCandidates'].includes(value.source) || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > COMMS_P2P_LEGACY_PAGE_SIZE) throw unavailable();
  const input = {...value}, source = input.source, db = deps.firestore;
  if (input.afterPath !== null) {
    const path = commsP2PLegacyPath(input.afterPath), parts = path.split('/');
    if (source === 'rooms' ? parts.length !== 2 || parts[0] !== 'p2pRooms' : parts[parts.length-2] !== source) throw unavailable();
  }
  let query = (source === 'rooms' ? db.collection('p2pRooms') : db.collectionGroup(source))
    .orderBy(admin.firestore.FieldPath.documentId()).select(...(source === 'rooms' ? COMMS_P2P_LEGACY_ROOT_FIELDS : COMMS_P2P_LEGACY_CHILD_FIELDS)).limit(input.limit+1);
  if (input.afterPath !== null) query = query.startAfter(db.doc(input.afterPath));
  const page = await query.get(), selected = page.docs.slice(0,input.limit);
  const rows: (CommsP2PLegacyObservation & {kind: string})[] = [];
  for (const snapshot of selected) {
    let kind: string = 'unsupported';
    if (source === 'rooms') {
      kind = legacyCommsP2PRoomKind(snapshot.data());
      const id = snapshot.data().legacyCleanupId;
      if (kind==='legacy' && attachmentIdValid(id)) {
        const receipt = await db.doc(`commsP2PLegacyReceipts/${id}`).get(), data = receipt.data();
        if (data?.v===1 && data.status==='applied' && data.kind==='room' && data.subjectPath===snapshot.ref.path &&
            data.remainingChildren===false && same(version(snapshot.updateTime),version(receipt.updateTime))) {
          const pages = await Promise.all(['callerCandidates','calleeCandidates'].map(side => snapshot.ref.collection(side).select('v').limit(1).get()));
          if (pages.every(page => page.empty)) kind = 'reconciled';
        }
      }
    }
    else {
      let path: string | null = null;
      try {path = commsP2PLegacyCandidatePath(snapshot.ref.path);} catch {kind = 'unsupported';}
      if (path !== null) {
        const parentRef = db.doc(path.split('/').slice(0,2).join('/'));
        const [parent] = await db.getAll(parentRef,{fieldMask:[...COMMS_P2P_LEGACY_ROOT_FIELDS]});
        kind = parent.exists ? 'parent-'+legacyCommsP2PRoomKind(parent.data()!) : 'orphan';
      }
    }
    rows.push({...observe(snapshot),kind});
  }
  const last = selected[selected.length-1];
  return {source,scanned:rows.length,rows,nextAfterPath:page.size>input.limit&&last?last.ref.path:null,exhausted:page.size<=input.limit};
}

/** Prepared after the SDK cutover grace. Plans contain metadata hashes, paths and
 * server document versions; SDP, ICE, labels and raw participant UIDs are omitted. */
export async function prepareCommsP2PLegacyPlan(value: {projectId:string;planId:string;cutoverId:string;kind:'room'|'orphan';path:string},deps: CommsP2PLegacyDeps): Promise<CommsP2PLegacyPlan> {
  if (!value || Object.keys(value).sort().join(',') !== 'cutoverId,kind,path,planId,projectId' ||
      value.projectId !== binding(deps) || !attachmentIdValid(value.planId) || !attachmentIdValid(value.cutoverId) || !['room','orphan'].includes(value.kind)) throw unavailable();
  const input = {...value};
  if (input.kind === 'room') commsP2PLegacyRoomPath(input.path); else commsP2PLegacyCandidatePath(input.path);
  const policy = await rules(deps), db = deps.firestore;
  return db.runTransaction(async tx => {
    const marker = await tx.get(db.doc(`commsP2PLegacyCutovers/${input.cutoverId}`)), activated = cutoverData(marker,input.projectId,policy,deps.graceMs);
    const [subject] = await tx.getAll(db.doc(input.path),{fieldMask:[...(input.kind === 'room' ? COMMS_P2P_LEGACY_ROOT_FIELDS : COMMS_P2P_LEGACY_CHILD_FIELDS)]});
    if (!subject.exists) throw unavailable();
    const children: CommsP2PLegacyObservation[] = [];
    if (input.kind === 'room') {
      if (legacyCommsP2PRoomKind(subject.data()!) !== 'legacy') throw unavailable();
      await authorizeRoomGeneration(tx,subject,activated,input.cutoverId,db);
      for (const side of ['callerCandidates','calleeCandidates']) {
        const page = await tx.get(subject.ref.collection(side).orderBy(admin.firestore.FieldPath.documentId())
          .select(...COMMS_P2P_LEGACY_CHILD_FIELDS).limit(COMMS_P2P_LEGACY_CHILD_BATCH));
        for (const child of page.docs) {if (compareCommsP2PVersions(version(child.updateTime),activated)>0) throw unavailable(); children.push(observe(child));}
      }
    } else {
      const [parent] = await tx.getAll(db.doc(input.path.split('/').slice(0,2).join('/')),{fieldMask:['v']});
      if (parent.exists || compareCommsP2PVersions(version(subject.updateTime),activated)>0) throw unavailable();
    }
    children.sort((a,b) => Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
    return parseCommsP2PLegacyPlan({v:1,projectId:input.projectId,planId:input.planId,cutoverId:input.cutoverId,kind:input.kind,subject:observe(subject),children});
  });
}
async function authorizeRoomGeneration(tx: FirebaseFirestore.Transaction,subject: FirebaseFirestore.DocumentSnapshot,activated: CommsP2PServerVersion,cutoverId: string,db: FirebaseFirestore.Firestore) {
  if (compareCommsP2PVersions(version(subject.updateTime),activated)<=0) return;
  const id = subject.data()?.legacyCleanupId;
  if (!attachmentIdValid(id)) throw unavailable();
  const receipt = await tx.get(db.doc(`commsP2PLegacyReceipts/${id}`)), data = receipt.data();
  if (!data || data.v!==1 || data.status!=='applied' || data.kind!=='room' || data.subjectPath!==subject.ref.path ||
      data.cutoverId!==cutoverId || !same(version(subject.updateTime),version(receipt.updateTime))) throw unavailable();
}
interface LegacyResult {planId:string;status:'unknown'|'applied';deletedCandidates:number;remainingChildren:boolean}
function knownReceipt(snapshot: FirebaseFirestore.DocumentSnapshot,plan: CommsP2PLegacyPlan): LegacyResult {
  const data = snapshot.data();
  if (!data || data.v!==1 || data.status!=='applied' || data.planDigest!==commsP2PLegacyPlanDigest(plan) ||
      data.subjectPath!==plan.subject.path || data.cutoverId!==plan.cutoverId || data.kind!==plan.kind ||
      !Number.isSafeInteger(data.deletedCandidates) || data.deletedCandidates<0 || data.deletedCandidates>2*COMMS_P2P_LEGACY_CHILD_BATCH || typeof data.remainingChildren!=='boolean') throw unavailable();
  return {planId:plan.planId,status:'applied',deletedCandidates:data.deletedCandidates,remainingChildren:data.remainingChildren};
}
export async function getCommsP2PLegacyPlanStatus(value: unknown,deps: Pick<CommsP2PLegacyDeps,'firestore'|'projectId'>): Promise<LegacyResult> {
  const plan = parseCommsP2PLegacyPlan(value);
  if (plan.projectId!==binding({...deps,verifyRules:async () => {throw unavailable();}})) throw unavailable();
  const saved = await deps.firestore.doc(`commsP2PLegacyReceipts/${plan.planId}`).get();
  return saved.exists ? knownReceipt(saved,plan) : {planId:plan.planId,status:'unknown',deletedCandidates:0,remainingChildren:false};
}
export async function applyCommsP2PLegacyPlan(value: unknown,deps: CommsP2PLegacyDeps): Promise<LegacyResult> {
  const plan = parseCommsP2PLegacyPlan(value); if (plan.projectId!==binding(deps)) throw unavailable(); writable(deps);
  const policy = await rules(deps), db = deps.firestore, receiptRef = db.doc(`commsP2PLegacyReceipts/${plan.planId}`);
  return db.runTransaction(async tx => {
    const old = await tx.get(receiptRef); if (old.exists) return knownReceipt(old,plan);
    const marker = await tx.get(db.doc(`commsP2PLegacyCutovers/${plan.cutoverId}`)), activated = cutoverData(marker,plan.projectId,policy,deps.graceMs);
    const [subject] = await tx.getAll(db.doc(plan.subject.path),{fieldMask:[...(plan.kind==='room'?COMMS_P2P_LEGACY_ROOT_FIELDS:COMMS_P2P_LEGACY_CHILD_FIELDS)]});
    sameObservation(subject,plan.subject);
    let remaining = false; const selected: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let caller: string | null = null, callee: string | null = null, owner: string | null = null;
    if (plan.kind==='room') {
      const data = subject.data()!; if (legacyCommsP2PRoomKind(data)!=='legacy') throw unavailable();
      await authorizeRoomGeneration(tx,subject,activated,plan.cutoverId,db);
      caller = data.callerId; callee = data.calleeId;
      for (const side of ['callerCandidates','calleeCandidates']) {
        const page = await tx.get(subject.ref.collection(side).orderBy(admin.firestore.FieldPath.documentId())
          .select(...COMMS_P2P_LEGACY_CHILD_FIELDS).limit(COMMS_P2P_LEGACY_CHILD_BATCH+1));
        if (page.size>COMMS_P2P_LEGACY_CHILD_BATCH) remaining = true;
        selected.push(...page.docs.slice(0,COMMS_P2P_LEGACY_CHILD_BATCH));
      }
      selected.sort((a,b) => Buffer.compare(Buffer.from(a.ref.path),Buffer.from(b.ref.path)));
      if (selected.length!==plan.children.length) throw unavailable();
      for (let index=0;index<selected.length;index++) {
        sameObservation(selected[index],plan.children[index]);
        if (compareCommsP2PVersions(version(selected[index].updateTime),activated)>0) throw unavailable();
      }
    } else {
      const [parent] = await tx.getAll(db.doc(plan.subject.path.split('/').slice(0,2).join('/')),{fieldMask:['v']});
      if (parent.exists ||
          compareCommsP2PVersions(version(subject.updateTime),activated)>0) throw unavailable();
      if (attachmentActorIdValid(subject.data()?.uid)) owner = subject.data()!.uid;
    }
    // Cleanup may overlap account deletion; never recreate participant references after a deletion marker.
    const marked = new Set<string>();
    for (const uid of [...new Set([caller,callee,owner].filter((uid):uid is string => uid!==null))]) {
      if ((await tx.get(db.doc(`accountDeletions/${uid}`))).exists) marked.add(uid);
    }
    const result: LegacyResult = {planId:plan.planId,status:'applied',deletedCandidates:plan.kind==='orphan'?1:selected.length,remainingChildren:remaining};
    if (plan.kind==='room') {
      for (const child of selected) tx.delete(child.ref);
      tx.update(subject.ref,{offer:admin.firestore.FieldValue.delete(),answer:admin.firestore.FieldValue.delete(),
        callerLabel:admin.firestore.FieldValue.delete(),status:'closed',legacyCleanupId:plan.planId,
        legacySignalsPurgedAt:admin.firestore.FieldValue.serverTimestamp()});
    } else tx.delete(subject.ref);
    tx.create(receiptRef,{v:1,kind:plan.kind,cutoverId:plan.cutoverId,subjectPath:plan.subject.path,
      planDigest:commsP2PLegacyPlanDigest(plan),status:'applied',deletedCandidates:result.deletedCandidates,
      remainingChildren:remaining,callerUid:caller&&!marked.has(caller)?caller:null,
      calleeUid:callee&&!marked.has(callee)?callee:null,ownerUid:owner&&!marked.has(owner)?owner:null,
      cleanedAt:admin.firestore.FieldValue.serverTimestamp()});
    return result;
  });
}
