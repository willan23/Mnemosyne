import { create } from 'zustand';
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
};

export const useUniverseStore = create<UniverseState & UniverseActions>()(
  immer((set) => ({
    ...initialState,

    setUniverseType: (type) =>
      set((state) => { state.universeType = type; }),

    addMemory: (memory) =>
      set((state) => { state.memories.push(memory); }),

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
      set((state) => { state.selectedMemoryId = id; }),

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
        if (state.deletingMemoryId) {
          state.memories = state.memories.filter(
            (m) => m.id !== state.deletingMemoryId
          );
        }
        state.deletingMemoryId = null;
        state.deletionType = null;
        if (state.selectedMemoryId === state.deletingMemoryId) {
          state.selectedMemoryId = null;
        }
      }),

    loadMemories: (memories) =>
      set((state) => { state.memories = memories; }),

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
  }))
);
