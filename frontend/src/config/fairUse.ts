/**
 * Limites técnicos / fair-use (independentes de paywall comercial).
 * Protegem infraestrutura Firebase e UX em Free-first.
 */

export const FAIR_USE = {
  /** Tamanho máximo por ficheiro de anexo (MB) */
  maxAttachmentMB: 25,
  /** Máximo de anexos por memória */
  maxAttachmentsPerMemory: 12,
  /** Máximo de ficheiros por lote de importação */
  maxImportBatchFiles: 20,
  /** Retenção de links de cápsula cifrada (dias) — default */
  shareLinkDefaultDays: 7,
  /** Máximo de dias para link de cápsula */
  shareLinkMaxDays: 30,
  /** Idle em ms antes de limpar mnemónica da sessão (45 min) */
  mnemonicIdleMs: 45 * 60 * 1000,
  /** Aviso de idle (5 min antes) */
  mnemonicIdleWarnMs: 5 * 60 * 1000,
  /** Rate limit client-side: pedidos web research por hora */
  webResearchPerHour: 30,
} as const;

export function formatFairUseMb(mb: number): string {
  return `${mb} MB`;
}
