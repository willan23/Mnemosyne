import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { MemoryObject } from '../../types/universe';
import { HTML_LANG, useTranslation } from '../../utils/translations';
import { useMemoryView } from '../../hooks/useMemoryView';
import type { MemoryViewOptions } from '../../services/memoryViewProtocol';

interface MemoryListViewProps {
  memories: MemoryObject[];
  mode: 'list' | 'table';
  selectedMemoryId: string | null;
  onSelect: (id: string) => void;
}

const PAGE_SIZE = 100;

export function MemoryListView({ memories, mode, selectedMemoryId, onSelect }: MemoryListViewProps) {
  const { t, language } = useTranslation();
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<string, HTMLButtonElement>());
  const nextFocus = useRef<{index: number; query: string; source: MemoryObject[]} | null>(null);
  const options = useMemo<MemoryViewOptions>(() => ({ mode: 'list', query: deferredQuery,
    locale: HTML_LANG[language] as 'pt-PT' | 'pt-BR' | 'en' | 'fr', limit: visibleCount }), [deferredQuery, language, visibleCount]);
  const view = useMemoryView(memories, options);

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    if (view.loading) return;
    const target = nextFocus.current; nextFocus.current = null;
    if (target?.query === deferredQuery && target.source === memories) {
      const row = view.memories[target.index]; if (row) resultRefs.current.get(row.id)?.focus();
    }
  }, [view.loading, view.memories, deferredQuery, memories]);
  const visible = view.memories;
  const dateOf = (memory: MemoryObject) =>
    new Date(memory.timestamp).toLocaleDateString(HTML_LANG[language]);
  const titleOf = (memory: MemoryObject) =>
    memory.title?.trim() || (memory.encLocked ? t('memoryListLocked') : memory.text.slice(0, 80)) || t('cmdUntitled');

  return (
    <main className="absolute inset-0 z-20 overflow-y-auto bg-[#03030d] px-4 pb-28 pt-40 text-white sm:px-6 md:pt-28"
      aria-busy={view.loading} aria-label={mode === 'list' ? t('memoryViewList') : t('memoryViewTable')}>
      <div className="mx-auto max-w-6xl space-y-4">
        <label className="block max-w-xl">
          <span className="sr-only">{t('memoryListSearch')}</span>
          <input ref={searchRef} type="search" value={query}
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }}
            placeholder={t('memoryListSearch')}
            className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400" />
        </label>
        <p aria-live="polite" className="text-xs text-slate-400">
          {view.error ? t('memoryViewUnavailable') : view.loading ? t('loading') : t('memoryListCount', { count: view.count })}
        </p>
        {view.error && <button type="button" onClick={view.retry} className="rounded-lg border border-white/15 px-4 py-2 text-sm">{t('memoryViewRetry')}</button>}
        {visible.length === 0 ? (
          !view.loading && !view.error && <p className="rounded-xl border border-white/10 p-6 text-sm text-slate-400">{t('memoryListEmpty')}</p>
        ) : mode === 'list' ? (
          <ul className="space-y-2">
            {visible.map((memory) => (
              <li key={memory.id}>
                <button type="button" ref={node => {if (node) resultRefs.current.set(memory.id, node); else resultRefs.current.delete(memory.id);}} onClick={() => onSelect(memory.id)}
                  aria-current={selectedMemoryId === memory.id ? 'true' : undefined}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] p-4 text-left hover:border-violet-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
                  <span className="block truncate text-sm font-semibold">{titleOf(memory)}</span>
                  {!memory.encLocked && <span className="mt-1 block line-clamp-2 text-xs text-slate-400">{memory.text}</span>}
                  <span className="mt-2 block text-[11px] text-slate-500">{dateOf(memory)} · {memory.category || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">{t('memoryViewTable')}</caption>
              <thead className="bg-white/[0.06] text-xs text-slate-300">
                <tr>
                  <th scope="col" className="p-3">{t('memoryListTitle')}</th>
                  <th scope="col" className="p-3">{t('memoryListCategory')}</th>
                  <th scope="col" className="p-3">{t('memoryListDate')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((memory) => (
                  <tr key={memory.id} className="border-t border-white/5">
                    <td className="p-3">
                      <button type="button" ref={node => {if (node) resultRefs.current.set(memory.id, node); else resultRefs.current.delete(memory.id);}} onClick={() => onSelect(memory.id)}
                        aria-current={selectedMemoryId === memory.id ? 'true' : undefined}
                        className="text-left font-medium text-violet-100 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
                        {titleOf(memory)}
                      </button>
                    </td>
                    <td className="p-3 text-slate-400">{memory.category || '—'}</td>
                    <td className="p-3 text-slate-400">{dateOf(memory)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!view.loading && visibleCount < view.count && (
          <button type="button" onClick={() => {nextFocus.current = {index: visibleCount, query: deferredQuery, source: memories}; setVisibleCount((count) => count + PAGE_SIZE);}}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/10">
            {t('memoryListMore')}
          </button>
        )}
      </div>
    </main>
  );
}
