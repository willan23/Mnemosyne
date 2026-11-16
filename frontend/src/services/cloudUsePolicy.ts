import { getLocalAiConfig, type MemoryPermission } from './localAiConfig';

export type CloudPurpose = 'text-generation' | 'image-generation' | 'web-research' | 'extraction' | 'media-analysis' | 'attachment-storage';
export type CloudDecision = 'allow' | 'deny' | 'require-confirmation';

export interface CloudPayloadSummary {
  bytes: number;
  containsMemory: boolean;
  containsAttachment: boolean;
  containsPrompt: boolean;
}

export interface CloudUseRequest {
  purpose: CloudPurpose;
  provider: string;
  payloadSummary: CloudPayloadSummary;
  policy: MemoryPermission;
  /** Applies only to this provider's inference, not application hosting/storage. */
  providerInferenceCostUsd?: 0;
}

export function decideCloudUse(request: CloudUseRequest): CloudDecision {
  if (request.policy === 'confirm-cloud') return 'require-confirmation';
  if (request.policy === 'allow-cloud') return 'allow';
  return 'deny';
}

const purposeLabels: Record<CloudPurpose, string> = {
  'text-generation': 'geração de texto',
  'image-generation': 'geração de imagem',
  'web-research': 'pesquisa web',
  extraction: 'extração',
  'media-analysis': 'análise multimédia',
  'attachment-storage': 'armazenamento cifrado de anexos',
};

function consentMessage(request: CloudUseRequest): string {
  const categories = [
    request.payloadSummary.containsMemory && 'memórias',
    request.payloadSummary.containsAttachment && 'anexos',
    request.payloadSummary.containsPrompt && 'prompt ou pesquisa',
  ].filter(Boolean).join(', ') || 'metadados da operação';
  return `Enviar dados para ${request.provider} para ${purposeLabels[request.purpose]}?\n\n` +
    `Categorias: ${categories}. Tamanho aproximado: ${request.payloadSummary.bytes} bytes.\n` +
    (request.providerInferenceCostUsd === 0 ? 'Preço de inferência do fornecedor: 0 USD (modelo gratuito). O prazo de retenção não está disponível nesta operação. ' :
      'Custo e prazo de retenção do fornecedor não estão disponíveis nesta operação. ') +
    'Confirma apenas se aceitas esse processamento externo.';
}

/** The event has metadata only; payload text and keys must never enter telemetry. */
export function authorizeCloudUse(
  request: CloudUseRequest,
  confirmUse: (message: string) => boolean = (message) => typeof window !== 'undefined' && window.confirm(message),
): void {
  const decision = decideCloudUse(request);
  const allowed = decision === 'allow' || (decision === 'require-confirmation' && confirmUse(consentMessage(request)));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mnemosyne:cloud-use', {
      detail: {
        purpose: request.purpose,
        provider: request.provider,
        bytes: request.payloadSummary.bytes,
        policy: request.policy,
        allowed,
        at: Date.now(),
      },
    }));
  }
  if (!allowed) {
    throw new Error(decision === 'deny'
      ? 'A política de privacidade impede enviar dados para a cloud. Seleciona processamento local ou altera a permissão nas Definições.'
      : 'Operação externa cancelada pelo utilizador.');
  }
}

export function guardCloudUse(
  purpose: CloudPurpose,
  provider: string,
  payloadSummary: CloudPayloadSummary,
  providerInferenceCostUsd?: 0,
): void {
  authorizeCloudUse({ purpose, provider, payloadSummary, policy: getLocalAiConfig().memoryPermission, providerInferenceCostUsd });
}

export function approximateBytes(...values: string[]): number {
  return new TextEncoder().encode(values.join('')).length;
}

export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}
