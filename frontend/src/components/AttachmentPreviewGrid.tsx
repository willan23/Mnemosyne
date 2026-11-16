import React, { useState, useMemo, useEffect, useRef } from 'react';
import { FileText, Mic, Folder, FolderOpen, ChevronDown, ChevronRight, Search, Code, Image as ImageIcon, Film, LayoutGrid, FolderTree, ExternalLink, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Attachment } from '../types/attachments';
import { formatFileSize } from '../utils/storage';
import { resolveAttachments, resolveAttachmentDownload, type AttachmentAccessResource, type ResolvedAttachment } from '../services/attachmentAccess';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from '../services/memoryCrypto';
import { onTeamKeyChanged } from '../services/teamVault';
import { downloadAttachmentFile } from '../utils/export';
import { useTranslation } from '../utils/translations';
import { ImageLightbox } from './ImageLightbox';

interface AttachmentPreviewGridProps {
  attachments?: Attachment[];
  compact?: boolean;
  limit?: number;
  sessionId?: string;
}

interface OrganizedFolderGroup {
  folderName: string;
  files: ResolvedAttachment[];
}

function getFileCategory(attachment: Attachment): 'image' | 'audio' | 'video' | 'code' | 'document' {
  if (attachment.type === 'image') return 'image';
  if (attachment.type === 'audio') return 'audio';
  if (attachment.type === 'video') return 'video';
  const name = attachment.name.toLowerCase();
  if (name.match(/\.(js|ts|tsx|jsx|html|css|py|cpp|h|java|json|rs|go|sh|yml|yaml|sql|md)$/)) {
    return 'code';
  }
  return 'document';
}

function getFileIcon(category: ReturnType<typeof getFileCategory>) {
  switch (category) {
    case 'image': return <ImageIcon className="h-4 w-4 text-emerald-300" />;
    case 'audio': return <Mic className="h-4 w-4 text-indigo-300" />;
    case 'video': return <Film className="h-4 w-4 text-fuchsia-300" />;
    case 'code': return <Code className="h-4 w-4 text-amber-300" />;
    default: return <FileText className="h-4 w-4 text-cyan-300" />;
  }
}

