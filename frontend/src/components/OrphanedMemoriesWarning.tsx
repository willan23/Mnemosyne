import React from 'react';

interface Props {
  memoriesCount: number;
  onResetAndClean: () => void;
  onDismiss: () => void;
}

export const OrphanedMemoriesWarning: React.FC<Props> = ({ memoriesCount, onResetAndClean, onDismiss }) => (
  <div className="glass-card p-4 text-sm text-amber-400 flex items-center gap-3">
    <span>{memoriesCount} orphaned memories found.</span>
    <button onClick={onResetAndClean} className="underline">Clean</button>
    <button onClick={onDismiss} className="underline">Dismiss</button>
  </div>
);
