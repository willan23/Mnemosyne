import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIP_MAX_QUERY_BYTES,
  PENDING_CLIP_KEY,
  buildClipperLandingUrl,
  clipMemoryTitle,
  consumePendingClip,
  formatClipMemoryText,
  parseClipFromSearch,
  parseClipFromHash,
  ingestClipFromLocation,
  clipIngressFailed,
  verifyClipIngressBootstrap,
  parseClipPayload,
  sanitizeClipField,
  sanitizeClipUrl,
  stripHtml,
  truncateClipToQueryBudget,
  writePendingClip,
} from './clipCapture';

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  delete (window as Window & {__mnemosyneClipIngressFailed?: boolean}).__mnemosyneClipIngressFailed;
  try {
    sessionStorage.removeItem(PENDING_CLIP_KEY);
  } catch {
    // ignore
  }
});

describe('clipCapture · sanitize', () => {
  it('remove HTML e scripts, deixando texto simples', () => {
    expect(stripHtml('<p>Olá <b>mundo</b></p>')).toBe('Olá mundo');
    expect(stripHtml('<script>alert(1)</script>nota')).toBe('nota');
    expect(stripHtml('a\n\tb   c')).toBe('a b c');
  });

  it('decodifica entidades sem reintroduzir markup executável', () => {
    expect(stripHtml('A &amp; B &lt; C')).toBe('A & B < C');
    expect(sanitizeClipField('<img src=x onerror=alert(1)>foto', 80)).toBe('foto');
  });

  it('trunca campos longos com reticências', () => {
    const long = 'x'.repeat(50);
    expect(sanitizeClipField(long, 10)).toBe(`${'x'.repeat(9)}…`);
    expect(sanitizeClipField(long, 10).length).toBe(10);
  });

  it('só aceita URLs http(s) e rejeita javascript/data', () => {
    expect(sanitizeClipUrl('https://example.com/a?q=1')).toBe('https://example.com/a?q=1');
    expect(sanitizeClipUrl('http://localhost:5173/x')).toContain('http://localhost:5173/x');
    expect(sanitizeClipUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeClipUrl('data:text/html,hi')).toBe('');
    expect(sanitizeClipUrl('ftp://files.example')).toBe('');
    expect(sanitizeClipUrl('<https://evil.example>')).toBe('');
  });
});

describe('clipCapture · parse e orçamento', () => {
  it('lê title/url/text da query e ignora clip vazio', () => {
    const clip = parseClipFromSearch(
      '?title=Artigo&url=https%3A%2F%2Fmnemosyne.example%2Fpost&text=parágrafo',
    );
    expect(clip).toEqual({
      title: 'Artigo',
      url: 'https://mnemosyne.example/post',
      text: 'parágrafo',
    });
    expect(parseClipFromSearch('')).toBeNull();
    expect(parseClipFromSearch('?title=&text=')).toBeNull();
  });

  it('aceita selection como alias de text', () => {
    expect(parseClipFromSearch('?selection=citação')).toEqual({
      title: '',
      url: '',
      text: 'citação',
    });
  });

  it('parseClipPayload rejeita objectos vazios e sanitiza HTML', () => {
    expect(parseClipPayload(null)).toBeNull();
    expect(parseClipPayload({ title: '<b>T</b>', url: 'https://ok.example', text: '<i>x</i>' })).toEqual({
      title: 'T',
      url: 'https://ok.example/',
      text: 'x',
    });
  });

  it('trunca a query para caber em ~1.5 KB UTF-8', () => {
    const huge = {
      title: 'Título '.repeat(40),
      url: 'https://example.com/path/that/is/fine',
      text: 'palavra '.repeat(400),
    };
    const trimmed = truncateClipToQueryBudget(huge);
    const query = new URLSearchParams({
      title: trimmed.title,
      url: trimmed.url,
      text: trimmed.text,
    }).toString();
    expect(new TextEncoder().encode(query).length).toBeLessThanOrEqual(CLIP_MAX_QUERY_BYTES);
    expect(trimmed.url).toContain('example.com');
    expect(trimmed.text.endsWith('…') || trimmed.text.length < huge.text.length).toBe(true);
  });

  it('buildClipperLandingUrl usa apenas fragmento versionado e sanitizado', () => {
    const url = buildClipperLandingUrl({
      title: '<b>Hello</b>',
      url: 'https://docs.example/a',
      text: 'sel',
    });
    expect(url.startsWith('https://mnemosyne-one.web.app/clipper.html#mnemosyne-clip=v1&')).toBe(true);
    expect(new URL(url).search).toBe('');
    expect(parseClipFromHash(new URL(url).hash)).toEqual({title: 'Hello', url: 'https://docs.example/a', text: 'sel'});
    expect(url).not.toContain('<b>');
    expect(url).toContain('Hello');
    expect(url).toContain('docs.example');
  });
});

