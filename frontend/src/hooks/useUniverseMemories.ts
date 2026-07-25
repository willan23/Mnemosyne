import { useEffect, useRef, useCallback } from 'react';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../firebase';
import { useUniverseStore } from '../store/universeStore';
import type { MemoryObject } from '../types/universe';

function toFirestore(memory: MemoryObject): Record<string, unknown> {
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

function fromFirestore(data: Record<string, unknown>, id: string): MemoryObject {
  return {
    id,
    text: data.text as string,
    title: data.title as string | undefined,
    celestialType: data.celestialType as MemoryObject['celestialType'],
    position: data.position as [number, number, number],
    embedding: typeof data.embedding === 'string' ? JSON.parse(data.embedding) : (data.embedding as number[]),
    connections: (data.connections as string[]) ?? [],
    semanticClusterId: data.semanticClusterId as string | undefined,
    importance: (data.importance as number) ?? 0.5,
    timestamp: data.timestamp as number ?? (data.createdAt as Timestamp)?.toMillis() ?? Date.now(),
    updatedAt: data.updatedAt as number ?? (data.updatedAt as Timestamp)?.toMillis() ?? Date.now(),
    uid: data.uid as string,
    tags: (data.tags as string[]) ?? [],
    category: data.category as string | undefined,
    color: data.color as string | undefined,
    scale: data.scale as number | undefined,
    orbitRadius: data.orbitRadius as number | undefined,
    orbitSpeed: data.orbitSpeed as number | undefined,
    parentId: data.parentId as string | undefined,
    entities: data.entities as MemoryObject['entities'] ?? undefined,
  };
}

export function useUniverseMemories() {
  const { loadMemories, setIsLoading } = useUniverseStore();
  const uidRef = useRef<string | null>(null);
  const unsubscribeSnapshotRef = useRef<(() => void) | null>(null);
  const syncedIdsRef = useRef<Set<string>>(new Set());

  const subscribeToMemories = useCallback((uid: string) => {
    if (unsubscribeSnapshotRef.current) {
      unsubscribeSnapshotRef.current();
    }

    setIsLoading(true);
    const memoriesRef = collection(db, 'users', uid, 'memories');
    const q = query(memoriesRef, orderBy('timestamp', 'asc'));

    const unsub = onSnapshot(q, (snapshot) => {
      const memories: MemoryObject[] = [];
      snapshot.forEach((docSnap) => {
        memories.push(fromFirestore(docSnap.data() as Record<string, unknown>, docSnap.id));
        syncedIdsRef.current.add(docSnap.id);
      });
      loadMemories(memories);
      setIsLoading(false);
    }, (err) => {
      console.error('Universe memories snapshot error:', err);
      setIsLoading(false);
    });

    unsubscribeSnapshotRef.current = unsub;
    return unsub;
  }, [loadMemories, setIsLoading]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        uidRef.current = user.uid;
        subscribeToMemories(user.uid);
      } else {
        uidRef.current = null;
        if (unsubscribeSnapshotRef.current) {
          unsubscribeSnapshotRef.current();
          unsubscribeSnapshotRef.current = null;
        }
        loadMemories([]);
      }
    });

    return () => {
      unsubAuth();
      if (unsubscribeSnapshotRef.current) {
        unsubscribeSnapshotRef.current();
      }
    };
  }, [subscribeToMemories, loadMemories]);

  const saveMemory = useCallback(async (memory: MemoryObject) => {
    const uid = uidRef.current;
    if (!uid) return;
    try {
      const memRef = doc(db, 'users', uid, 'memories', memory.id);
      await setDoc(memRef, toFirestore(memory));
    } catch (err) {
      console.error('Failed to save memory to Firestore:', err);
    }
  }, []);

  const deleteMemory = useCallback(async (id: string) => {
    const uid = uidRef.current;
    if (!uid) return;
    try {
      const memRef = doc(db, 'users', uid, 'memories', id);
      await deleteDoc(memRef);
    } catch (err) {
      console.error('Failed to delete memory from Firestore:', err);
    }
  }, []);

  return { saveMemory, deleteMemory };
}
