import {normalizeSearchValue} from '../utils/searchMemories';
import {SEARCH_CONTEXT_POLICY,type HybridSearchDocument} from './hybridSearchProtocol';
export interface SearchContextKey {kind:'entity'|'term';key:string}
/** Surface terms are lexical hints. They do not assert identity, permission or a factual relation. */
export function prepareSearchContextTerms(document:HybridSearchDocument,allowedTerms:ReadonlySet<string>):string[] {
  const result:string[]=[],seen=new Set<string>();
  const add=(key:string)=>{if(key.trim()&&key.length<=SEARCH_CONTEXT_POLICY.keyChars&&!seen.has(key)&&result.length<SEARCH_CONTEXT_POLICY.cachedKeys){seen.add(key);result.push(key);}};
  for(const text of [document.title??'',document.text??'']){
    for(const match of text.matchAll(/(?:^|[^\p{L}\p{N}])([\p{Lu}][\p{L}\p{N}_-]{2,})/gu)){
      if(match[1].length>SEARCH_CONTEXT_POLICY.keyChars)continue;
      for(const key of normalizeSearchValue(match[1]).split(/[_-]/))if(allowedTerms.has(key))add(key);
      if(result.length===SEARCH_CONTEXT_POLICY.cachedKeys)return result;
    }
  }
  return result;
}