describe('clipCapture · ingresso privado', () => {
  it('preserva Unicode dentro do orçamento incluindo o prefixo', () => {
    const hash = new URL(buildClipperLandingUrl({title: 'Título 😀', text: 'citação 😀 '.repeat(200), url: 'https://example.test/'})).hash;
    expect(new TextEncoder().encode(hash).length).toBeLessThanOrEqual(CLIP_MAX_QUERY_BYTES);
    expect(parseClipFromHash(hash)?.title).toBe('Título 😀');
  });
  it('recusa versões, campos, repetições, codificação e tamanhos inválidos', () => {
    for (const hash of ['#mnemosyne-clip=v2&text=x', '#mnemosyne-clip=v1&text=x&text=y', '#mnemosyne-clip=v1&ownerUid=alice&text=x', '#mnemosyne-clip=v1&text=%FF', '#mnemosyne-clip=v1&text=%', '#mnemosyne-clip=v1&', '#mnemosyne-clip=v1&text=' + 'x'.repeat(1500), '#access_token=synthetic']) expect(parseClipFromHash(hash)).toBeNull();
    for (const query of ['?text=x&text=y', '?text=x&selection=y', '?text=%FF', '?text=' + 'x'.repeat(1500)]) expect(parseClipFromSearch(query)).toBeNull();
  });
  it('limpa fragmento e query antiga antes de guardar, preserva parâmetros e hashes alheios', () => {
    history.replaceState({synthetic: true}, '', '/clip?campaign=local#mnemosyne-clip=v1&text=cita%C3%A7%C3%A3o');
    expect(ingestClipFromLocation()?.text).toBe('citação');
    expect(location.pathname + location.search + location.hash).toBe('/?campaign=local');
    expect(history.state).toEqual({synthetic: true}); expect(clipIngressFailed()).toBe(false);
    sessionStorage.clear(); history.replaceState(null, '', '/clip?text=antigo&campaign=local#auth');
    expect(ingestClipFromLocation()?.text).toBe('antigo'); expect(location.search + location.hash).toBe('?campaign=local#auth');
  });
  it('limpa a URL e sinaliza erro se armazenamento falhar ou recusar readback', () => {
    for (const mode of ['throw', 'silent']) {
      sessionStorage.clear(); history.replaceState(null, '', '/clip#mnemosyne-clip=v1&text=synthetic');
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {if (mode === 'throw') throw Error('Synthetic storage refusal');});
      expect(ingestClipFromLocation()).toBeNull(); expect(location.hash).toBe(''); expect(clipIngressFailed()).toBe(true);
      vi.restoreAllMocks();
    }
  });
  it('não substitui a fila de outra conta nem aceita entradas ambíguas', () => {
    const clip = {title: 'Previous', text: 'Synthetic previous', url: ''}; writePendingClip(clip, 'bob');
    const previous = sessionStorage.getItem(PENDING_CLIP_KEY);
    history.replaceState(null, '', '/clip#mnemosyne-clip=v1&text=new');
    expect(ingestClipFromLocation()).toBeNull(); expect(sessionStorage.getItem(PENDING_CLIP_KEY)).toBe(previous); expect(clipIngressFailed()).toBe(true);
    sessionStorage.clear(); history.replaceState(null, '', '/clip?text=old#mnemosyne-clip=v1&text=new');
    expect(ingestClipFromLocation()).toBeNull(); expect(location.search + location.hash).toBe('');
  });
  it('não trata fragmentos de outros fluxos como clips', () => {
    history.replaceState(null, '', '/login?campaign=local#access_token=synthetic');
    expect(ingestClipFromLocation()).toBeNull(); expect(clipIngressFailed()).toBe(false);
    expect(location.pathname + location.search + location.hash).toBe('/login?campaign=local#access_token=synthetic');
  });
  it('recusa captura sem o bootstrap e limpa a entrada mesmo no fallback da SPA', () => {
    history.replaceState(null, '', '/clip#mnemosyne-clip=v1&text=synthetic');
    verifyClipIngressBootstrap(); expect(clipIngressFailed()).toBe(true); expect(location.pathname).toBe('/'); expect(location.hash).toBe('');
    expect(consumePendingClip()?.text).toBe('synthetic');
  });
});

describe('clipCapture · memória e sessionStorage', () => {
  it('formata texto de memória sem HTML', () => {
    expect(
      formatClipMemoryText({
        title: 'Notas',
        url: 'https://example.com/n',
        text: 'corpo',
      }),
    ).toBe('Notas\nhttps://example.com/n\n\ncorpo');
    expect(clipMemoryTitle({ title: '', url: 'https://www.example.com/x', text: '' })).toBe('example.com');
    expect(clipMemoryTitle({ title: '', url: '', text: 'só texto' })).toBe('Clip web');
  });

  it('consome o clip pendente uma vez', () => {
    writePendingClip({ title: 'A', url: 'https://a.example', text: 'b' });
    const first = consumePendingClip();
    const second = consumePendingClip();
    expect(first?.title).toBe('A');
    expect(second).toBeNull();
  });

  it('retém a fila ligada à conta e recusa outra conta ou consumo sem dono', () => {
    const clip = {title: 'Synthetic', url: 'https://example.test/', text: 'Synthetic clip'};
    writePendingClip(clip, 'alice');
    expect(consumePendingClip('bob')).toBeNull(); expect(consumePendingClip()).toBeNull();
    expect(consumePendingClip('alice')).toEqual(clip); expect(consumePendingClip('alice')).toBeNull();
  });

  it('recusa marcadores de dono malformados sem reatribuir o clip', () => {
    for (const ownerUid of [null, [], 7, '', 'a/b']) {
      sessionStorage.setItem(PENDING_CLIP_KEY, JSON.stringify({title: 'Synthetic', text: 'Synthetic clip', url: '', ownerUid}));
      expect(consumePendingClip('alice')).toBeNull();
    }
  });
});
