import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { PricingPage } from './PricingPage';
import { PlansModal } from '../components/PlanosModal';

const mode = vi.hoisted(() => ({ preview: false, checkout: false }));
vi.mock('../config/monetization', () => ({ get isFreeFirstMode() { return mode.preview; }, get checkoutEnabled() { return mode.checkout; } }));
vi.mock('../hooks/useSubscription', () => ({ useSubscription: () => ({ subscription: null, tier: 'free' }) }));
vi.mock('../components/PublicSiteFooter', () => ({ PublicSiteFooter: () => null }));
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: null } }));

beforeEach(() => { mode.preview = false; mode.checkout = false; });

it('the pricing page presents the approved monthly amounts and inclusive tax copy', async () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('€7,99', { exact: true })).toBeVisible());
    await waitFor(() => expect(screen.getByText('€29,99', { exact: true })).toBeVisible());
    expect(screen.getByText('Preços pagos com IVA incluído quando aplicável.')).toBeVisible();
    expect(screen.queryByText('€9.99', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anual/ })).not.toBeInTheDocument();
});

it('the plans modal uses the same monthly amounts as the pricing page', async () => {
    render(<PlansModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('7,99', { exact: true })).toBeVisible());
    await waitFor(() => expect(screen.getByText('29,99', { exact: true })).toBeVisible());
    expect(screen.getByText('Preços pagos com IVA incluído quando aplicável.')).toBeVisible();
    expect(screen.queryByText('12', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('29', { exact: true })).not.toBeInTheDocument();
});

it('catalogue changes preserve the disabled checkout in Founder Preview', () => {
    mode.preview = true;
    render(<MemoryRouter><PricingPage /></MemoryRouter>);
    expect(screen.queryByText('€7,99', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('€29,99', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade para Pro' })).not.toBeInTheDocument();
});
