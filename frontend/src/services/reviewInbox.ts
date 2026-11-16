export {loadReviewInbox, saveReviewInbox, previewLegacyReviewInbox, previewReviewInboxLegacyOrigin, migrateLegacyReviewInbox, observeReviewInbox,
  exportReviewInboxBackup, prepareReviewInboxBackup, prepareRepeatedReviewInboxBackup, restoreReviewInboxBackup,
  REVIEW_INBOX_BACKUP_MAX_BYTES, type ReviewInboxBackupPreview, type ReviewInboxBackupSource, type ReviewInboxView, type LegacyReviewPreview} from './reviewInboxPersistence';

export interface ReviewItem {
  id: string;
  sourceId: string;
  question: string;
  priority: 1 | 2 | 3;
  dueAt: number;
  intervalDays: number;
  completedCount: number;
  createdAt: number;
  updatedAt: number;
}

const DAY_MS = 86_400_000;

export function createReviewItem(sourceId: string, question: string, priority: 1 | 2 | 3,
  now = Date.now()): ReviewItem {
  if (!sourceId || sourceId.length > 1500 || sourceId.includes('/') || !question.trim() || question.length > 500 || ![1, 2, 3].includes(priority) || !Number.isFinite(now) || Math.abs(now) > 8.64e15) {
    throw new Error('A pergunta de revisão deve ter entre 1 e 500 caracteres.');
  }
  return {
    id: crypto.randomUUID(), sourceId, question: question.trim(), priority,
    dueAt: now, intervalDays: 0, completedCount: 0, createdAt: now, updatedAt: now,
  };
}

export function advanceReview(item: ReviewItem, result: 'again' | 'good' | 'easy',
  now = Date.now()): ReviewItem {
  if (!['again', 'good', 'easy'].includes(result) || !Number.isFinite(now) || Math.abs(now) > 8.64e15 || !Number.isSafeInteger(item.completedCount + 1)) throw Error('Revisão inválida.');
  const intervalDays = result === 'again' ? 0 :
    item.intervalDays === 0 ? result === 'easy' ? 3 : 1 :
      Math.min(365, Math.max(1, Math.round(item.intervalDays * (result === 'easy' ? 2.5 : 1.8))));
  return {
    ...item, intervalDays, completedCount: item.completedCount + 1,
    dueAt: now + (intervalDays === 0 ? 10 * 60_000 : intervalDays * DAY_MS), updatedAt: now,
  };
}

