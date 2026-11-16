import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUniverseStore } from '../../store/universeStore';
import type { MemoryObject } from '../../types/universe';
import { MemoryListView } from './MemoryListView';
import { MemoryViewWorkerMock } from '../../test/memoryViewWorkerMock';

beforeEach(() => vi.stubGlobal('Worker', MemoryViewWorkerMock));
afterEach(() => vi.unstubAllGlobals());

function memory(id: string, text: string, extra: Partial<MemoryObject> = {}): MemoryObject {
  return {
    id, text, title: id, celestialType: 'planet', position: [0, 0, 0],
    embedding: [], connections: [], importance: 0.5, timestamp: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000, uid: 'alice',
    ...extra,
  };
}

describe('MemoryListView', () => {
  it.each(['list', 'table'] as const)('moves focus to the first newly shown %s result, including the final page', async (mode) => {
    useUniverseStore.setState({language: 'en'});
    render(<MemoryListView mode={mode} memories={Array.from({length: 205}, (_, index) => memory(`Result ${index}`, 'Synthetic page text'))} selectedMemoryId={null} onSelect={vi.fn()}/>);
    const more = await screen.findByText('Show more', {selector: 'button'}); more.focus(); fireEvent.click(more);
    // While the Worker is pending, the previous button is unmounted and focus can be on body.
    // Wait on the actual button/title before computing its accessible name once.
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe('BUTTON');
      expect(document.activeElement?.firstElementChild?.textContent ?? document.activeElement?.textContent).toBe('Result 100');
    });
    expect(document.activeElement).toHaveAccessibleName(/Result 100(?![0-9])/);
    expect(document.activeElement).toHaveRole('button');
    expect(document.activeElement).toBeVisible();
    fireEvent.click(screen.getByText('Show more', {selector: 'button'}));
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe('BUTTON');
      expect(document.activeElement?.firstElementChild?.textContent ?? document.activeElement?.textContent).toBe('Result 200');
    });
    expect(document.activeElement).toHaveAccessibleName(/Result 200(?![0-9])/);
    expect(document.activeElement).toHaveRole('button');
    expect(document.activeElement).toBeVisible();
    expect(screen.queryByText('Show more', {selector: 'button'})).toBeNull();
  });
  it('offers keyboard search without indexing locked content', async () => {
    useUniverseStore.setState({ language: 'en' });
    const onSelect = vi.fn();
    render(<MemoryListView mode="list" memories={[
      memory('Alpha', 'available local text', { tags: ['planning'] }),
      memory('Locked', 'hidden token', { encLocked: true }),
    ]} selectedMemoryId={null} onSelect={onSelect} />);
    const search = screen.getByRole('searchbox', { name: 'Search memories' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'planning' } });
    expect(await screen.findByRole('button', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Locked/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    expect(onSelect).toHaveBeenCalledWith('Alpha');
    fireEvent.change(search, { target: { value: 'hidden token' } });
    expect(await screen.findByText('No memories found.')).toBeInTheDocument();
  });

  it('renders a semantic table and opens the selected memory', async () => {
    useUniverseStore.setState({ language: 'en' });
    const onSelect = vi.fn();
    render(<MemoryListView mode="table" memories={[memory('Project note', 'text', { category: 'Work' })]}
      selectedMemoryId={null} onSelect={onSelect} />);
    expect(await screen.findByRole('table', { name: 'Table' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Project note' }));
    expect(onSelect).toHaveBeenCalledWith('Project note');
  });
  it('reports a Worker failure instead of an empty vault and offers a fresh retry', async () => {
    useUniverseStore.setState({ language: 'en' });
    vi.stubGlobal('Worker', class { constructor() { throw Error('Synthetic worker unavailable'); } });
    render(<MemoryListView mode="list" memories={[memory('Recovered', 'text')]} selectedMemoryId={null} onSelect={vi.fn()} />);
    expect(await screen.findByText('This view could not be prepared. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('No memories found.')).toBeNull();
    vi.stubGlobal('Worker', MemoryViewWorkerMock); fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Recovered/ })).toBeInTheDocument();
  });
});
