import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiModelPicker } from './AiModelPicker';
import { defaultLocalAiConfig } from '../services/localAiConfig';
import { useUniverseStore } from '../store/universeStore';
import * as policy from '../../../functions/src/generationProviderPolicy';
import { within } from '@testing-library/react';
afterEach(() => vi.restoreAllMocks());

describe('AiModelPicker', () => {
  it('highlights the current provider and fills a real backend model id', () => {
    useUniverseStore.setState({ language: 'en' });
    const onSelectProvider = vi.fn();
    const onSelectModel = vi.fn();

    render(
      <AiModelPicker
        selectedProvider="openrouter"
        providers={defaultLocalAiConfig.providers}
        onSelectProvider={onSelectProvider}
        onSelectModel={onSelectModel}
      />,
    );

    expect(screen.getByText('OpenRouter · Gemma gratuito')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Gemma 4 31B · gratuito'));
    expect(onSelectProvider).toHaveBeenCalledWith('openrouter');
    expect(onSelectModel).toHaveBeenCalledWith('openrouter', 'openrouter-gemma-4-free');
    expect(screen.queryByText('Nemotron 3 Ultra 550B')).not.toBeInTheDocument();
    expect(screen.queryByText('Nemotron 3 Super 120B')).not.toBeInTheDocument();
    expect(screen.queryByText(/Gemini 3/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Claude Opus/)).not.toBeInTheDocument();
  });

  it('allows Hugging Face when explicitly enabled in a future configuration', () => {
    vi.spyOn(policy, 'isGenerationProviderEnabled').mockReturnValue(true);
    useUniverseStore.setState({ language: 'en' });
    const onSelectProvider = vi.fn(), onSelectModel = vi.fn();
    render(<AiModelPicker selectedProvider="huggingface" providers={defaultLocalAiConfig.providers}
      onSelectProvider={onSelectProvider} onSelectModel={onSelectModel} />);
    fireEvent.click(screen.getByText('GPT-OSS 120B via Hugging Face'));
    expect(onSelectProvider).toHaveBeenCalledWith('huggingface');
    expect(onSelectModel).toHaveBeenCalledWith('huggingface', 'hf-default');
  });

  for (const provider of ['gemini', 'huggingface'] as const) it(`keeps ${provider} visibly inactive until server configuration is validated`, () => {
    useUniverseStore.setState({ language: 'en' }); const onSelectProvider = vi.fn(), onSelectModel = vi.fn();
    render(<AiModelPicker selectedProvider={provider} providers={defaultLocalAiConfig.providers} onSelectProvider={onSelectProvider} onSelectModel={onSelectModel} />);
    const button = screen.getByRole('button', { name: provider === 'gemini' ? /Google Gemini/ : /Hugging Face/ });
    expect(button).toBeDisabled(); expect(within(button).getByText('Not configured')).toBeInTheDocument();
    fireEvent.click(button); expect(onSelectProvider).not.toHaveBeenCalled(); expect(onSelectModel).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Gemini 3.5|GPT-OSS 120B/ })).not.toBeInTheDocument();
  });

  for (const [language, badge] of [['pt-pt', 'Por configurar'], ['pt-br', 'Por configurar'], ['en', 'Not configured'], ['fr', 'À configurer']] as const) {
    it(`shows an inactive saved OpenAI selection in ${language} and prevents activation`, () => {
      useUniverseStore.setState({ language });
      const onSelectProvider = vi.fn(), onSelectModel = vi.fn();
      render(<AiModelPicker selectedProvider="openai" providers={defaultLocalAiConfig.providers}
        onSelectProvider={onSelectProvider} onSelectModel={onSelectModel} />);
      const button = screen.getByRole('button', { name: /OpenAI/ });
      expect(button).toBeDisabled(); expect(within(button).getByText(badge)).toBeInTheDocument();
      fireEvent.click(button); expect(onSelectProvider).not.toHaveBeenCalled(); expect(onSelectModel).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /GPT-4o/ })).not.toBeInTheDocument();
    });
  }
});
