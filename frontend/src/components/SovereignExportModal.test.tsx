import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SovereignExportModal } from './SovereignExportModal';
import { useUniverseStore } from '../store/universeStore';

describe('SovereignExportModal', () => {
  it('starts with encryption selected for a migration backup', () => {
    useUniverseStore.setState({ language: 'en' });
    render(
      <SovereignExportModal
        isOpen
        onClose={vi.fn()}
        memories={[]}
        vaultUnlocked
        encryptByDefault
      />,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
