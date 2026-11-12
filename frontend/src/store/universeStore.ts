import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { castDraft } from 'immer';
import { memoryById } from '../services/memorySnapshot';
import { confirmUniverseCreation, finishUniverseDeletion, isUniversePublication, stageUniverseDeletion, type UniverseViewCommit } from '../services/universeMemoryPublication';
import type {
  MemoryObject,
  UniverseState,
  UniverseType,
  DeletionType,
} from '../types/universe';

interface UniverseActions {
  setUniverseType: (type: UniverseType) => void;
  addMemory: (memory: MemoryObject, confirmation?: UniverseViewCommit) => void;
  removeMemory: (id: string, confirmation?: UniverseViewCommit) => void;
  selectMemory: (id: string | null) => void;
  hoverMemory: (id: string | null) => void;
  setIsAddingMemory: (v: boolean) => void;
  setIsLoading: (v: boolean) => void;
  setEmbeddingReady: (v: boolean) => void;
  setCameraPosition: (pos: [number, number, number]) => void;
  setCameraTarget: (target: [number, number, number]) => void;
  setSearchQuery: (q: string) => void;
  setFilteredIds: (ids: string[] | null) => void;
  startDeletion: (id: string, type: DeletionType, confirmation?: UniverseViewCommit) => boolean;
  loadMemories: (memories: readonly MemoryObject[]) => void;
  setGalaxyView: (v: boolean) => void;
  setLanguage: (lang: 'pt-pt' | 'pt-br' | 'en' | 'fr') => void;
  markSpawn: (id: string) => void;
  clearSpawn: () => void;
  setTaxonomyFilter: (lane: import('../utils/taxonomy').TaxonomyLane | null) => void;
  setStudyMemoryId: (id: string | null) => void;
}

const initialState: UniverseState = {
  universeType: 'stellar',
  memories: [],
  selectedMemoryId: null,
  hoveredMemoryId: null,
  isAddingMemory: false,
  isLoading: false,
  embeddingReady: false,
  cameraPosition: [0, 0, 25],
  cameraTarget: [0, 0, 0],
  searchQuery: '',
  filteredIds: null,
  deletingMemoryId: null,
  deletionType: null,
  isGalaxyView: false,
  language: 'en',
  spawnedMemoryId: null,
  spawnedAt: 0,
  taxonomyFilter: null,
  studyMemoryId: null,
};

export const useUniverseStore = create<UniverseState & UniverseActions>()(
  persist(
    immer((set, get) => ({
      ...initialState,

      setUniverseType: (type) =>
        set((state) => { state.universeType = type; }),

      addMemory: (memory, confirmation) => {
        const current = get().memories;
        const scoped = isUniversePublication(current) || confirmation !== undefined || !Array.isArray(current);
        const next = scoped ? confirmUniverseCreation(current, memory.id, confirmation) : undefined;
        if (scoped && !next) return;
        set((state) => {
          if (next) state.memories = castDraft<readonly MemoryObject[]>(next);
          else if (!memoryById(current, memory.id)) state.memories.push(memory);
          state.spawnedMemoryId = memory.id;
          state.spawnedAt = Date.now();
        });
      },

      markSpawn: (id) =>
        set((state) => {
          state.spawnedMemoryId = id;
          state.spawnedAt = Date.now();
        }),

      clearSpawn: () =>
        set((state) => {
          state.spawnedMemoryId = null;
          state.spawnedAt = 0;
        }),

      removeMemory: (id, confirmation) => {
        const current = get().memories, scoped = isUniversePublication(current) || confirmation !== undefined || !Array.isArray(current);
        const next = scoped ? finishUniverseDeletion(current, id, confirmation) : undefined;
        if (scoped && !next) return;
        set((state) => {
          state.memories = castDraft<readonly MemoryObject[]>(next ?? current.filter(memory => memory.id !== id));
          if (state.selectedMemoryId === id && !memoryById(next ?? state.memories, id)) state.selectedMemoryId = null;
          if (state.deletingMemoryId === id) { state.deletingMemoryId = null; state.deletionType = null; }
        });
      },

      selectMemory: (id) =>
        set((state) => {
          state.selectedMemoryId = id;
          if (id !== null) {
            state.isGalaxyView = false;
          }
        }),

      hoverMemory: (id) =>
        set((state) => { state.hoveredMemoryId = id; }),

      setIsAddingMemory: (v) =>
        set((state) => { state.isAddingMemory = v; }),

      setIsLoading: (v) =>
        set((state) => { state.isLoading = v; }),

      setEmbeddingReady: (v) =>
        set((state) => { state.embeddingReady = v; }),

      setCameraPosition: (pos) =>
        set((state) => { state.cameraPosition = pos; }),

      setCameraTarget: (target) =>
        set((state) => { state.cameraTarget = target; }),

      setSearchQuery: (q) =>
        set((state) => { state.searchQuery = q; }),

      setFilteredIds: (ids) =>
        set((state) => { state.filteredIds = ids; }),

      startDeletion: (id, type, confirmation) => {
        const current = get().memories, scoped = isUniversePublication(current) || confirmation !== undefined || !Array.isArray(current);
        const next = scoped ? stageUniverseDeletion(current, id, confirmation) : undefined;
        if (scoped && !next) return false;
        const row = memoryById(next ?? current, id), visible = Boolean(row && (!scoped || row.pendingDeletion));
        set((state) => {
          if (next) state.memories = castDraft<readonly MemoryObject[]>(next);
          if (!visible) { if (!row && state.selectedMemoryId === id) state.selectedMemoryId = null; return; }
          state.deletingMemoryId = id;
          state.deletionType = type;
        });
        return visible;
      },

      loadMemories: (memories) =>
        set((state) => {
          state.memories = castDraft(memories);
          if (state.selectedMemoryId && !memoryById(memories, state.selectedMemoryId)) {
            state.selectedMemoryId = null;
          }
          state.hoveredMemoryId = null;
          state.filteredIds = null;
        }),

      setGalaxyView: (v) =>
        set((state) => {
          state.isGalaxyView = v;
          if (v) {
            state.selectedMemoryId = null;
          }
        }),

      setLanguage: (lang) =>
        set((state) => {
          state.language = lang;
        }),

      setTaxonomyFilter: (lane) =>
        set((state) => {
          state.taxonomyFilter = lane;
        }),

      setStudyMemoryId: (id) =>
        set((state) => {
          state.studyMemoryId = id;
          if (id) state.selectedMemoryId = id;
        }),
    })),
    {
      name: 'mnemosyne-universe-preferences',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ universeType: state.universeType, language: state.language }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<UniverseState> | undefined;
        let lang = (persisted?.language ?? currentState.language ?? 'en') as string;
        if (lang === 'pt') {
            lang = 'pt-pt';
        }
        return {
          ...currentState,
          universeType: persisted?.universeType === 'garden' ? 'solar' : persisted?.universeType ?? currentState.universeType,
          language: lang as 'pt-pt' | 'pt-br' | 'en' | 'fr',
        };
      },
    }
  )
);
