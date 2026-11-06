import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  AI_MODEL_PRESETS,
  AI_PROVIDERS,
  GENERATION_PROVIDER_IDS,
  isAiProviderEnabled,
  type AiProviderId,
  type AiProviderDefinition,
  type AiProviderConfig,
} from '../services/localAiConfig';
import { useTranslation } from '../utils/translations';

interface AiModelPickerProps {
  selectedProvider: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfig>;
  onSelectProvider: (provider: AiProviderId) => void;
  onSelectModel: (provider: AiProviderId, model: string) => void;
}

export const AiModelPicker: React.FC<AiModelPickerProps> = ({
  selectedProvider,
  providers,
  onSelectProvider,
  onSelectModel,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<AiProviderId | null>(selectedProvider);

  const toggleExpand = (provider: AiProviderId, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!isAiProviderEnabled(provider)) return;
    setExpanded((current) => (current === provider ? null : provider));
  };

  const selectRow = (provider: AiProviderDefinition) => {
    if (!isAiProviderEnabled(provider.id)) return;
    onSelectProvider(provider.id);
    setExpanded(provider.id);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1120]">
      <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {t('settingsAiModelMenu')}
      </p>
      <ul className="px-1.5 pb-1.5">
        {AI_PROVIDERS.filter((provider) => GENERATION_PROVIDER_IDS.includes(provider.id)).map((provider) => {
          const selected = selectedProvider === provider.id;
          const enabled = isAiProviderEnabled(provider.id);
          const presets = AI_MODEL_PRESETS[provider.id];
          const currentModel = providers[provider.id]?.model?.trim() || '';
          const isOpen = enabled && expanded === provider.id && presets.length > 0;
          const showFast = enabled && (provider.kind === 'local' || presets.some((preset) => preset.badge === 'fast' && preset.id === currentModel));

          return (
            <li key={provider.id}>
              <button
                type="button"
                disabled={!enabled}
                title={!enabled ? t('settingsAiProviderUnavailableHint') : undefined}
                onClick={() => selectRow(provider)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  selected
                    ? 'bg-white/[0.08] font-medium text-white'
                    : 'text-slate-300 hover:bg-white/[0.04] hover:text-slate-100'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{provider.label}</span>
                {!enabled && <span className="shrink-0 text-[10px] text-slate-400">{t('settingsAiProviderUnavailable')}</span>}
                {showFast && (
                  <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-300">
                    {t('settingsAiFast')}
                  </span>
                )}
                {presets.length > 0 && (
                  <span
                    role="presentation"
                    onClick={(event) => toggleExpand(provider.id, event)}
                    className={`shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
              {isOpen && (
                <ul className="mb-1 ml-2 border-l border-white/10 pl-2">
                  {presets.map((preset) => {
                    const presetSelected = selected && currentModel === preset.id;
                    return (
                      <li key={preset.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectProvider(provider.id);
                            onSelectModel(provider.id, preset.id);
                          }}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${
                            presetSelected
                              ? 'bg-white/[0.07] text-white'
                              : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                          {preset.badge === 'fast' && (
                            <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-slate-300">
                              {t('settingsAiFast')}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-white/5 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
        {t('settingsAiPickerHint')}
      </p>
    </div>
  );
};