export const AttachmentPreviewGrid: React.FC<AttachmentPreviewGridProps> = ({
  attachments = [],
  compact = false,
  limit,
  sessionId,
}) => {
  const { t } = useTranslation();
  const [filterQuery, setFilterQuery] = useState('');
  const [viewMode, setViewMode] = useState<'folder' | 'grid'>(() => {
    const onlyImages = attachments.length > 0 && attachments.every((a) => a.type === 'image');
    return onlyImages || attachments.length <= 3 ? 'grid' : 'folder';
  });
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [uid, setUid] = useState(() => auth.currentUser?.uid ?? null);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [cryptoReady, setCryptoReady] = useState(isMemoryCryptoReady);
  const [result, setResult] = useState<{ source: Attachment[]; sessionId?: string; uid: string | null; items: ResolvedAttachment[] } | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const currentView = useRef({ attachments, sessionId, uid, authEpoch }); currentView.current = { attachments, sessionId, uid, authEpoch };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let initial = true;
    return onAuthStateChanged(auth, user => {
      setUid(user?.uid ?? null); setResult(null); setLightboxSrc(null);
      if (!initial) setAuthEpoch(epoch => epoch + 1);
      initial = false;
    });
  }, []);
  useEffect(() => onMemoryCryptoChanged(() => {
    setCryptoReady(isMemoryCryptoReady()); setAuthEpoch(epoch => epoch + 1); setResult(null); setLightboxSrc(null);
  }), []);
  useEffect(() => {
    const changed = () => { setAuthEpoch(epoch => epoch + 1); setResult(null); setLightboxSrc(null); };
    const stopTeam = onTeamKeyChanged(changed); window.addEventListener('mnemosyne:local-ai-config', changed); window.addEventListener('storage', changed);
    return () => { stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', changed); window.removeEventListener('storage', changed); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let retained: ResolvedAttachment[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResult(null); setLightboxSrc(null);
    const refresh = async () => {
      if (!uid || !cryptoReady) return;
      const next = await resolveAttachments(attachments, { sessionId });
      if (cancelled || (auth.currentUser?.uid ?? null) !== uid) { next.forEach(item => item.release?.()); return; }
      retained.forEach(item => item.release?.()); retained = next;
      setResult({ source: attachments, sessionId, uid, items: next });
      const expiry = Math.min(...next.map(item => item.readExpiresAt ?? Infinity));
      if (Number.isFinite(expiry)) timer = setTimeout(() => { setResult(null); setLightboxSrc(null); void refresh(); }, Math.max(1000, expiry - Date.now() - 10_000));
    };
    void refresh();
    return () => {
      cancelled = true; clearTimeout(timer); retained.forEach(item => item.release?.());
    };
  }, [attachments, sessionId, uid, authEpoch, cryptoReady]);
  const resolved = result?.source === attachments && result.sessionId === sessionId && result.uid === uid ? result.items : [];

  const handleDownload = async (attachment: ResolvedAttachment) => {
    const view = currentView.current;
    const valid = () => mounted.current && currentView.current.attachments === view.attachments &&
      currentView.current.sessionId === view.sessionId && currentView.current.uid === view.uid && currentView.current.authEpoch === view.authEpoch &&
      (auth.currentUser?.uid ?? null) === uid && isMemoryCryptoReady();
    const key = `${attachment.url}:${attachment.name}`;
    setDownloadingKey(key);
    let access: AttachmentAccessResource | undefined;
    try {
      access = await resolveAttachmentDownload(attachment.readSourceUrl, { sessionId });
      if (!valid()) return;
      await downloadAttachmentFile(access.url, access.metadata?.name || attachment.name || 'anexo', { guard: valid });
      if (valid()) toast.success('Ficheiro descarregado');
    } catch {
      if (valid()) toast.error('Não foi possível descarregar.');
    } finally {
      access?.release?.();
      if (valid()) setDownloadingKey(null);
    }
  };

  const openImage = (url: string) => {
    if (!url) return;
    setLightboxSrc(url);
  };

  const visibleAttachments = typeof limit === 'number' ? resolved.slice(0, limit) : resolved;
  const hiddenCount = Math.max(0, resolved.length - visibleAttachments.length);

  const filteredAttachments = useMemo(() => {
    if (!filterQuery.trim()) return visibleAttachments;
    const q = filterQuery.toLowerCase();
    return visibleAttachments.filter((att) => att.name.toLowerCase().includes(q));
  }, [visibleAttachments, filterQuery]);

  const folderGroups = useMemo(() => {
    const map = new Map<string, ResolvedAttachment[]>();
    for (const att of filteredAttachments) {
      const parts = att.name.replace(/\\/g, '/').split('/');
      let folderName = t('attachFolderDocuments');
      if (parts.length > 1) {
        folderName = parts.slice(0, parts.length - 1).join('/');
      } else {
        const cat = getFileCategory(att);
        if (cat === 'code') folderName = t('attachFolderCode');
        else if (cat === 'image') folderName = t('attachFolderImages');
        else if (cat === 'audio') folderName = t('attachFolderAudio');
        else if (cat === 'video') folderName = t('attachFolderVideo');
      }
      const existing = map.get(folderName) || [];
      existing.push(att);
      map.set(folderName, existing);
    }
    const result: OrganizedFolderGroup[] = [];
    map.forEach((files, folderName) => {
      result.push({ folderName, files });
    });
    return result.sort((a, b) => a.folderName.localeCompare(b.folderName));
  }, [filteredAttachments, t]);

  if (attachments.length === 0) return null;

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderName]: prev[folderName] === undefined ? false : !prev[folderName],
    }));
  };

  const isFolderExpanded = (folderName: string) => expandedFolders[folderName] !== false;

  return (
    <div className="space-y-3">
      {(!result || resolved.length < attachments.length) && (
        <div role="status" className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
          <p>{!result && uid && cryptoReady ? t('attachmentAccessPending') : t('attachmentAccessUnavailable')}</p>
          <button type="button" disabled={!uid || !cryptoReady} onClick={() => setAuthEpoch(epoch => epoch + 1)}
            className="mt-2 rounded border border-white/20 px-2 py-1 disabled:opacity-50">{t('attachmentAccessRetry')}</button>
        </div>
      )}
      {/* Header controls for multi-document view */}
      {attachments.length > 3 && !compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 p-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-white/80">
            <FolderTree className="h-3.5 w-3.5 text-cyan-300" />
            <span className="font-semibold">{t('attachFilesCount', { count: attachments.length })}</span>
            <span className="text-[10px] text-white/40">({t('attachFoldersCount', { count: folderGroups.length })})</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick search input */}
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-white/80">
              <Search className="h-3 w-3 text-white/40" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filtrar ficheiros…"
                className="w-24 bg-transparent text-[11px] text-white outline-none placeholder:text-white/30 sm:w-32"
              />
            </div>

            {/* View mode toggle */}
            <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('folder')}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition ${
                  viewMode === 'folder' ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/40 hover:text-white/70'
                }`}
                title="Vista Organizada por Pastas"
              >
                <FolderTree className="h-3 w-3" /> Pastas
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition ${
                  viewMode === 'grid' ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/40 hover:text-white/70'
                }`}
                title="Vista em Grelha Compacta"
              >
                <LayoutGrid className="h-3 w-3" /> Grelha
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Organized Folder Tree View */}
      {viewMode === 'folder' && !compact ? (
        <div className="space-y-2.5">
          {folderGroups.map((group) => {
            const expanded = isFolderExpanded(group.folderName);
            return (
              <div
                key={group.folderName}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-white/15"
              >
                {/* Folder Header */}
                <button
                  type="button"
                  onClick={() => toggleFolder(group.folderName)}
                  className="flex w-full items-center justify-between gap-2 border-b border-white/5 bg-white/[0.04] px-3.5 py-2.5 text-left text-xs text-white/90 transition hover:bg-white/[0.07]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {expanded ? (
                      <FolderOpen className="h-4 w-4 shrink-0 text-cyan-300" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-cyan-400/70" />
                    )}
                    <span className="font-semibold truncate text-white/90">{group.folderName}</span>
                    <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200">
                      {group.files.length} documento{group.files.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-white/40" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/40" />
                  )}
                </button>

                {/* Folder Content Files */}
                {expanded && (
                  <div className="divide-y divide-white/5 p-1.5">
                    {group.files.map((attachment, index) => {
                      const cat = getFileCategory(attachment);
                      const fileNameOnly = attachment.name.replace(/\\/g, '/').split('/').pop() || attachment.name;
                      return (
                        <div
                          key={`${attachment.url}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs transition hover:bg-white/[0.05]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {getFileIcon(cat)}
                            <div className="flex flex-col min-w-0">
                              <span className="truncate font-medium text-white/85" title={attachment.name}>
                                {fileNameOnly}
                              </span>
                              {attachment.name.includes('/') && (
                                <span className="truncate text-[10px] text-white/40">{attachment.name}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 text-[11px] text-white/45">
                            {attachment.size ? <span>{formatFileSize(attachment.size)}</span> : null}
                            {cat === 'image' && (
                              <button
                                type="button"
                                onClick={() => openImage(attachment.url)}
                                className="flex items-center gap-1 rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-cyan-100 transition hover:bg-cyan-400/20"
                                title="Ver imagem"
                              >
                                <ImageIcon className="h-3 w-3" />
                                <span className="hidden sm:inline">Ver</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDownload(attachment)}
                              disabled={downloadingKey === `${attachment.url}:${attachment.name}`}
                              className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-cyan-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/15 disabled:opacity-50"
                              title="Descarregar"
                            >
                              <Download className="h-3 w-3" />
                              <span className="hidden sm:inline">Descarregar</span>
                            </button>
                            <a
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white/70 transition hover:border-white/25 hover:bg-white/10"
                              title={t('attachOpen')}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Flat Grid View */
        <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {filteredAttachments.map((attachment, index) => {
            const cat = getFileCategory(attachment);
            return (
              <div
                key={`${attachment.url}-${index}`}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]"
              >
                {attachment.type === 'image' ? (
                  <button
                    type="button"
                    onClick={() => openImage(attachment.url)}
                    className="block w-full text-left"
                    title="Ver imagem"
                  >
                    <img
                      src={attachment.url}
                      alt={attachment.name}
                      loading="lazy"
                      className={`w-full object-cover transition hover:opacity-95 ${compact ? 'h-28' : 'h-48'}`}
                    />
                  </button>
                ) : attachment.type === 'audio' ? (
                  <div className={`flex flex-col items-center justify-center gap-2 bg-white/[0.03] p-3 ${compact ? 'h-24' : 'h-28'}`}>
                    <Mic className="h-5 w-5 text-indigo-300" />
                    <audio src={attachment.url} controls className="w-full" />
                  </div>
                ) : attachment.type === 'video' ? (
                  <video
                    src={attachment.url}
                    controls
                    className={`w-full bg-black/30 object-cover ${compact ? 'h-24' : 'h-36'}`}
                  />
                ) : (
                  <div
                    className={`flex flex-col items-center justify-center gap-2 bg-white/[0.03] p-3 ${compact ? 'h-24' : 'h-28'}`}
                  >
                    {getFileIcon(cat)}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDownload(attachment)}
                        disabled={downloadingKey === `${attachment.url}:${attachment.name}`}
                        className="inline-flex items-center gap-1 rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-50"
                      >
                        <Download className="h-3 w-3" />
                        Descarregar
                      </button>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 transition hover:bg-white/10"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Abrir
                      </a>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-white/45">
                  <span className="truncate" title={attachment.name}>{attachment.name}</span>
                  {attachment.size ? <span className="shrink-0">{formatFileSize(attachment.size)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 text-center text-xs text-white/55">
          +{hiddenCount} documento{hiddenCount === 1 ? '' : 's'} adicionai{hiddenCount === 1 ? 's' : 's'}
        </div>
      )}

      {lightboxSrc && resolved.some(item => item.url === lightboxSrc) && (
        <ImageLightbox
          src={lightboxSrc}
          alt="Anexo de imagem"
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </div>
  );
};
