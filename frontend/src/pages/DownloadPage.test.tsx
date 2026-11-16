import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DownloadPage } from './DownloadPage';
import { useUniverseStore } from '../store/universeStore';
import { DESKTOP_SETUP_DOWNLOAD_URL, DESKTOP_UPDATER_FEED_URL } from '../config/downloads';

vi.mock('../components/landing/LandingBackground', () => ({ LandingBackground: () => null }));
afterEach(() => vi.restoreAllMocks());

it.each([
  ['pt-pt', 'Descarrega o Mnemosyne para Windows', 'instalação manual', 'Descarregar para Windows'],
  ['pt-br', 'Baixe o Mnemosyne para Windows', 'instalação manual', 'Baixar para Windows'],
  ['en', 'Download Mnemosyne for Windows', 'manual install', 'Download for Windows'],
  ['fr', 'Télécharger Mnemosyne pour Windows', 'installation manuelle', 'Télécharger pour Windows'],
] as const)('explains the manual migration and preserves explicit download choice in %s', (language, heading, notice, button) => {
  useUniverseStore.setState({ language }); const open = vi.spyOn(window, 'open').mockReturnValue(null);
  render(<MemoryRouter><DownloadPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
  expect(screen.getByText(new RegExp(notice))).toHaveTextContent('1.0.8');
  expect(screen.getByText(new RegExp(notice))).toHaveTextContent('1.0.9');
  expect(screen.queryByText(/\/desktop\/.*latest\.json/)).not.toBeInTheDocument();
  expect(open).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: button }));
  expect(open).toHaveBeenCalledWith(DESKTOP_SETUP_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
  expect(DESKTOP_UPDATER_FEED_URL).toMatch(/\/desktop\/v2\/latest\.json$/);
});
