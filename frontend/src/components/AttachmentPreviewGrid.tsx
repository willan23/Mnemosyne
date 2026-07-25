import React from 'react';
import { FileText, Mic } from 'lucide-react';
import type { Attachment } from '../types/attachments';
import { formatFileSize } from '../utils/storage';

interface AttachmentPreviewGridProps {
  attachments?: Attachment[];
  compact?: boolean;
  limit?: number;
}

export const AttachmentPreviewGrid: React.FC<AttachmentPreviewGridProps> = ({
  attachments = [],
  compact = false,
  limit,
}) => {
  if (attachments.length === 0) return null;
  const visibleAttachments = typeof limit === 'number' ? attachments.slice(0, limit) : attachments;
  const hiddenCount = attachments.length - visibleAttachments.length;

  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {visibleAttachments.map((attachment, index) => (
        <div
          key={`${attachment.url}-${index}`}
          className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]"
        >
          {attachment.type === 'image' ? (
            <a href={attachment.url} target="_blank" rel="noreferrer">
              <img
                src={attachment.url}
                alt={attachment.name}
                loading="lazy"
                className={`w-full object-cover ${compact ? 'h-24' : 'h-40'}`}
              />
            </a>
          ) : attachment.type === 'audio' ? (
            <div className={`flex flex-col items-center justify-center gap-2 bg-white/[0.03] p-3 ${compact ? 'h-24' : 'h-32'}`}>
              <Mic className="h-5 w-5 text-indigo-300" />
              <audio src={attachment.url} controls className="w-full" />
            </div>
          ) : attachment.type === 'video' ? (
            <video
              src={attachment.url}
              controls
              className={`w-full bg-black/30 object-cover ${compact ? 'h-24' : 'h-40'}`}
            />
          ) : (
            <a
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className={`flex flex-col items-center justify-center gap-2 bg-white/[0.03] p-3 transition hover:bg-white/[0.08] ${compact ? 'h-24' : 'h-32'}`}
            >
              <FileText className="h-5 w-5 text-cyan-200" />
              <span className="line-clamp-2 text-center text-xs text-white/70">Abrir documento</span>
            </a>
          )}

          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-white/45">
            <span className="truncate">{attachment.name}</span>
            {attachment.size ? <span className="shrink-0">{formatFileSize(attachment.size)}</span> : null}
          </div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 text-center text-xs text-white/55">
          +{hiddenCount} anexo{hiddenCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
};
