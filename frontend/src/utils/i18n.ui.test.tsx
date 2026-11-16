import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EnterprisePage } from '../pages/EnterprisePage';
import { LoginPage } from '../pages/LoginPage';
import { useUniverseStore } from '../store/universeStore';

vi.mock('../components/landing/LandingBackground', () => ({
  LandingBackground: () => null,
}));

describe('language switching', () => {
  it('updates public enterprise copy across PT-PT, EN, FR and PT-BR', () => {
    useUniverseStore.setState({ language: 'en' });
    render(
      <MemoryRouter>
        <EnterprisePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Enterprise');
    expect(screen.getByText(/No ISO\/SOC2 seal/i)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');

    fireEvent.click(screen.getAllByRole('button', { name: 'PT-PT' })[0]);
    expect(screen.getByText(/Sem selo ISO\/SOC2/i)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('pt-PT');

    fireEvent.click(screen.getAllByRole('button', { name: 'FR' })[0]);
    expect(screen.getByText(/Pas de sceau ISO\/SOC2/i)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('fr');

    fireEvent.click(screen.getAllByRole('button', { name: 'PT-BR' })[0]);
    expect(screen.getByText(/Sem selo ISO\/SOC2/i)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('translates the login hero when the locale changes', () => {
    useUniverseStore.setState({ language: 'en' });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Enter your/i);
    fireEvent.click(screen.getAllByRole('button', { name: 'FR' })[0]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Entrez dans votre/i);
    fireEvent.click(screen.getAllByRole('button', { name: 'PT-PT' })[0]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Entra no teu/i);
  });
});
