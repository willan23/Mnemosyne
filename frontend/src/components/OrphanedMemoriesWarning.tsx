import React from 'react';
import { useTranslation } from '../utils/translations';

interface Props {
  memoriesCount: number;
  onResetAndClean: () => void;
  onDismiss: () => void;
}

export const OrphanedMemoriesWarning: React.FC<Props> = ({ memoriesCount, onResetAndClean, onDismiss }) => {
  const { t } = useTranslation();
  return (
    <div className="glass-card p-4 text-sm text-amber-400 flex items-center gap-3">
      <span>{t('orphanedMemoriesFound', { count: memoriesCount })}</span>
      <button onClick={onResetAndClean} className="underline">{t('clean')}</button>
      <button onClick={onDismiss} className="underline">{t('dismiss')}</button>
    </div>
  );
};
