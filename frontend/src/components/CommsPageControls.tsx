import type {CommsPageProgress,CommsPageController} from '../services/commsLists';
export function CommsPageControls({label,state,controller}:{label:string;state?:CommsPageProgress;controller?:CommsPageController}){
  if(!state)return null;
  return <section aria-label={`Páginas ${label}`} className="my-2 space-y-2 text-xs text-white/70">
    <div className="flex flex-wrap items-center gap-2"><span>Página {state.page} · {label}</span><button type="button" disabled={state.busy||!state.previous} onClick={()=>controller?.previous()} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button><button type="button" disabled={state.busy||!state.next} onClick={()=>controller?.next()} className="rounded border px-3 py-2 disabled:opacity-40">Seguinte</button><button type="button" disabled={state.busy} onClick={()=>controller?.refresh()} className="rounded border px-3 py-2 disabled:opacity-40">Atualizar</button></div>
    {state.busy&&<p role="status">A carregar página…</p>}{state.error&&<p role="alert">Não foi possível confirmar esta página. Tenta atualizar.</p>}{state.unavailable>0&&<p role="status">{state.unavailable} registo(s) desta página estão indisponíveis.</p>}
  </section>;
}
