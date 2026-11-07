import { expect, it } from 'vitest';
import { SemanticWriteSourceState } from './semanticWriteSourceState';
import type { MemoryPublicationPatch } from './incrementalMemoryPublication';

type Row = { id: string; timestamp: number; text?: string; embedding?: number[] };
const reset = (rows: Row[]): MemoryPublicationPatch<Row> => ({ changed: rows.map(value => ({ id: value.id, value })), removed: [], order: { reset: rows.map(value => value.id), changes: [] } });

it('captures 10000 raw references without reading fields and preserves the exact prior version after metadata and order deltas', () => {
  let timestampReads = 0, seed = 1;
  const rows = Array.from({ length: 10000 }, (_, index) => ({ id: 'm' + index, get timestamp() { timestampReads++; return index; }, get text() { throw Error('Read private text'); }, get embedding(): number[] { throw Error('Read vector'); } }));
  const state = new SemanticWriteSourceState<Row>(1, () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0, 4);
  state.apply(reset(rows)); timestampReads = 0; const before = state.capture(); expect(before.count).toBe(10000); expect(timestampReads).toBe(0);
  const changed = { id: 'm5000', timestamp: 5001 };
  state.apply({ changed: [{ id: changed.id, value: changed }], removed: [], order: { changes: [{ type: 'modified', id: changed.id, oldIndex: 5000, newIndex: 0 }] } });
  const after = state.capture(), oldRows = [...before.orderedRows()], newRows = [...after.orderedRows()];
  expect(timestampReads).toBe(0); expect(oldRows[5000].value === rows[5000]).toBe(true); expect(newRows[0].value === changed).toBe(true);
  expect(oldRows[0].id).toBe('m0'); expect(newRows[1].id).toBe('m0'); expect(before.priority).toBe(1); expect(state.ordinal).toBe(4);
});

it('matches an independent listener array over add, edit, move, null and remove patches while old roots remain intact', () => {
  let seed = 794, nextId = 0;
  const random = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const state = new SemanticWriteSourceState<Row>(2, random, 0); const rows: Array<{ id: string; value: Row | null }> = [];
  for (let step = 0; step < 500; step++) {
    const previous = state.capture(), expectedPrevious = rows.map(row => ({ ...row })), action = random() % 5;
    if (!rows.length || action === 0) {
      const id = 'm' + nextId++, value = { id, timestamp: step }, newIndex = random() % (rows.length + 1);
      rows.splice(newIndex, 0, { id, value }); state.apply({ changed: [{ id, value }], removed: [], order: { changes: [{ type: 'added', id, oldIndex: -1, newIndex }] } });
    } else {
      const oldIndex = random() % rows.length, { id } = rows[oldIndex];
      if (action === 1) { rows.splice(oldIndex, 1); state.apply({ changed: [], removed: [id], order: { changes: [{ type: 'removed', id, oldIndex, newIndex: -1 }] } }); }
      else if (action === 2) { const newIndex = random() % rows.length, [value] = rows.splice(oldIndex, 1); rows.splice(newIndex, 0, value); state.apply({ changed: [], removed: [], order: { changes: [{ type: 'modified', id, oldIndex, newIndex }] } }); }
      else { const value = action === 3 ? null : { id, timestamp: step }; rows[oldIndex] = { id, value }; state.apply({ changed: [{ id, value }], removed: [], order: { changes: [] } }); }
    }
    const actual = [...state.capture().orderedRows()], old = [...previous.orderedRows()];
    expect(actual.map(row => row.id)).toEqual(rows.map(row => row.id)); expect(old.map(row => row.id)).toEqual(expectedPrevious.map(row => row.id));
    actual.forEach((row, index) => expect(row.value === rows[index].value).toBe(true)); old.forEach((row, index) => expect(row.value === expectedPrevious[index].value).toBe(true));
    expect(state.size).toBe(rows.length);
  }
});
