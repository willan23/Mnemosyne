import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  read: vi.fn(), cryptoChanged: null as (() => void) | null,
  setOpen: vi.fn(), toggle: vi.fn(), navigate: vi.fn(),
}));
vi.mock('../contexts/UIContext', () => ({ useUI: () => ({
  isCommandPaletteOpen: true, setIsCommandPaletteOpen: state.setOpen, setIsSettingsOpen: state.setOpen,
}) }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ toggleTheme: state.toggle }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('../services/recentSearches', () => ({
  readRecentSearches: state.read, pushRecentSearch: vi.fn(), clearRecentSearches: vi.fn(),
}));
vi.mock('../services/memoryCrypto', () => ({ onMemoryCryptoChanged: (callback: () => void) => {
  state.cryptoChanged = callback;
  return () => { state.cryptoChanged = null; };
} }));
import { CommandPalette } from './CommandPalette';
import type { SessionData } from '../hooks/useSessions';
import type { SessionSearchResults } from '../hooks/useSessions';

beforeEach(() => {
  state.read.mockReset().mockResolvedValue([]);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('CommandPalette privacy', () => {
  it('shows search failure separately from an empty result and binds it to query, account and vault', () => {
    const props = { uid: 'alice', vaultUnlocked: true, searchQuery: 'query',
      searchResults: { uid: 'alice', query: 'query', loading: false, hits: [], error: 'unavailable' as const } };
    const { rerender } = render(<CommandPalette {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent(/indisponível|unavailable|indisponible/i);
    rerender(<CommandPalette {...props} searchQuery="other" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<CommandPalette {...props} uid="bob" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<CommandPalette {...props} vaultUnlocked={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('shows bound semantic hits and discards results for another query, account or locked vault', async () => {
    const memory: SessionData = { id: 'semantic', uid: 'alice', text: 'Synthetic orchard evidence', timestamp: 1, updatedAt: 1 };
    const results: SessionSearchResults = { uid: 'alice', query: 'agronomy', loading: false,
      hits: [{ memory, score: .9, matchKind: 'semantic', snippet: memory.text, matchedTags: [] }] };
    const { rerender } = render(<CommandPalette uid="alice" vaultUnlocked searchQuery="agronomy" searchResults={results} memories={[memory]} />);
    expect(screen.getByRole('button', { name: /Synthetic orchard evidence/ })).toBeInTheDocument();
    rerender(<CommandPalette uid="alice" vaultUnlocked searchQuery="volcano" searchResults={results} memories={[memory]} />);
    expect(screen.queryByText(memory.text)).not.toBeInTheDocument();
    rerender(<CommandPalette uid="bob" vaultUnlocked searchQuery="agronomy" searchResults={results} memories={[memory]} />);
    expect(screen.queryByText(memory.text)).not.toBeInTheDocument();
    rerender(<CommandPalette uid="alice" vaultUnlocked={false} searchQuery="agronomy" searchResults={results} memories={[memory]} />);
    expect(screen.queryByText(memory.text)).not.toBeInTheDocument();
  });

  it('respects an empty result and never trusts unbound scores from the general memory list', () => {
    const memory: SessionData = { id: 'stale', uid: 'alice', text: 'Synthetic orchard evidence', timestamp: 1, updatedAt: 1, semanticScore: 1 };
    const { rerender } = render(<CommandPalette uid="alice" vaultUnlocked searchQuery="orchard"
      searchResults={{ uid: 'alice', query: 'orchard', loading: false, hits: [] }} memories={[memory]} />);
    expect(screen.queryByText(memory.text)).not.toBeInTheDocument();
    rerender(<CommandPalette uid="alice" vaultUnlocked searchQuery="volcano" memories={[memory]} />);
    expect(screen.queryByText(memory.text)).not.toBeInTheDocument();
    rerender(<CommandPalette uid="alice" vaultUnlocked searchQuery="orchard" memories={[memory]} />);
    expect(screen.getByRole('button', { name: /Synthetic orchard evidence/ })).toBeInTheDocument();
  });
  it('rechecks date filters even when parent scores are present', async () => {
    const old: SessionData = { id: 'old', uid: 'alice', text: 'outside interval content',
      timestamp: 1, updatedAt: 1, semanticScore: 1 };
    await act(async () => render(<CommandPalette uid="alice" vaultUnlocked
      searchQuery="after:2026-09-01" memories={[old]} />));
    expect(screen.queryByText('outside interval content')).not.toBeInTheDocument();
  });
  it('discards a recent-history read that completes after a vault change', async () => {
    let finish!: (items: string[]) => void;
    state.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<CommandPalette uid="alice" vaultUnlocked />);
    act(() => state.cryptoChanged?.());
    await act(async () => finish(['private previous search']));
    expect(screen.queryByText('private previous search')).not.toBeInTheDocument();
  });
  it('does not display a locked memory even when parent scores are present', async () => {
    const locked: SessionData = { id: 'locked', uid: 'alice', text: 'private locked content',
      timestamp: 1, updatedAt: 1, semanticScore: 1, encLocked: true };
    await act(async () => render(<CommandPalette uid="alice" vaultUnlocked
      searchQuery="private" memories={[locked]} />));
    expect(screen.queryByText('private locked content')).not.toBeInTheDocument();
  });
});
