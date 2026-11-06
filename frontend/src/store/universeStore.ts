import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  MemoryObject,
  UniverseState,
  UniverseType,
  DeletionType,
} from '../types/universe';

interface UniverseActions {
  setUniverseType: (type: UniverseType) => void;
  addMemory: (memory: MemoryObject) => void;
  updateMemory: (id: string, updates: Partial<MemoryObject>) => void;
  removeMemory: (id: string) => void;
  selectMemory: (id: string | null) => void;
  hoverMemory: (id: string | null) => void;
  setIsAddingMemory: (v: boolean) => void;
  setIsLoading: (v: boolean) => void;
  setEmbeddingReady: (v: boolean) => void;
  setCameraPosition: (pos: [number, number, number]) => void;
  setCameraTarget: (target: [number, number, number]) => void;
  setSearchQuery: (q: string) => void;
  setFilteredIds: (ids: string[] | null) => void;
  startDeletion: (id: string, type: DeletionType) => void;
  finishDeletion: () => void;
  loadMemories: (memories: MemoryObject[]) => void;
  addConnection: (sourceId: string, targetId: string) => void;
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
    immer((set) => ({
      ...initialState,

      setUniverseType: (type) =>
        set((state) => { state.universeType = type; }),

      addMemory: (memory) =>
        set((state) => {
          state.memories.push(memory);
          state.spawnedMemoryId = memory.id;
          state.spawnedAt = Date.now();
        }),

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

      updateMemory: (id, updates) =>
        set((state) => {
          const idx = state.memories.findIndex((m) => m.id === id);
          if (idx !== -1) {
            Object.assign(state.memories[idx], updates);
          }
        }),

      removeMemory: (id) =>
        set((state) => {
          state.memories = state.memories.filter((m) => m.id !== id);
        }),

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

      startDeletion: (id, type) =>
        set((state) => {
          state.deletingMemoryId = id;
          state.deletionType = type;
        }),

      finishDeletion: () =>
        set((state) => {
          const deletedMemoryId = state.deletingMemoryId;
          if (deletedMemoryId) {
            state.memories = state.memories.filter(
              (m) => m.id !== deletedMemoryId
            );
          }
          state.deletingMemoryId = null;
          state.deletionType = null;
          if (state.selectedMemoryId === deletedMemoryId) {
            state.selectedMemoryId = null;
          }
        }),

      loadMemories: (memories) =>
        set((state) => {
          state.memories = memories;
          if (state.selectedMemoryId && !memories.some((memory) => memory.id === state.selectedMemoryId)) {
            state.selectedMemoryId = null;
          }
          state.hoveredMemoryId = null;
          state.filteredIds = null;
        }),

      addConnection: (sourceId, targetId) =>
        set((state) => {
          const src = state.memories.find((m) => m.id === sourceId);
          const tgt = state.memories.find((m) => m.id === targetId);
          if (src && !src.connections.includes(targetId)) {
            src.connections.push(targetId);
          }
          if (tgt && !tgt.connections.includes(sourceId)) {
            tgt.connections.push(sourceId);
          }
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
