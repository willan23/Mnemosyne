/**
 * Cápsulas públicas cifradas: packs multi-memória.
 */

export const CAPSULE_PACK_MARKER = '[[MNEMOSYNE_CAPSULE_PACK_V1]]';
export const CAPSULE_PACK_MAX_BYTES = 1_500_000;
export const CAPSULE_ITEM_MAX_BYTES = 120_000;
export class CapsulePayloadError extends Error { constructor(){super('A cápsula é inválida, vazia ou excede os limites de importação.');} }
const bytes=(text:string)=>new TextEncoder().encode(text).byteLength;
export function captureCapsuleItems(value:unknown):CapsulePackItem[]{
  if(!Array.isArray(value)||!value.length||value.length>150)throw new CapsulePayloadError();
  return value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['title','text','tags'].includes(key))||
      typeof item.text!=='string'||!item.text.trim()||bytes(item.text)>CAPSULE_ITEM_MAX_BYTES||
      (item.title!==undefined&&(typeof item.title!=='string'||bytes(item.title)>1000))||
      (item.tags!==undefined&&(!Array.isArray(item.tags)||item.tags.length>50||item.tags.some((tag:unknown)=>typeof tag!=='string'||bytes(tag)>128))))throw new CapsulePayloadError();
    return{text:item.text.trim(),...(item.title?.trim()?{title:item.title.trim()}:{}),...(item.tags?{tags:[...item.tags]}:{})};
  });
}

export interface CapsulePackItem {
  title?: string;
  text: string;
  tags?: string[];
}

export interface CapsulePackPayload {
  v: 1;
  type: 'pack';
  createdAt: number;
  items: CapsulePackItem[];
}

export function isCapsulePackText(text: string): boolean {
  return text.trimStart().startsWith(CAPSULE_PACK_MARKER);
}

export function encodeCapsulePack(items: CapsulePackItem[]): string {
  const payload: CapsulePackPayload = {
    v: 1,
    type: 'pack',
    createdAt: Date.now(),
    items: captureCapsuleItems(items),
  };
  const encoded=`${CAPSULE_PACK_MARKER}\n${JSON.stringify(payload)}`;if(bytes(encoded)>CAPSULE_PACK_MAX_BYTES)throw new CapsulePayloadError();return encoded;
}

export function decodeCapsulePack(text: string): CapsulePackPayload | null {
  if (!isCapsulePackText(text)) return null;
  try {
    const json = text.trim().slice(CAPSULE_PACK_MARKER.length).trim();
    if(bytes(text)>CAPSULE_PACK_MAX_BYTES)return null;
    const parsed = JSON.parse(json);
    if (!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).sort().join(',')!=='createdAt,items,type,v'||parsed.v!==1||parsed.type!=='pack'||!Number.isSafeInteger(parsed.createdAt)||parsed.createdAt<1)return null;
    return{v:1,type:'pack',createdAt:parsed.createdAt,items:captureCapsuleItems(parsed.items)};
  } catch {
    return null;
  }
}
