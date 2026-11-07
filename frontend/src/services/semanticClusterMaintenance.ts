import type {SessionData} from '../hooks/useSessions';
import {semanticClusterComponents} from '../../../functions/src/semanticClusterGraph';
import {SEMANTIC_CLUSTER_MAX_DEPENDENCIES, SEMANTIC_CLUSTER_MAX_PATCHES} from '../../../functions/src/semanticClusterContract';
import {applySemanticClusterBatch, hasPendingSemanticClusters, prepareSemanticClusterComponent, semanticClusterWritesEnabled, type SemanticClusterGraphView} from './semanticClusterRecovery';

/** Use the complete visible scope. Search results are never an input to maintenance. */
export function semanticClusterMaintenancePlan(uid: string, sessions: readonly SessionData[]) {
  const scopes = new Map<string | null, SemanticClusterGraphView[]>();
  for (const memory of sessions) {
    if (!memory.semanticGraphHash || memory.deletedAt != null || memory.teamScopeAmbiguous || memory.encLocked) continue;
    const teamId = memory.teamId ?? null;
    if (teamId === null && (memory.uid !== uid || memory.sharedWithIds != null && (!Array.isArray(memory.sharedWithIds) || memory.sharedWithIds.length))) continue;
    const graphs = scopes.get(teamId) ?? [];
    graphs.push({id: memory.id, uid: memory.uid, teamId, graphHash: memory.semanticGraphHash, connections: [...(memory.connections ?? [])], semanticClusterId: memory.semanticClusterId ?? null});
    scopes.set(teamId, graphs);
  }
  return [...scopes].flatMap(([teamId, graphs]) => semanticClusterComponents(graphs)
    .filter(component => component.some(row => !row.semanticClusterId?.trim()))
    .map(graphs => ({teamId, graphs: graphs.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)})));
}

export const semanticClusterMaintenanceKey = (uid: string, sessions: readonly SessionData[]) => JSON.stringify([uid,
  semanticClusterMaintenancePlan(uid, sessions).map(component => [component.teamId, component.graphs.map(row => [row.id, row.graphHash])])]);

const defaults = {enabled: semanticClusterWritesEnabled, pending: hasPendingSemanticClusters, prepare: prepareSemanticClusterComponent, apply: applySemanticClusterBatch};
export async function runSemanticClusterMaintenance(uid: string, sessions: readonly SessionData[], assertCurrent: () => void, deps = defaults) {
  const plan = semanticClusterMaintenancePlan(uid, sessions);
  for (const component of plan) {
    assertCurrent();
    if (!deps.enabled(component.teamId)) continue;
    if (await deps.pending(uid)) throw Error('Um pedido de agrupamento aguarda confirmação.');
    assertCurrent();
    if (component.graphs.length > SEMANTIC_CLUSTER_MAX_DEPENDENCIES) throw Error('Este conjunto excede o limite de manutenção.');
    const prepared = await deps.prepare({uid, ...component, assertCurrent});
    assertCurrent();
    let baseline = prepared.prepared;
    for (let index = 0; index < prepared.patches.length; index += SEMANTIC_CLUSTER_MAX_PATCHES) {
      assertCurrent();
      const result = await deps.apply(uid, baseline, prepared.patches.slice(index, index + SEMANTIC_CLUSTER_MAX_PATCHES), assertCurrent);
      assertCurrent();
      if (result.status !== 'committed' || !result.dependencyUpdates) throw Error('O lote de agrupamentos não foi confirmado.');
      // Only our confirmed writes advance. No preparation/rebase between batches.
      const ownUpdates = new Map(result.dependencyUpdates.map(row => [row.sessionId, row.stateHash]));
      baseline = {...baseline, dependencies: baseline.dependencies.map(row => ({...row, stateHash: ownUpdates.get(row.sessionId) ?? row.stateHash}))};
    }
  }
}
