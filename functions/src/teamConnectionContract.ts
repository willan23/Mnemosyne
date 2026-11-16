import {attachmentActorIdValid,attachmentIdValid} from './attachmentEnvelope';
import {canonicalSyncState,syncIdValid} from './mobileSyncImportContract';
import {parseTeamRevisionCipher,teamRevisionRecord,type TeamRevisionCipher} from './teamRevisionContract';
import {parseMemoryEditBaseline,type MemoryEditBaseline} from './memoryEditContract';
export const TEAM_CONNECTION_MAX_BYTES=4_100_000,MAX_TEAM_CONNECTIONS=100;
export type TeamConnectionCall='prepare'|'apply'|'status'|'cancel';
export interface TeamConnectionTarget{teamId:string;sessionIds:[string,string]}
export type TeamConnectionBaselines=[MemoryEditBaseline,MemoryEditBaseline];
export interface TeamConnectionRequest{operationId:string;operation:'link'|'unlink';baselines:TeamConnectionBaselines;priorEncs:[TeamRevisionCipher,TeamRevisionCipher];encs:[TeamRevisionCipher|null,TeamRevisionCipher|null]}
export interface TeamConnectionOutcome{operationId:string;operation:'link'|'unlink';teamId:string;sessionIds:[string,string];digest:string;status:'unknown'|'committed'|'cancelled'|'revoked';changed:boolean|null;revisions:[number,number]|null;createdAt:number|null}
const fail=()=>Error('Invalid reciprocal encrypted connection');
export function parseTeamConnectionTarget(value:unknown):TeamConnectionTarget{const row=teamRevisionRecord(value,['teamId','sessionIds']);if(!attachmentActorIdValid(row.teamId)||!Array.isArray(row.sessionIds)||row.sessionIds.length!==2||!row.sessionIds.every(syncIdValid)||row.sessionIds[0]===row.sessionIds[1])throw fail();return{teamId:row.teamId,sessionIds:[row.sessionIds[0],row.sessionIds[1]]};}
export function parseTeamConnectionBaselines(value:unknown):TeamConnectionBaselines{
  if(!Array.isArray(value)||value.length!==2)throw fail();const bases=value.map(parseMemoryEditBaseline) as TeamConnectionBaselines;if(bases.some(base=>base.kind!=='team')||bases[0].sessionId===bases[1].sessionId||['teamId','ownerUid','teamStateHash','epochStateHash','keyEpoch','keyId'].some(key=>bases[0][key as keyof MemoryEditBaseline]!==bases[1][key as keyof MemoryEditBaseline]))throw fail();return bases;
}
export function parseTeamConnectionRequest(value:unknown):TeamConnectionRequest{
  const row=teamRevisionRecord(value,['operationId','operation','baselines','priorEncs','encs']);if(!attachmentIdValid(row.operationId)||!['link','unlink'].includes(row.operation as string)||!Array.isArray(row.priorEncs)||row.priorEncs.length!==2||!Array.isArray(row.encs)||row.encs.length!==2)throw fail();
  const baselines=parseTeamConnectionBaselines(row.baselines),priorEncs=row.priorEncs.map(parseTeamRevisionCipher) as TeamConnectionRequest['priorEncs'],encs=row.encs.map(enc=>enc===null?null:parseTeamRevisionCipher(enc)) as TeamConnectionRequest['encs'];if((encs[0]===null)!==(encs[1]===null)||encs.some(enc=>enc!==null&&enc.v!==2)||priorEncs.some((enc,index)=>enc.v===2&&baselines[index].priorKeyId===null))throw fail();const result={operationId:row.operationId,operation:row.operation as TeamConnectionRequest['operation'],baselines,priorEncs,encs};if(new TextEncoder().encode(canonicalSyncState(result)).length>TEAM_CONNECTION_MAX_BYTES)throw fail();return result;
}
export function teamConnectionList(value:unknown,ownId:string):string[]{const rows=value??[];if(!Array.isArray(rows)||rows.length>MAX_TEAM_CONNECTIONS||!rows.every(syncIdValid)||rows.includes(ownId)||new Set(rows).size!==rows.length)throw fail();return[...rows];}
export function teamConnectionDesired(lists:[string[],string[]],ids:[string,string],operation:'link'|'unlink'){
  const desired=lists.map((list,index)=>operation==='link'?Array.from(new Set([...list,ids[1-index]])):list.filter(id=>id!==ids[1-index])) as [string[],string[]];if(desired.some(list=>list.length>MAX_TEAM_CONNECTIONS))throw fail();return{desired,changed:desired.some((list,index)=>canonicalSyncState(list)!==canonicalSyncState(lists[index]))};
}
export const teamConnectionRequestBytes=(value:TeamConnectionRequest)=>canonicalSyncState(parseTeamConnectionRequest(value));
export function parseTeamConnectionCommand(mode:TeamConnectionCall,value:unknown){const row=teamRevisionRecord(value,['actorUid','request']);if(!attachmentActorIdValid(row.actorUid)||!['prepare','apply','status','cancel'].includes(mode))throw fail();return{actorUid:row.actorUid,request:mode==='prepare'?parseTeamConnectionTarget(row.request):parseTeamConnectionRequest(row.request)};}
