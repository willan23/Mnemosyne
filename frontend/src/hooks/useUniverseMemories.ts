import { useEffect, useRef, useCallback } from 'react';
import {
  arrayUnion,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { useUniverseStore } from '../store/universeStore';
import type { MemoryObject } from '../types/universe';
import type { Attachment } from '../types/attachments';

const CELESTIAL_TYPES = new Set<MemoryObject['celestialType']>([
  'star',
  'sun',
  'planet',
  'moon',
  'comet',
  'black_hole',
  'nebula',
]);

function toMillis(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return fallback;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseEmbedding(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicPosition(id: string, timestamp: number): [number, number, number] {
  const hash = hashString(`${id}:${timestamp}`);
  const angle = ((hash % 3600) / 3600) * Math.PI * 2;
  const elevation = (((hash >>> 8) % 1000) / 1000 - 0.5) * 14;
  const radius = 8 + ((hash >>> 16) % 1800) / 100;
  return [
    Number((Math.cos(angle) * radius).toFixed(3)),
    Number(elevation.toFixed(3)),
    Number((Math.sin(angle) * radius).toFixed(3)),
  ];
}

function parsePosition(value: unknown, id: string, timestamp: number): [number, number, number] {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  ) {
    return value as [number, number, number];
  }
  return deterministicPosition(id, timestamp);
}

function parseCelestialType(value: unknown): MemoryObject['celestialType'] {
  return typeof value === 'string' && CELESTIAL_TYPES.has(value as MemoryObject['celestialType'])
    ? value as MemoryObject['celestialType']
    : 'planet';
}

function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((attachment): attachment is Attachment => (
    attachment &&
    typeof attachment === 'object' &&
    typeof attachment.url === 'string' &&
    typeof attachment.name === 'string' &&
    ['image', 'audio', 'document', 'video'].includes(String(attachment.type))
  ));
}

function toSessionFirestore(memory: MemoryObject): Record<string, unknown> {
  return {
    text: memory.text,
    title: memory.title ?? null,
    timestamp: memory.timestamp,
    updatedAt: memory.updatedAt,
    uid: memory.uid,
    nodes: null,
    links: null,
    embedding: memory.embedding?.length ? memory.embedding : null,
    connections: memory.connections,
    semanticClusterId: memory.semanticClusterId ?? null,
    position: memory.position,
    tags: memory.tags ?? [],
    category: memory.category ?? 'Universe',
    attachments: memory.attachments ?? [],
    generatedImagePrompt: memory.generatedImagePrompt ?? null,
    generatedImageProvider: memory.generatedImageProvider ?? null,
    generatedImageModel: memory.generatedImageModel ?? null,
    celestialType: memory.celestialType,
    importance: memory.importance,
    entities: memory.entities ?? null,
    processingMethod: 'universe+local-embedding',
  };
}

function toLegacyFirestore(memory: MemoryObject): Record<string, unknown> {
  return {
    ...memory,
    embedding: JSON.stringify(memory.embedding),
    connections: memory.connections,
    semanticClusterId: memory.semanticClusterId ?? null,
    position: memory.position,
    entities: memory.entities ?? null,
    tags: memory.tags ?? [],
    createdAt: Timestamp.fromMillis(memory.timestamp),
    updatedAt: Timestamp.fromMillis(memory.updatedAt),
  };
}

function fromFirestore(data: Record<string, unknown>, id: string, fallbackUid: string): MemoryObject {
  const timestamp = toMillis(data.timestamp ?? data.createdAt);
  const updatedAt = toMillis(data.updatedAt, timestamp);
  const text = typeof data.text === 'string' ? data.text : '';
  const title = typeof data.title === 'string' && data.title.trim()
    ? data.title
    : (text ? text.slice(0, 80) : undefined);

  return {
    id,
    text,
    title,
    celestialType: parseCelestialType(data.celestialType),
    position: parsePosition(data.position, id, timestamp),
    embedding: parseEmbedding(data.embedding),
    connections: toStringArray(data.connections),
    semanticClusterId: typeof data.semanticClusterId === 'string' ? data.semanticClusterId : undefined,
    importance: typeof data.importance === 'number' ? data.importance : 0.5,
    timestamp,
    updatedAt,
    uid: typeof data.uid === 'string' ? data.uid : fallbackUid,
    tags: toStringArray(data.tags),
    category: typeof data.category === 'string' ? data.category : undefined,
    attachments: parseAttachments(data.attachments),
    generatedImagePrompt: typeof data.generatedImagePrompt === 'string' ? data.generatedImagePrompt : undefined,
    generatedImageProvider: typeof data.generatedImageProvider === 'string' ? data.generatedImageProvider : undefined,
    generatedImageModel: typeof data.generatedImageModel === 'string' ? data.generatedImageModel : undefined,
    color: typeof data.color === 'string' ? data.color : undefined,
    scale: typeof data.scale === 'number' ? data.scale : undefined,
    orbitRadius: typeof data.orbitRadius === 'number' ? data.orbitRadius : undefined,
    orbitSpeed: typeof data.orbitSpeed === 'number' ? data.orbitSpeed : undefined,
    parentId: typeof data.parentId === 'string' ? data.parentId : undefined,
    entities: data.entities as MemoryObject['entities'] ?? undefined,
  };
}

export function useUniverseMemories() {
  const { loadMemories, setIsLoading } = useUniverseStore();
  const uidRef = useRef<string | null>(null);
  const unsubscribeRefs = useRef<Array<() => void>>([]);
  const sessionMemoriesRef = useRef<Map<string, MemoryObject>>(new Map());
  const legacyMemoriesRef = useRef<Map<string, MemoryObject>>(new Map());

  const publishMemories = useCallback(() => {
    const merged = new Map<string, MemoryObject>();
    legacyMemoriesRef.current.forEach((memory, id) => merged.set(id, memory));
    sessionMemoriesRef.current.forEach((memory, id) => merged.set(id, memory));
    loadMemories(
      Array.from(merged.values())
        .sort((a, b) => a.timestamp - b.timestamp)
    );
  }, [loadMemories]);

  const subscribeToMemories = useCallback((uid: string) => {
    unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRefs.current = [];
    sessionMemoriesRef.current.clear();
    legacyMemoriesRef.current.clear();

    setIsLoading(true);
    const sessionsRef = collection(db, 'sessions');
    // The published Firestore index already supports uid + timestamp DESC.
    // We normalize chronological order locally when publishing merged memories.
    const sessionsQuery = query(sessionsRef, where('uid', '==', uid), orderBy('timestamp', 'desc'));
    const legacyRef = collection(db, 'users', uid, 'memories');
    const legacyQuery = query(legacyRef, orderBy('timestamp', 'asc'));

    const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
      sessionMemoriesRef.current.clear();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (data.deletedAt) return;
        sessionMemoriesRef.current.set(docSnap.id, fromFirestore(data, docSnap.id, uid));
      });
      publishMemories();
      setIsLoading(false);
    }, (err) => {
      console.error('Universe sessions snapshot error:', err);
      setIsLoading(false);
    });

    const unsubLegacy = onSnapshot(legacyQuery, (snapshot) => {
      legacyMemoriesRef.current.clear();
      snapshot.forEach((docSnap) => {
        legacyMemoriesRef.current.set(
          docSnap.id,
          fromFirestore(docSnap.data() as Record<string, unknown>, docSnap.id, uid)
        );
      });
      publishMemories();
      setIsLoading(false);
    }, (err) => {
      console.error('Universe legacy memories snapshot error:', err);
      setIsLoading(false);
    });

    unsubscribeRefs.current = [unsubSessions, unsubLegacy];
    return () => {
      unsubSessions();
      unsubLegacy();
    };
  }, [publishMemories, setIsLoading]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        uidRef.current = user.uid;
        subscribeToMemories(user.uid);
      } else {
        uidRef.current = null;
        unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
        unsubscribeRefs.current = [];
        sessionMemoriesRef.current.clear();
        legacyMemoriesRef.current.clear();
        loadMemories([]);
      }
    });

    return () => {
      unsubAuth();
      unsubscribeRefs.current.forEach((unsubscribe) => unsubscribe());
      unsubscribeRefs.current = [];
    };
  }, [subscribeToMemories, loadMemories]);

  const saveMemory = useCallback(async (memory: MemoryObject) => {
    const uid = uidRef.current;
    if (!uid) return;
    try {
      const sessionRef = doc(db, 'sessions', memory.id);
      await setDoc(sessionRef, toSessionFirestore({ ...memory, uid }));
      await setDoc(doc(db, 'users', uid, 'memories', memory.id), toLegacyFirestore({ ...memory, uid }));

      if (memory.connections.length) {
        await Promise.all(memory.connections.map((memoryId) => (
          updateDoc(doc(db, 'sessions', memoryId), {
            connections: arrayUnion(memory.id),
            updatedAt: Date.now(),
          }).catch((error) => console.warn('Unable to back-link universe memory', memoryId, error))
        )));
      }
    } catch (err) {
      console.error('Failed to save memory to Firestore:', err);
    }
  }, []);

  const deleteMemory = useCallback(async (id: string) => {
    const uid = uidRef.current;
    if (!uid) return;
    try {
      await Promise.all([
        updateDoc(doc(db, 'sessions', id), {
          deletedAt: Date.now(),
          updatedAt: Date.now(),
        }).catch((error) => console.warn('Unable to soft-delete session memory', id, error)),
        deleteDoc(doc(db, 'users', uid, 'memories', id)),
      ]);
    } catch (err) {
      console.error('Failed to delete memory from Firestore:', err);
    }
  }, []);

  return { saveMemory, deleteMemory };
}
