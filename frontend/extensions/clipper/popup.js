const APP_ORIGIN = 'https://mnemosyne-one.web.app';
const LANDING_PATH = '/clipper.html';
const MAX_QUERY_BYTES = 1500;
const FRAGMENT_PREFIX = '#mnemosyne-clip=v1&';
const MAX_TITLE = 180;
const MAX_TEXT = 1200;
const MAX_URL = 500;

function utf8Bytes(value) {
  return new TextEncoder().encode(value).length;
}

function stripHtml(input) {
  return String(input || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateChars(value, max) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function sanitizeUrl(raw) {
  const cleaned = stripHtml(raw);
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const href = url.toString();
    return href.length > MAX_URL ? href.slice(0, MAX_URL) : href;
  } catch {
    return '';
  }
}

function encodeQuery(clip) {
  const params = new URLSearchParams();
  if (clip.title) params.set('title', clip.title);
  if (clip.url) params.set('url', clip.url);
  if (clip.text) params.set('text', clip.text);
  return params.toString();
}

function shrink(value, step) {
  if (value.length <= 1) return '';
  return `${value.slice(0, Math.max(0, value.length - step)).replace(/…$/, '').trimEnd()}…`;
}

function fitBudget(clip) {
  let title = clip.title;
  let url = clip.url;
  let text = clip.text;
  const encoded = () => encodeQuery({ title, url, text });
  while (utf8Bytes(FRAGMENT_PREFIX + encoded()) > MAX_QUERY_BYTES && text.length) text = shrink(text, 24);
  while (utf8Bytes(FRAGMENT_PREFIX + encoded()) > MAX_QUERY_BYTES && title.length) title = shrink(title, 12);
  while (utf8Bytes(FRAGMENT_PREFIX + encoded()) > MAX_QUERY_BYTES && url.length) url = url.slice(0, Math.max(0, url.length - 24));
  return { title, url, text };
}

async function readSelection(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection && window.getSelection().toString()) || '',
    });
    return typeof result === 'string' ? result : '';
  } catch {
    return '';
  }
}

function fillForm(clip) {
  document.getElementById('title').value = clip.title;
  document.getElementById('url').value = clip.url;
  document.getElementById('text').value = clip.text;
}

function readForm() {
  return fitBudget({
    title: truncateChars(stripHtml(document.getElementById('title').value), MAX_TITLE),
    url: sanitizeUrl(document.getElementById('url').value),
    text: truncateChars(stripHtml(document.getElementById('text').value), MAX_TEXT),
  });
}

const CLIPPER_I18N = {
  'pt-pt': {
    title: 'Capturar recorte',
    labelTitle: 'Título',
    labelUrl: 'URL',
    labelText: 'Seleção',
    send: 'Enviar para o Mnemosyne',
    hint: 'Abre a web app. A cifra E2EE só acontece depois de desbloqueares a sessão — a extensão nunca vê a mnemónica. Recorte local limitado a ~1.5 KB.',
  },
  'pt-br': {
    title: 'Capturar recorte',
    labelTitle: 'Título',
    labelUrl: 'URL',
    labelText: 'Seleção',
    send: 'Enviar para o Mnemosyne',
    hint: 'Abre o web app. A cifra E2EE só acontece depois de desbloquear a sessão — a extensão nunca vê a mnemónica. Recorte local limitado a ~1.5 KB.',
  },
  en: {
    title: 'Capture clip',
    labelTitle: 'Title',
    labelUrl: 'URL',
    labelText: 'Selection',
    send: 'Send to Mnemosyne',
    hint: 'Opens the web app. E2EE encryption only happens after you unlock the session — the extension never sees the mnemonic. Local clip limited to ~1.5 KB.',
  },
  fr: {
    title: 'Capturer un extrait',
    labelTitle: 'Titre',
    labelUrl: 'URL',
    labelText: 'Sélection',
    send: 'Envoyer vers Mnemosyne',
    hint: 'Ouvre l’app web. Le chiffrement E2EE n’a lieu qu’après déverrouillage de la session — l’extension ne voit jamais la mnémotechnique. Extrait local limité à ~1,5 Ko.',
  },
};

function clipperLocale() {
  const nav = String(navigator.language || 'en').toLowerCase();
  if (nav.startsWith('pt-br')) return 'pt-br';
  if (nav.startsWith('pt')) return 'pt-pt';
  if (nav.startsWith('fr')) return 'fr';
  return 'en';
}

function applyClipperI18n() {
  const locale = clipperLocale();
  const copy = CLIPPER_I18N[locale];
  const htmlLang = { 'pt-pt': 'pt-PT', 'pt-br': 'pt-BR', en: 'en', fr: 'fr' }[locale];
  document.documentElement.lang = htmlLang;
  const heading = document.querySelector('h1');
  const send = document.getElementById('send');
  const hint = document.querySelector('.hint');
  const titleLabel = document.querySelector('label[for="title"]');
  const urlLabel = document.querySelector('label[for="url"]');
  const textLabel = document.querySelector('label[for="text"]');
  if (heading) heading.textContent = copy.title;
  if (titleLabel) titleLabel.textContent = copy.labelTitle;
  if (urlLabel) urlLabel.textContent = copy.labelUrl;
  if (textLabel) textLabel.textContent = copy.labelText;
  if (send) send.textContent = copy.send;
  if (hint) hint.textContent = copy.hint;
}

document.getElementById('clip-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const clip = readForm();
  if (!clip.title && !clip.url && !clip.text) return;
  const query = encodeQuery(clip);
  const target = `${APP_ORIGIN}${LANDING_PATH}${query ? `${FRAGMENT_PREFIX}${query}` : ''}`;
  chrome.tabs.create({ url: target });
  window.close();
});

(async function init() {
  applyClipperI18n();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const selection = tab?.id ? await readSelection(tab.id) : '';
  fillForm(fitBudget({
    title: truncateChars(stripHtml(tab?.title || ''), MAX_TITLE),
    url: sanitizeUrl(tab?.url || ''),
    text: truncateChars(stripHtml(selection), MAX_TEXT),
  }));
})();
