import type {SyncOutboxResult} from './mobileSyncOutbox';
export function syncOutboxMessage(result:SyncOutboxResult):string {
  switch(result.delivery){
    case 'unchanged':return 'Não há alterações novas para sincronizar.';
    case 'queued':return 'Envio cifrado publicado. Aguarda importação no outro dispositivo.';
    case 'pending':return 'A importação já começou. Retoma-a no outro dispositivo antes de preparar novo envio.';
    case 'complete':return `${result.imported} alteração(ões) confirmada(s); ${result.conflicts} conflito(s) conservado(s).`;
    case 'cancelled':return 'Envio cancelado antes da importação. Podes preparar outro envio.';
    case 'expired':return 'O envio expirou antes da importação. Cancela-o para preparar outro envio.';
    case 'unavailable':return 'Não foi possível confirmar os dados deste envio. Conservámos a recuperação local.';
    default:return 'O envio aguarda confirmação.';
  }
}
