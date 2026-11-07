/* PokéRadar · app web (PWA) para iPhone. Sin dependencias. */
'use strict';

// ── utilidades ──────────────────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const fold = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const store = {
  get(k, d) { try { const v = localStorage.getItem('pr:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pr:' + k, JSON.stringify(v)); } catch { /* modo privado */ } },
};
const money = (v, cur = 'EUR') => {
  if (v === null || v === undefined) return '';
  try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur || 'EUR' }).format(v); }
  catch { return `${v.toFixed(2)} ${cur}`; }
};
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const rtfShort = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' });
function agoShort(iso) {  // "hace 5 min" (para la cabecera)
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Number.isNaN(s)) return '';
  for (const [u, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(s) >= n) return rtfShort.format(Math.round(s / n), u);
  return 'ahora mismo';
}
function ago(iso) {
  if (!iso) return '';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Number.isNaN(s)) return '';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return 'ahora mismo';
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const TIER = {
  oficial: ['Oficial', 'accent'],
  gran_retailer: ['Gran tienda', 'info'],
  especializada: ['Especializada', 'ok'],
  noticias: ['Noticias', 'info'],
};
const CATS = [['sellado', 'Sellado'], ['accesorio', 'Accesorios'], ['carta suelta', 'Cartas sueltas'], ['todo', 'Todo']];
const EVENT = {
  new: ['🆕', 'Nuevo'], restock: ['🔁', 'Vuelve a stock'], price_drop: ['💸', 'Baja de precio'], news: ['📰', 'Noticia'],
  preorder: ['📅', 'Preventa'], preorder_open: ['🔓', 'Ya se puede reservar'], chollo: ['🔥', 'Chollo'],
};
// idioma de la edición (las tiendas de la UE que no lo indican venden la inglesa)
const LANGS = [['todos', 'Todos los idiomas'], ['es', '🇪🇸 Español'], ['en', '🇬🇧 Inglés'], ['asia', '🇯🇵 Japonés y Asia']];
const RX_ASIA = /japon|japan|giappon|jpn\b|\bjp\b|[(\[]ch[)\]]|corean|korean|\bkor\b|\bkr\b|chin[oaei]|chinese|cinese|\bchn\b|\bschn\b|simplified|\btc\b|\bsc\b/;
const RX_ES = /espanol|spanish|castellano|[(\[]esp?[)\]]|[-–]\s*esp?\s*$/;
const RX_EN = /ingles|english|\beng\b|[(\[]en[)\]]|[-–]\s*en\s*$|anglais|inglese|englisch/;
// otras ediciones europeas (italiana, francesa, alemana, portuguesa)
const RX_OTHER = /\bita\b|[(\[]ita?\b|italian|buste|collezione|mazzo|[(\[]fr[)\]]|francais|french|coffret|[(\[]de[)\]]|\bdeu\b|deutsch|\bgerman|portugu|[(\[]pt[)\]]/;
// en una tienda española, un título en español sin idioma indicado suele ser la edición española
const RX_ES_WORDS = /\b(lata|caja|sobres?|coleccion|celebracion|entrenador|mazo|aniversario|cartas)\b/;
function langOf(p) {
  const t = fold(p.title);
  if (RX_ASIA.test(t)) return 'asia';
  if (RX_ES.test(t)) return 'es';
  if (RX_EN.test(t)) return 'en';
  if (RX_OTHER.test(t)) return 'otro';
  if (countryOf(p.store) === 'ES') return RX_ES_WORDS.test(t) ? 'es' : '';
  return 'en';
}
const langOk = (p) => S.lang === 'todos' || langOf(p) === S.lang;
const MESES = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtSalida = (s) => { const p = String(s || '').split('-').map(Number); return p.length === 3 ? `${p[2]} ${MESES[p[1]]} ${p[0]}` : p.length === 2 ? `${MESES[p[1]]} ${p[0]}` : ''; };
const salidaPasada = (sal) => { const p = String(sal).split('-'); const end = p.length === 3 ? sal : `${sal}-31`; return end < new Date().toISOString().slice(0, 10); };
const salidaPill = (x) => (x && x.salida
  ? `<span class="pill info">📅 ${salidaPasada(x.salida) ? 'Salió' : 'Sale'} ${esc(fmtSalida(x.salida))}</span>` : '');
const isPre = (p) => !!(p.extra && p.extra.preventa);
const PAGE = 60;
// sinónimos habituales al buscar (español ↔ inglés)
const SYN = {
  etb: ['etb', 'elite trainer', 'entrenador elite', 'entrenador de elite', 'caja elite', 'dresseur d elite', 'dresseur delite', 'allenatore fuoriclasse', 'top trainer'],
  sobre: ['sobre', 'booster', 'pack', 'busta', 'buste'], sobres: ['sobre', 'booster', 'pack', 'buste'], booster: ['booster', 'sobre'],
  lata: ['lata', 'tin'], latas: ['lata', 'tin'], tin: ['tin', 'lata'], minilata: ['mini lata', 'minilata', 'mini tin'],
  display: ['display', 'booster box', '36 sobres', 'caja de sobres'], caja: ['caja', 'box', 'coffret', 'display'],
  bundle: ['bundle', 'lote de sobres', 'paquete de sobres'], blister: ['blister', 'checklane', '3 pack', '2 pack'],
  coleccion: ['coleccion', 'collection', 'coffret', 'collezione', 'kollektion'], premium: ['premium'],
  espanol: ['espanol', 'spanish', 'castellano'], ingles: ['ingles', 'english'], japones: ['japones', 'japanese', 'jpn', 'japonais'],
  coreano: ['coreano', 'korean', 'kor'], chino: ['chino', 'chinese', 'chn'],
};

// ── estado ──────────────────────────────────────────────────────────────────
const S = {
  tab: store.get('tab', 'novedades'),
  seg: store.get('seg', 'productos'),
  cat: store.get('cat', 'sellado'),
  shop: store.get('shop', 'todas'),
  stockOnly: store.get('stockOnly', false),
  esOnly: store.get('esOnly', false),
  lang: store.get('lang', 'todos'),
  oferta: store.get('oferta', 'chollos'),
  fcol: store.get('fcol', ''),
  fkind: store.get('fkind', ''),
  fprice: store.get('fprice', ''),
  sort: store.get('sort', 'auto'),
  layout: store.get('layout', 'list'),
  colPage: '',
  follows: store.get('follows', []),   // productos seguidos: [{id, t (precio objetivo), title}]
  colStock: 'todos',
  focus: store.get('focus', ''),
  expanded: {},
  query: '',
  limit: PAGE,
  data: null,
};
if (S.seg === 'historial') S.seg = 'productos';   // el historial de avisos ahora está en la pestaña Avisos

// ── datos ───────────────────────────────────────────────────────────────────
async function getJSON(name) {
  const r = await fetch(`data/${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

// cabecera: «Revisado hace 3 min · próxima ~12:45»; los datos se recargan solos cada pocos minutos
let lastLoad = 0;
function updateHeader() {
  const g = S.data && S.data.status && S.data.status.generated;
  if (!g) { $('#updated').textContent = 'Sin datos todavía'; return; }
  const next = new Date(new Date(g).getTime() + 15 * 60000);
  const late = Date.now() - next.getTime() > 5 * 60000;
  const a = agoShort(g);
  $('#updated').textContent = `${a.charAt(0).toUpperCase()}${a.slice(1)}${late ? '' : ` · próxima ${next.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`}`;
}
setInterval(() => {
  if (document.visibilityState !== 'visible' || !S.data) return;
  updateHeader();
  if (Date.now() - lastLoad > 4 * 60000 && !document.querySelector('.sheet-back')) load();   // sin cerrar una ficha abierta
}, 30000);

async function load() {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try {
    const [status, products, news, events, stores, state, sets] = await Promise.all(
      ['status.json', 'products.json', 'news.json', 'events.json', 'stores.json', 'state.json', 'sets.json'].map((n) => getJSON(n).catch(() => ({}))),
    );
    const meta = Object.fromEntries((stores.stores || []).map((s) => [s.id, s]));
    const seededAt = Object.fromEntries(Object.entries(state.stores || {}).map(([k, v]) => [k, v.seeded_at]));
    const byProduct = new Map();
    for (const c of stores.comparisons || []) for (const o of c.offers) byProduct.set(o.id, c);
    const items = products.items || [];
    const byId = new Map(items.map((p) => [p.id, p]));
    const groups = new Map();   // mismo producto en distintas tiendas (lo calcula el radar)
    for (const p of items) {
      const g = p.extra && p.extra.g;
      if (g != null) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
    }
    aliasIndex = null;   // los nombres de colección pueden haber cambiado
    histPromise = null;
    S.data = {
      status, meta, seededAt, byProduct, byId, groups, sets: sets.sets || {},
      setNames: { ...(sets.names_en || {}), ...(sets.names_es || {}) },
      aliases: sets.aliases || {},
      products: products.items || [], news: news.items || [], events: events.items || [],
      stores: stores.stores || [], comparisons: stores.comparisons || [],
    };
    lastLoad = Date.now();
    updateHeader();
  } catch (e) {
    $('#updated').textContent = 'Sin conexión';
  } finally {
    btn.classList.remove('spin');
  }
  render();
}

// ── componentes ─────────────────────────────────────────────────────────────
const shopName = (id) => S.data.meta[id]?.name || id;
const COUNTRY = { ES: 'España', FR: 'Francia', IT: 'Italia', NL: 'Países Bajos', DE: 'Alemania', PT: 'Portugal', BE: 'Bélgica', IE: 'Irlanda' };
const flag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
const countryOf = (id) => S.data.meta[id]?.country || 'ES';
// bandera solo para tiendas de fuera de España (las españolas son la mayoría)
const shopFlag = (id) => { const cc = countryOf(id); return cc && cc !== 'ES' ? `<span title="Envía desde ${esc(COUNTRY[cc] || cc)}">${flag(cc)}</span> ` : ''; };

function relBadge(id) {
  const m = S.data.meta[id];
  if (!m || m.reliability == null) return '';
  const cls = m.reliability >= 85 ? 'ok' : m.reliability >= 70 ? 'info' : 'warn';
  return `<span class="pill ${cls}" title="Fiabilidad">${m.reliability}/100</span>`;
}

// ¿se pudo comprobar su stock en la última revisión? (si no aparece en lo que leemos de la
// tienda o la tienda está en pausa, no se puede dar por disponible)
const storePaused = (id) => ((S.data.status.stores || []).find((s) => s.id === id) || {}).status === 'blocked';
const unconfirmed = (p) => !!((p.extra && p.extra.unseen) || storePaused(p.store));
const inStock = (p) => p.available === true && !unconfirmed(p);

function stockPill(p) {
  if (p.available === true && unconfirmed(p)) {
    return `<span class="pill info" title="${p.extra && p.extra.unseen ? 'No aparece en la última revisión de la tienda' : 'La tienda está en pausa'}">Sin confirmar</span>`;
  }
  if (isPre(p)) {
    if (p.available === true) return '<span class="pill ok">Preventa · reservable</span>';
    if (p.available === false) return '<span class="pill warn">Reservas agotadas</span>';
    return '<span class="pill warn">Preventa</span>';
  }
  if (p.available === true) return '<span class="pill ok">En stock</span>';
  if (p.extra && p.extra.backorder) return '<span class="pill warn" title="Sin unidades: la tienda lo envía cuando le llegue">Bajo pedido</span>';
  if (p.available === false) {
    return /reserva|preventa|pre-?order/i.test(p.title) ? '<span class="pill warn">Reserva</span>' : '<span class="pill no">Agotado</span>';
  }
  return '';
}

const BALL = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 0 1 7.9 7h-4.5a3.5 3.5 0 0 0-6.8 0H4.1A8 8 0 0 1 12 4Zm0 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM4.1 13h4.5a3.5 3.5 0 0 0 6.8 0h4.5a8 8 0 0 1-15.8 0Z"/></svg>';
function thumb(src, emoji = '') {
  const ph = emoji || BALL;
  return src
    ? `<img class="thumb" src="${esc(safeUrl(src))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;thumb ph&quot;>${ph.replace(/"/g, '&quot;')}</div>'">`
    : `<div class="thumb ph">${ph}</div>`;
}

// el mismo producto en las demás tiendas
function sameProduct(p) {
  const g = p.extra && p.extra.g;
  if (g != null && S.data.groups.has(g)) return S.data.groups.get(g).filter((q) => q.id !== p.id);
  const c = S.data.byProduct.get(p.id);
  return c ? c.offers.filter((o) => o.id !== p.id).map((o) => S.data.byId.get(o.id) || o) : [];
}

function cheaperHint(p) {
  if (!p.price) return '';
  const others = sameProduct(p);
  if (!others.length) return '';
  const better = others.filter((o) => o.store !== p.store && o.price && o.price < p.price && inStock(o));
  if (!better.length) {
    const n = new Set([p.store, ...others.map((o) => o.store)]).size;
    return n > 1 && inStock(p) ? `<div class="hint">✓ Mejor precio con stock entre ${n} tiendas</div>` : '';
  }
  const b = better.sort((x, y) => x.price - y.price)[0];
  return `<div class="hint">↓ Más barato en <a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">${esc(shopName(b.store))}: ${money(b.price)}</a></div>`;
}

// 🔥 chollo: sellado con stock claramente por debajo de Cardmarket o de las demás tiendas
const dealOf = (p) => (p.extra && p.extra.chollo) || null;
const dealPill = (p) => { const c = dealOf(p); return c ? `<span class="pill hot">🔥 −${Math.round(c.pct * 100)} %</span>` : ''; };
function dealText(c) {
  const pct = Math.round(c.pct * 100);
  return c.vs === 'cm'
    ? `${pct} % más barato que en Cardmarket (${money(c.ref)})`
    : `${pct} % más barato que en otras ${c.n || 2} tiendas (suelen pedir ${money(c.ref)})`;
}

// 💎 cartas más caras de la colección · 🏷️ precio frente a Cardmarket · 🎲 ¿compensa abrirlo?
const eur = (v) => `${Math.round(v).toLocaleString('es-ES')} €`;
function topCards(setId, n = 2) {
  const info = S.data.sets[setId];
  if (!info || !info.top || !info.top.length) return '';
  return info.top.slice(0, n).map((c) => `${esc(c.name)}${c.r && c.r !== 'ex' ? ` (${esc(c.r)})` : ''} ${eur(c.price)}`).join(' · ');
}
function valueBlock(x, setId) {
  const v = x || {};
  const lines = [];
  const top = setId ? topCards(setId) : '';
  if (top) lines.push(`💎 ${top}`);
  if (v.m) {
    const d = v.vm;
    lines.push(d <= -0.05 ? `🏷️ ${Math.round(-d * 100)} % más barato que en Cardmarket (${eur(v.m)}) ✅`
      : d >= 0.05 ? `🏷️ ${Math.round(d * 100)} % más caro que en Cardmarket (${eur(v.m)}) ⚠️`
        : `🏷️ Precio de mercado (Cardmarket ${eur(v.m)})`);
  }
  if (v.v) {
    const txt = { rentable: '✅ compensa', a_la_par: '⚖️ a la par', no_rentable: '❌ no compensa' }[v.v];
    lines.push(`🎲 Abrirlo: ~${eur(v.ev)} de valor esperado en ${v.n} sobre${v.n === 1 ? '' : 's'} → ${txt}`);
  }
  return lines.length ? `<div class="value">${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : '';
}

const priceHTML = (p) => (p.price ? `<span class="price">${money(p.price, p.currency)}${p.prev_price && p.prev_price > p.price ? `<s>${money(p.prev_price, p.currency)}</s>` : ''}</span>` : '');

// ── veredicto de precio: ¿chollo, buena oferta, precio justo o caro? ─────
// referencia: precio medio de las demás tiendas que venden el mismo producto (o Cardmarket)
function priceRef(p) {
  const per = new Map();
  for (const o of sameProduct(p)) if (o.store !== p.store && o.price) per.set(o.store, Math.min(per.get(o.store) || Infinity, o.price));
  if (per.size >= 2) return { ref: [...per.values()].reduce((a, b) => a + b, 0) / per.size, src: 'tiendas', n: per.size };
  const m = p.extra && p.extra.valor && p.extra.valor.m;
  return m ? { ref: m, src: 'cm' } : null;
}
function verdictOf(p) {
  if (p.category !== 'sellado' || !p.price) return null;
  const deal = dealOf(p);
  if (deal) return { k: 'chollo', label: `🔥 Chollo · ${Math.round(deal.pct * 100)} % menos`, short: '🔥 Chollo' };
  const low = lowOf(p);
  if (low) return { k: 'good', label: `↓ Buena oferta · ${Math.round(low.pct * 100)} % bajo la media`, short: '↓ Buena oferta' };
  const r = priceRef(p);
  if (!r) return null;
  const x = p.price / r.ref;
  if (x <= 1.05) return { k: 'fair', label: '= Precio justo', short: '= Precio justo' };
  const pct = Math.round((x - 1) * 100);
  return { k: 'high', label: `↑ ${pct} % más caro que ${r.src === 'cm' ? 'Cardmarket' : 'la media'}`, short: `↑ ${pct} % más caro` };
}
function refLine(p) {
  if (p.category !== 'sellado') return '';
  const r = priceRef(p);
  const parts = [];
  if (r && r.src === 'tiendas') parts.push(`Media en ${r.n} tiendas ${money(r.ref)}`);
  const m = p.extra && p.extra.valor && p.extra.valor.m;
  if (m) parts.push(`Cardmarket ~${eur(m)}`);
  if (perPack(p)) parts.push(`${money(perPack(p))}/sobre`);
  return parts.length ? `<small>${parts.map(esc).join(' · ')}</small>` : '';
}
// código del idioma de la edición para la esquina de la foto
function langCode(p) {
  const l = langOf(p);
  if (l === 'asia') { const t = fold(p.title); return /corean|korean|\bkor\b|\bkr\b/.test(t) ? 'KR' : /chin|chinese|cinese|\bchn\b|\bschn\b|simplified|[(\[]ch[)\]]/.test(t) ? 'CN' : 'JP'; }
  return { es: 'ES', en: 'EN', otro: 'UE' }[l] || '';
}
const langBadge = (p) => { const c = langCode(p); return c ? `<span class="pill lang">${c}</span>` : ''; };
const kindLabel = (p) => ((KINDS.find(([k]) => k === kindOf(p)) || [])[1]) || '';
// ¿cuánto tardó en agotarse?
function dur(secs) {
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))} min`;
  if (secs < 86400 * 2) return `${Math.round(secs / 3600)} h`;
  return `${Math.round(secs / 86400)} días`;
}
function soldOutText(p) {
  const a = p.extra && p.extra.agotado;
  if (!a || p.available !== false) return '';
  return a.s != null ? `⚡ Se agotó en ${dur(a.s)} · ${ago(a.at)}` : `Se agotó ${ago(a.at)}`;
}
function compactValue(p) {
  if (p.category !== 'sellado' || !p.extra) return '';
  const top = p.extra.set ? topCards(p.extra.set, 1) : '';
  const v = p.extra.valor || {};
  const ev = v.v ? { rentable: '🎲 compensa abrirlo', a_la_par: '🎲 abrirlo queda a la par', no_rentable: '🎲 no compensa abrirlo' }[v.v] : '';
  const line = [top && `💎 ${top}`, ev].filter(Boolean).join(' · ');
  return line ? `<div class="value"><div>${line}</div></div>` : '';
}

function productCard(p, when) {
  const deal = dealOf(p);
  const v = verdictOf(p);
  const so = soldOutText(p);
  return `
  <article class="card tap${deal ? ' deal' : ''}" data-open="${esc(p.id)}" tabindex="0" aria-label="${esc(p.title)}">
    <div class="media">${thumb(p.image)}${langBadge(p)}</div>
    <div class="body">
      <p class="title">${esc(p.title)}</p>
      <div class="meta">${stockPill(p)} ${salidaPill(p.extra)} ${focusPill(p.extra && p.extra.focus)}</div>
      ${v ? `<div class="verdict v-${v.k}">${esc(v.label)}</div>` : ''}
      ${p.extra && p.extra.baja7 ? `<div class="hint">💸 Ha bajado un ${Math.round(p.extra.baja7.pct * 100)} % esta semana (antes ${money(p.extra.baja7.de)})</div>` : ''}
      ${!deal && !lowOf(p) ? cheaperHint(p) : ''}
      <div class="buy-row">
        <div>${priceHTML(p)}${refLine(p)}</div>
        <a class="btn sm" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" aria-label="Abrir en ${esc(shopName(p.store))}">Tienda ↗</a>
      </div>
      <div class="store-line">${shopFlag(p.store)}${esc(shopName(p.store))} ${relBadge(p.store)} ${when ? `· ${esc(when)}` : ''}</div>
      ${so ? `<div class="store-line soldout">${esc(so)}</div>` : ''}
      ${compactValue(p)}
    </div>
  </article>`;
}

function productTile(p) {
  const deal = dealOf(p);
  const low = lowOf(p);
  const v = verdictOf(p);
  const so = soldOutText(p);
  return `
  <article class="tile${deal ? ' deal' : ''}" data-open="${esc(p.id)}" tabindex="0" aria-label="${esc(p.title)}">
    <div class="media">${thumb(p.image)}${langBadge(p)}${deal ? `<span class="badge pill hot">🔥 −${Math.round(deal.pct * 100)} %</span>` : low ? `<span class="badge pill low">−${Math.round(low.pct * 100)} %</span>` : ''}</div>
    <p class="title">${esc(p.title)}</p>
    ${priceHTML(p)}
    ${v ? `<div class="verdict v-${v.k}">${esc(v.short)}</div>` : ''}
    <div class="store-line">${shopFlag(p.store)}${esc(shopName(p.store))}</div>
    <div class="meta" style="margin:4px 2px 0">${so ? `<span class="pill no">${esc(so.replace(/ · .*/, ''))}</span>` : stockPill(p)}</div>
  </article>`;
}

// lista o cuadrícula (se recuerda en el iPhone)
const productsHTML = (items, when = () => '') => `<div class="list${S.layout === 'grid' ? ' grid' : ''}">${items.map((p) => (S.layout === 'grid' ? productTile(p) : productCard(p, when(p)))).join('')}</div>`;
const layoutToggle = () => `<div class="layout-toggle" role="group" aria-label="Vista">
  <button data-layout="list" aria-pressed="${S.layout !== 'grid'}" aria-label="Lista"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h16v2H4v-2Z"/></svg></button>
  <button data-layout="grid" aria-pressed="${S.layout === 'grid'}" aria-label="Cuadrícula"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"/></svg></button>
</div>`;
const toolbar = (title) => `<div class="toolbar"><h3 class="sub">${title}</h3>${layoutToggle()}</div>`;

function newsCard(n) {
  const isPC = n.store === 'pokemoncenter';
  return `
  <a class="card ${n.image ? '' : 'noimg'}" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">
    ${n.image ? thumb(n.image, '📰') : ''}
    <div class="body">
      <p class="title">${esc(n.title)}</p>
      <div class="meta">${isPC ? '<span class="pill accent">Pokémon Center</span>' : '<span class="pill info">Lanzamientos</span>'}
        ${esc(n.source || '')} · ${esc(ago(n.created || n.first_seen))}</div>
    </div>
  </a>`;
}

function eventCard(e) {
  const [icon, label] = EVENT[e.type] || ['•', e.type];
  const price = e.price ? `<span class="price">${money(e.price, e.currency)}${e.old_price ? `<s>${money(e.old_price, e.currency)}</s>` : ''}</span>` : '';
  const known = e.id && S.data.byId.has(e.id);
  return `
  <a class="card${known ? ' tap' : ''}" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener" ${known ? `data-open="${esc(e.id)}"` : ''}>
    ${thumb(e.image, icon)}
    <div class="body">
      <div class="meta"><span class="pill ${e.type === 'chollo' ? 'hot' : e.type === 'restock' ? 'ok' : e.type === 'price_drop' ? 'warn' : e.type === 'news' ? 'info' : 'accent'}">${icon} ${label}</span>${e.chollo && e.type !== 'chollo' ? ` <span class="pill hot">🔥 −${Math.round(e.chollo.pct * 100)} %</span>` : ''} ${focusPill(e.focus)} ${esc(ago(e.at))}</div>
      <p class="title" style="margin-top:4px">${esc(e.title)}</p>
      <div class="meta">${price} ${salidaPill(e)} ${esc(shopName(e.store))}</div>
      ${e.chollo ? `<div class="hint hot">🔥 ${esc(dealText(e.chollo))}</div>` : ''}
      ${e.valor ? valueBlock({ ev: e.valor.ev, n: e.valor.packs, v: e.valor.verdict, m: e.valor.market, vm: e.valor.vs_market }, e.valor.set) : ''}
    </div>
  </a>`;
}

const langSelect = () => `<select class="chip" data-lang aria-label="Idioma" ${S.lang !== 'todos' ? 'aria-pressed="true"' : ''}>
  ${LANGS.map(([v, l]) => `<option value="${v}" ${v === S.lang ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

const segmented = (name, options, current) => `
  <div class="segmented" role="group">${options.map(([v, l]) => `<button data-${name}="${esc(v)}" aria-pressed="${v === current}">${esc(l)}</button>`).join('')}</div>`;

const empty = (title, text) => `<div class="empty"><b>${esc(title)}</b>${text}</div>`;

// ── vistas ──────────────────────────────────────────────────────────────────
// ── filtros comunes: colección, producto, precio y orden ───────────────────
const PRICES = [['', 'Cualquier precio'], ['0-10', 'Hasta 10 €'], ['10-25', '10 – 25 €'], ['25-50', '25 – 50 €'],
  ['50-100', '50 – 100 €'], ['100-200', '100 – 200 €'], ['200-500', '200 – 500 €'], ['500-', 'Más de 500 €']];
const SORTS = { auto: 'Orden: recomendado', recientes: 'Más recientes', precio_asc: 'Precio: de menor a mayor',
  precio_desc: 'Precio: de mayor a menor', descuento: 'Mayor descuento', por_sobre: 'Precio por sobre' };
// sobres que trae y precio por sobre (para comparar una ETB con un bundle o una caja)
const packsOf = (p) => (p.extra && (p.extra.packs || (p.extra.valor && p.extra.valor.n))) || 0;
const perPack = (p) => (p.price && packsOf(p) ? p.price / packsOf(p) : null);
const setName = (id) => S.data.setNames[id] || (S.data.sets[id] || {}).name || id;
const setOf = (p) => (p.extra && p.extra.set) || '';
function priceOk(p) {
  if (!S.fprice) return true;
  const [a, b] = S.fprice.split('-').map(Number);
  return p.price != null && p.price >= a && (!b || p.price < b);
}
const discountOf = (p) => ((dealOf(p) || lowOf(p) || (p.extra && p.extra.baja7) || {}).pct || 0);
// colección + producto + precio (el resto de filtros los aplica cada vista)
const filtered = (list) => list.filter((p) => (!S.fcol || setOf(p) === S.fcol) && (!S.fkind || kindOf(p) === S.fkind) && priceOk(p));
function sorted(list, def, recentKey) {
  const mode = S.sort === 'auto' || !SORTS[S.sort] ? def : S.sort;
  const cmp = {
    recientes: (a, b) => recentKey(b).localeCompare(recentKey(a)),
    precio_asc: (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9),
    precio_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
    descuento: (a, b) => discountOf(b) - discountOf(a),
    por_sobre: (a, b) => (perPack(a) ?? 1e9) - (perPack(b) ?? 1e9),
  }[mode];
  return cmp ? [...list].sort(cmp) : list;
}
const activeFilters = () => [S.fcol, S.fkind, S.fprice].filter(Boolean).length + (S.sort !== 'auto' ? 1 : 0)
  + (S.lang !== 'todos' ? 1 : 0) + (S.esOnly ? 1 : 0) + (S.stockOnly ? 1 : 0) + (S.shop !== 'todas' ? 1 : 0);

// opciones con recuento, a partir de lo que hay en la vista
function filterRow(base, { sorts = ['auto', 'recientes', 'precio_asc', 'precio_desc', 'por_sobre'] } = {}) {
  const cols = new Map();
  const kinds = new Map();
  for (const p of base) {
    const c = setOf(p);
    if (c) cols.set(c, (cols.get(c) || 0) + 1);
    const k = kindOf(p);
    kinds.set(k, (kinds.get(k) || 0) + 1);
  }
  const colOpts = [...cols].sort((a, b) => b[1] - a[1] || setName(a[0]).localeCompare(setName(b[0])));
  if (S.fcol && !cols.has(S.fcol)) colOpts.unshift([S.fcol, 0]);
  const kindOpts = [...KINDS.map(([k, l]) => [k, l]), ['otro', 'Otros']].filter(([k]) => kinds.has(k) || k === S.fkind);
  const sel = (attr, value, opts, label) => `<select class="chip" data-${attr} aria-label="${label}" ${value ? 'aria-pressed="true"' : ''}>${opts}</select>`;
  return `<div class="chips">
    ${sel('fcol', S.fcol, `<option value="">Todas las colecciones</option>${colOpts.map(([id, n]) => `<option value="${esc(id)}" ${id === S.fcol ? 'selected' : ''}>${esc(setName(id))} (${n})</option>`).join('')}`, 'Colección')}
    ${sel('fkind', S.fkind, `<option value="">Todos los productos</option>${kindOpts.map(([k, l]) => `<option value="${k}" ${k === S.fkind ? 'selected' : ''}>${esc(l)} (${kinds.get(k) || 0})</option>`).join('')}`, 'Producto')}
    ${sel('fprice', S.fprice, PRICES.map(([v, l]) => `<option value="${v}" ${v === S.fprice ? 'selected' : ''}>${l}</option>`).join(''), 'Precio')}
    ${sel('sort', S.sort !== 'auto' ? S.sort : '', sorts.map((v) => `<option value="${v}" ${v === S.sort ? 'selected' : ''}>${SORTS[v]}</option>`).join(''), 'Ordenar')}
  </div>`;
}
const clearChip = () => (activeFilters() ? '<button class="chip clear" data-clearf>✕ Quitar filtros</button>' : '');
const moreBtn = (n) => (n > S.limit ? `<p style="text-align:center"><button class="btn ghost" data-more>Ver más (${n - S.limit})</button></p>` : '');
const countLine = (n, total, what) => `<h3 class="sub">${n === total ? `${n} ${what}` : `${n} de ${total} ${what} con estos filtros`}</h3>`;

// 📉 por debajo de la media (sin llegar a chollo)
const lowOf = (p) => (p.extra && p.extra.bajo) || null;
const lowPill = (p) => { const c = lowOf(p); return c ? `<span class="pill low">📉 −${Math.round(c.pct * 100)} %</span>` : ''; };
function lowText(c) {
  const pct = Math.round(c.pct * 100);
  return c.vs === 'cm'
    ? `${pct} % por debajo de Cardmarket (${money(c.ref)})`
    : `${pct} % por debajo del precio medio de otras ${c.n || 2} tiendas (${money(c.ref)})`;
}

function heroHTML() {
  const D = S.data;
  const day = Date.now() - 86400000;
  const recentKey = (p) => p.created || (p.first_seen === D.seededAt[p.store] ? '' : p.first_seen) || '';
  const n = {
    deals: D.products.filter((p) => dealOf(p) && !unconfirmed(p)).length,
    lows: D.products.filter((p) => lowOf(p) && !unconfirmed(p)).length,
    pre: D.products.filter((p) => isPre(p) && inStock(p)).length,
    nuevos: D.products.filter((p) => p.kind !== 'news' && new Date(recentKey(p) || 0).getTime() > day).length,
  };
  const stores = (D.status.stores || []).filter((s) => s.status !== 'skipped' && s.id !== 'noticias').length;
  return `<section class="hero">
    <h2>El radar de Pokémon TCG<span>, en tu iPhone.</span></h2>
    <p>Vigilamos <b>${stores} tiendas</b> de España y la UE cada 15 minutos y te avisamos de lo nuevo, de las reposiciones y de los chollos.</p>
    <div class="kpis">
      <button class="kpi hot" data-go="ofertas:chollos"><b>${n.deals}</b><span>🔥 Chollos ahora</span></button>
      <button class="kpi good" data-go="ofertas:bajos"><b>${n.lows}</b><span>📉 Bajo la media</span></button>
      <button class="kpi" data-go="preventas"><b>${n.pre}</b><span>📅 Preventas abiertas</span></button>
      <button class="kpi" data-go="productos"><b>${n.nuevos}</b><span>🆕 Nuevos en 24 h</span></button>
    </div>
  </section>`;
}

// 🔁 lo que acaba de volver a tener stock
function restockStrip() {
  const since = Date.now() - 2 * 86400000;
  const items = S.data.products.filter((p) => inStock(p) && p.category === 'sellado' && p.extra && p.extra.avail_since
    && new Date(p.extra.avail_since).getTime() > since && p.first_seen !== p.extra.avail_since)
    .sort((a, b) => b.extra.avail_since.localeCompare(a.extra.avail_since)).slice(0, 12);
  if (!items.length) return '';
  return `<h3 class="sub">🔁 Vuelven a stock <small>en las últimas 48 h</small></h3>
    <div class="hscroll">${items.map(productTile).join('')}</div>`;
}

// ⚡ lo que se acaba de agotar (y cuánto duró)
function soldOutStrip() {
  const since = Date.now() - 3 * 86400000;
  const items = S.data.products.filter((p) => p.available === false && p.extra && p.extra.agotado && p.category === 'sellado'
    && new Date(p.extra.agotado.at).getTime() > since)
    .sort((a, b) => b.extra.agotado.at.localeCompare(a.extra.agotado.at)).slice(0, 12);
  if (!items.length) return '';
  return `<h3 class="sub">⚡ Se acaba de agotar <small>en los últimos 3 días</small></h3>
    <div class="hscroll">${items.map(productTile).join('')}</div>`;
}

// ── calendario de lanzamientos y preventas ────────────────────────────────
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_L = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function icsHref(title, day, url) {
  const d = day.replace(/-/g, '');
  const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const d2 = next.toISOString().slice(0, 10).replace(/-/g, '');
  const clean = (t) => t.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PokeRadar//ES', 'BEGIN:VEVENT',
    `UID:${d}-${Math.abs([...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}@pokeradar`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`, `SUMMARY:${clean(`Sale: ${title}`)}`,
    `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
function calendarHTML(items) {
  // el mismo producto en varias tiendas = una sola entrada
  const groups = new Map();
  for (const p of items) {
    const key = p.extra.g != null ? `g${p.extra.g}` : `t${fold(p.title)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const entries = [...groups.values()].map((list) => {
    const dates = list.map((p) => p.extra.salida).filter(Boolean).sort();
    const open = list.filter(inStock).sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
    const rep = open[0] || [...list].sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9))[0];
    return { list, rep, open, salida: dates[0] || '', langs: [...new Set(list.map(langCode).filter(Boolean))] };
  }).sort((a, b) => (a.salida || '9999').localeCompare(b.salida || '9999') || b.open.length - a.open.length);
  const months = new Map();
  for (const e of entries) {
    const m = e.salida ? e.salida.slice(0, 7) : 'sin-fecha';
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(e);
  }
  const row = (e) => {
    const p = e.rep;
    const parts = e.salida.split('-').map(Number);
    const day = parts.length === 3
      ? `<div class="cal-day"><div><b>${parts[2]}</b><small>${DIAS[new Date(`${e.salida}T12:00:00`).getDay()]}</small></div></div>`
      : `<div class="cal-day month"><div><b>${e.salida ? MESES[parts[1]] : '¿?'}</b></div></div>`;
    const where = e.open.length ? `<span class="pill ok">Reservable en ${e.open.length} tienda${e.open.length === 1 ? '' : 's'}</span>` : '<span class="pill warn">Reservas agotadas</span>';
    return `<div class="cal-item" data-open="${esc(p.id)}">
      ${day}${thumb(p.image)}
      <div style="min-width:0">
        <p class="title">${esc(p.title)}</p>
        <div class="meta">${setOf(p) ? `${esc(setName(setOf(p)))} · ` : ''}${esc(kindLabel(p) || 'Producto sellado')}</div>
        <div class="meta" style="margin-top:6px">${where} ${e.langs.map((l) => `<span class="pill">${l}</span>`).join(' ')}</div>
        <div class="meta" style="margin-top:6px">desde <span class="price" style="font-size:16px">${money(p.price)}</span> · ${esc(shopName(p.store))}</div>
        <div class="actions">
          ${parts.length === 3 ? `<a class="btn sm line" href="${icsHref(p.title, e.salida, p.url)}" download="pokeradar-${e.salida}.ics">📅 Añadir al calendario</a>` : ''}
          <a class="btn sm" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">Reservar ↗</a>
        </div>
      </div>
    </div>`;
  };
  return [...months].map(([m, list]) => {
    const [y, mo] = m.split('-').map(Number);
    const title = m === 'sin-fecha' ? 'Sin fecha anunciada' : `${MESES_L[mo]} ${y}`;
    return `<section class="cal-month"><header><b>${title}</b><small>${list.length} producto${list.length === 1 ? '' : 's'}</small></header>
      ${list.slice(0, m === 'sin-fecha' ? S.limit : 200).map(row).join('')}</section>`;
  }).join('');
}

function viewNovedades() {
  const D = S.data;
  if (S.seg === 'chollos') S.seg = 'ofertas';
  let html = `${heroHTML()}
    <div id="segs">${segmented('seg', [['productos', 'Productos'], ['ofertas', 'Ofertas'], ['preventas', 'Calendario'], ['noticias', 'Noticias']], S.seg)}</div>`;
  const where = (p) => langOk(p) && (!S.esOnly || countryOf(p.store) === 'ES') && (S.shop === 'todas' || p.store === S.shop);
  const recent = (p) => p.created || (p.first_seen === D.seededAt[p.store] ? '' : p.first_seen) || '';

  if (S.seg === 'ofertas') {
    const deals = D.products.filter((p) => dealOf(p) && !unconfirmed(p));
    const lows = D.products.filter((p) => lowOf(p) && !unconfirmed(p));
    const drops = D.products.filter((p) => p.extra && p.extra.baja7 && !unconfirmed(p));
    const isDeals = S.oferta === 'chollos' || !['bajos', 'bajadas'].includes(S.oferta);
    const isDrops = S.oferta === 'bajadas';
    const base = (isDrops ? drops : isDeals ? deals : lows).filter(where);
    const items = sorted(filtered(base), 'descuento', recent);
    html += `${segmented('oferta', [['chollos', `🔥 Chollos · ${deals.length}`], ['bajos', `📉 Media · ${lows.length}`], ['bajadas', `💸 Bajadas · ${drops.length}`]], isDrops ? 'bajadas' : isDeals ? 'chollos' : 'bajos')}
      <p class="lead">${isDrops
    ? 'Productos sellados <b>con stock</b> que han <b>bajado de precio esta semana</b> (al menos un 5 % menos que lo más caro que han estado en los últimos 7 días).'
    : isDeals
    ? 'Productos sellados <b>con stock</b> claramente por debajo de su precio habitual: un 15 % menos que en Cardmarket o un 10 % menos que en las demás tiendas vigiladas. Te avisamos al momento de cada chollo nuevo.'
    : 'Productos sellados <b>con stock</b> más baratos que el <b>precio medio</b> de las demás tiendas (al menos un 3 % menos) o que Cardmarket (un 5 % menos), sin llegar a chollo. Buenas compras, aunque sin aviso al iPhone.'}</p>
      ${filterRow(base, { sorts: ['auto', 'descuento', 'precio_asc', 'precio_desc', 'por_sobre', 'recientes'] })}
      <div class="chips">${langSelect()}
        <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
        ${shopSelect()} ${clearChip()}
      </div>`;
    html += items.length
      ? `${toolbar(items.length === base.length ? `${items.length} ${isDeals && !isDrops ? (items.length === 1 ? 'chollo' : 'chollos') : (items.length === 1 ? 'producto' : 'productos')}` : `${items.length} de ${base.length}`)}${productsHTML(items.slice(0, S.limit))}${moreBtn(items.length)}`
      : empty(base.length ? 'Nada con estos filtros' : (isDrops ? 'Ninguna bajada esta semana' : isDeals ? 'Ningún chollo ahora mismo' : 'Nada por debajo de la media ahora mismo'),
        base.length ? 'Prueba a quitar algún filtro.' : 'En cuanto un producto con stock baje de su precio habitual, aparecerá aquí.');
    html += `<p class="muted" style="margin-top:16px">Antes de comprar, revisa los gastos de envío y la valoración de la tienda (en la ficha del producto). Un precio muy por debajo del resto puede ser un error de la tienda.</p>`;
    return html;
  }

  if (S.seg === 'preventas') {
    const base = D.products.filter((p) => isPre(p) && where(p) && (!S.stockOnly || inStock(p)));
    const items = filtered(base);
    html += `<p class="lead">Lanzamientos y preventas abiertas en las tiendas vigiladas, por fecha de salida. Te avisamos al momento cuando una tienda abre una preventa o cuando se vuelve a poder reservar.</p>
      ${filterRow(base, { sorts: ['auto'] })}
      <div class="chips">${langSelect()}
        <button class="chip" data-stock aria-pressed="${S.stockOnly}">Solo reservables</button>
        <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
        ${shopSelect()} ${clearChip()}
      </div>`;
    html += items.length ? calendarHTML(items)
      : empty(base.length ? 'Nada con estos filtros' : 'Sin preventas abiertas ahora mismo', base.length ? 'Prueba a quitar algún filtro.' : 'En cuanto una tienda abra una, aparecerá aquí y te llegará un aviso.');
    html += `<p class="muted" style="margin-top:16px">¿Productos anunciados que aún no están en ninguna tienda? Mira <b>Noticias</b>: ahí salen las presentaciones oficiales de nuevas colecciones.</p>`;
    return html;
  }

  if (S.seg === 'noticias') {
    const items = [...D.news].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    html += `<p class="lead">Anuncios de Pokémon Center y de nuevos lanzamientos y preventas.</p>`;
    html += items.length ? `<div class="list">${items.map(newsCard).join('')}</div>`
      : empty('Sin noticias recientes', 'Aparecerán aquí cuando se publiquen.');
    return html;
  }

  const base = D.products.filter((p) => (S.cat === 'todo' || p.category === S.cat) && where(p) && (!S.stockOnly || inStock(p)));
  const items = sorted(filtered(base), 'recientes', recent);
  html += `<div class="chips">
      ${CATS.map(([v, l]) => `<button class="chip" data-cat="${esc(v)}" aria-pressed="${v === S.cat}">${esc(l)}</button>`).join('')}
    </div>
    ${filterRow(base)}
    <div class="chips">
      <button class="chip" data-stock aria-pressed="${S.stockOnly}">Solo en stock</button>
      ${langSelect()}
      <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
      ${shopSelect()} ${clearChip()}
    </div>`;
  if (!activeFilters() && S.cat === 'sellado') html += restockStrip() + soldOutStrip();
  html += items.length
    ? `${toolbar(activeFilters() ? `${items.length} de ${D.products.filter((p) => S.cat === 'todo' || p.category === S.cat).length}` : 'Lo último')}
       ${productsHTML(items.slice(0, S.limit), (p) => ago(recent(p)))}${moreBtn(items.length)}`
    : empty('Nada por aquí', 'Prueba con otra categoría o quita algún filtro.');
  return html;
}

function shopSelect() {
  const shops = S.data.stores.filter((s) => s.products > 0);
  return `<select class="chip" data-shop aria-label="Tienda" ${S.shop !== 'todas' ? 'aria-pressed="true"' : ''}>
    <option value="todas">Todas las tiendas</option>
    ${[['España', shops.filter((s) => (s.country || 'ES') === 'ES')], ['Unión Europea', shops.filter((s) => (s.country || 'ES') !== 'ES')]]
    .filter(([, l]) => l.length)
    .map(([g, l]) => `<optgroup label="${g}">${l.sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `<option value="${esc(s.id)}" ${s.id === S.shop ? 'selected' : ''}>${flag(s.country || 'ES')} ${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}
  </select>`;
}

function quickLinks(q) {
  const qq = encodeURIComponent(q || 'pokemon tcg');
  const links = [
    ['Amazon.es', 'más nuevos primero', `https://www.amazon.es/s?k=${qq}&s=date-desc-rank`],
    ['Pokémon Center', 'tienda oficial (UK)', `https://www.pokemoncenter.com/en-gb/search/${qq}`],
    ['Cardmarket', 'cartas sueltas', `https://www.cardmarket.com/es/Pokemon/Products/Search?searchString=${qq}`],
    ['idealo', 'comparador de precios', `https://www.idealo.es/resultados.html?q=${qq}`],
  ];
  return `<div class="quick">${links.map(([n, d, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener"><span>${esc(n)}<small>${esc(d)}</small></span></a>`).join('')}</div>`;
}

function comparisonCard(c) {
  const cheapest = Math.min(...c.offers.filter((o) => o.available !== false).map((o) => o.price), Infinity);
  return `<section class="compare">
    <h4>${esc(c.title)}</h4>
    ${c.offers.map((o) => {
      const best = o.price === cheapest;
      return `<a class="offer ${best ? 'best' : ''}" href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">
        <div class="who">${shopFlag(o.store)}${esc(shopName(o.store))} ${relBadge(o.store)} ${best ? '<span class="badge-best">MEJOR PRECIO</span>' : ''}<small>${esc(o.title)}</small></div>
        <div style="text-align:right"><span class="price">${money(o.price)}</span><br>${stockPill(o)}</div>
      </a>`;
    }).join('')}
  </section>`;
}

function viewComparar() {
  const D = S.data;
  let html = `<h2 class="section">Comparar precios</h2>
    <p class="lead">Busca un producto y lo verás ordenado de más barato a más caro en las tiendas vigiladas.</p>
    <label class="search">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/></svg>
      <input id="q" type="search" placeholder="p. ej. ETB Héroes Ascendentes" value="${esc(S.query)}" autocomplete="off" enterkeyhint="search">
    </label>
    <div id="results">${resultsHTML()}</div>`;
  return html;
}

// «etb 30 aniversario» = productos de la colección 30th Celebration que son ETB (en cualquier idioma)
const normName = (t) => fold(t).replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
let aliasIndex = null;
function findSetInQuery(q) {
  if (!aliasIndex) {
    const all = { ...S.data.aliases };
    for (const f of S.data.status.focus || []) if (f.set) for (const n of [f.name, f.short]) if (n) all[normName(n)] = f.set;
    for (const [id, n] of Object.entries(S.data.setNames)) { const k = normName(n); if (k.length >= 4 && !all[k]) all[k] = id; }
    aliasIndex = Object.entries(all).filter(([k]) => k.length >= 3).sort((a, b) => b[0].length - a[0].length);
  }
  const padded = ` ${normName(q)} `;
  for (const [alias, id] of aliasIndex) {
    if (padded.includes(` ${alias} `)) return { id, rest: padded.replace(` ${alias} `, ' ').trim() };
  }
  return null;
}

function resultsHTML() {
  const D = S.data;
  const q = S.query.trim();
  let html = `<div class="chips"><button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo tiendas de España</button></div>
    <h3 class="sub">Buscar también en</h3>${quickLinks(q)}`;
  if (!q) {
    html += `<h3 class="sub">Mismo producto, distinto precio</h3>`;
    html += D.comparisons.length
      ? `<div class="list">${D.comparisons.slice(0, 30).map(comparisonCard).join('')}</div>`
      : empty('Sin comparativas aún', 'Se generan cuando varias tiendas venden el mismo producto.');
    return html;
  }
  const found = findSetInQuery(q);
  const terms = fold(found ? found.rest : q).split(/\s+/).filter(Boolean).map((w) => SYN[w] || [w]);
  const all = D.products
    .filter((p) => !S.esOnly || countryOf(p.store) === 'ES')
    .filter((p) => !found || setOf(p) === found.id)
    .filter((p) => { const t = fold(p.title); return terms.every((alts) => alts.some((w) => t.includes(w))); });
  if (found) html += `<p class="search-help">Colección: <b>${esc(setName(found.id))}</b> (en todos los idiomas) · <button class="link-btn" data-set="${esc(found.id)}">Ver la colección ›</button></p>`;
  // por defecto: lo que tiene stock primero y, dentro, de más barato a más caro
  const byStockPrice = (a, b) => inStock(b) - inStock(a) || (a.price ?? 1e9) - (b.price ?? 1e9);
  const hits = S.sort === 'auto' ? filtered(all).sort(byStockPrice) : sorted(filtered(all), 'precio_asc', (p) => p.first_seen || '');
  html += filterRow(all, { sorts: ['auto', 'precio_asc', 'precio_desc', 'recientes'] });
  html += `<h3 class="sub">${hits.length === all.length ? `${hits.length} resultado${hits.length === 1 ? '' : 's'}` : `${hits.length} de ${all.length} resultados con estos filtros`} en tiendas vigiladas</h3>`;
  html += hits.length
    ? `<div class="list">${hits.slice(0, 60).map((p) => productCard(p, '')).join('')}</div>`
    : empty('Sin resultados', all.length ? 'Prueba a quitar algún filtro.' : 'Prueba con menos palabras o en otro idioma (p. ej. «Destined Rivals» / «Rivales Predestinados»).');
  return html;
}

function storeCard(s, statusById) {
  const [tierLabel, tierCls] = TIER[s.tier] || [s.tier, 'info'];
  const tp = s.trustpilot || {};
  const st = statusById[s.id];
  const score = s.score ?? s.reliability;
  const color = score >= 85 ? 'var(--ok)' : score >= 70 ? 'var(--info)' : 'var(--warn)';
  let price = '—';
  if (s.price_index != null) {
    const pct = Math.round((s.price_index - 1) * 100);
    price = pct <= 1 ? 'La más barata' : `+${pct} % sobre la más barata`;
    price += ` <span class="muted" style="font-weight:400">(${s.matched} comp.)</span>`;
  }
  let statusTxt = '—';
  if (st) {
    const map = { ok: ['ok', 'Vigilando'], skipped: ['info', 'Sin configurar'], blocked: ['warn', 'En pausa'], error: ['no', 'Error'] };
    const [cls, l] = map[st.status] || ['info', st.status];
    statusTxt = `<span class="pill ${cls}">${l}</span>`;
  }
  const extra = [];
  if (s.id === 'amazon') extra.push(['Novedades en Amazon', 'https://www.amazon.es/s?k=pokemon+tcg&s=date-desc-rank']);
  if (s.id === 'pokemoncenter') extra.push(['Cartas TCG', 'https://www.pokemoncenter.com/en-gb/category/trading-card-game']);
  return `<article class="store">
    <div class="store-head">
      <div class="ring" style="--v:${score ?? 0};--ring-color:${color}"><span>${score ?? '–'}</span></div>
      <div><h4>${s.country ? flag(s.country) + ' ' : ''}${esc(s.name)} <span class="pill ${tierCls}">${esc(tierLabel)}</span></h4>
        ${s.city || (s.country && s.country !== 'ES') ? `<div class="meta">${esc([s.city, COUNTRY[s.country] || s.country].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="meta">${s.products ? `${s.products} productos Pokémon vigilados` : esc(s.platform === 'news' ? 'Vigilada mediante noticias' : s.platform === 'amazon_creators' ? 'Conecta la API de Amazon para ver sus novedades aquí' : 'Sin productos sincronizados')}</div></div>
    </div>
    <dl class="facts">
      <div><dt>Fiabilidad</dt><dd>${s.reliability ?? '—'}/100</dd></div>
      ${tp.score ? `<div><dt>Trustpilot</dt><dd><span class="stars">★</span> ${String(tp.score).replace('.', ',')} · ${Number(tp.reviews).toLocaleString('es-ES')} reseñas</dd></div>` : ''}
      <div><dt>Precio</dt><dd>${price}</dd></div>
      <div><dt>Estado</dt><dd>${statusTxt}</dd></div>
    </dl>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
    <div class="actions">
      <a class="btn" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">Abrir tienda</a>
      ${extra.map(([l, u]) => `<a class="btn ghost" href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('')}
      ${tp.url ? `<a class="btn ghost" href="${esc(safeUrl(tp.url))}" target="_blank" rel="noopener">Opiniones</a>` : ''}
    </div>
  </article>`;
}

const OTHER_SHOPS = [
  ['Cardmarket', 'https://www.cardmarket.com/es/Pokemon', 'El mayor mercado europeo de cartas sueltas. Suele ser lo más barato para singles; mira la valoración del vendedor y usa envío certificado.'],
  ['El Corte Inglés', 'https://www.elcorteingles.es/juguetes/juegos-de-mesa/cartas-coleccionables/', 'Gran superficie con devoluciones sencillas; precio oficial en lanzamientos.'],
  ['Fnac', 'https://www.fnac.es/', 'Gran superficie; buenos precios para socios en preventas.'],
  ['GAME', 'https://www.game.es/', 'Cadena española de videojuegos que vende sobres, ETB y latas a precio oficial.'],
  ['idealo', 'https://www.idealo.es/', 'Comparador de precios con valoraciones de tiendas: útil para productos sellados.'],
];

function viewTiendas() {
  const D = S.data;
  const statusById = Object.fromEntries((D.status.stores || []).map((s) => [s.id, s]));
  const main = ['amazon', 'pokemoncenter'].map((id) => D.meta[id]).filter(Boolean);
  const ranked = D.stores.filter((s) => s.tier !== 'noticias' && !main.includes(s));
  const es = ranked.filter((s) => (s.country || 'ES') === 'ES');
  const eu = ranked.filter((s) => (s.country || 'ES') !== 'ES');
  return `<h2 class="section">Tiendas</h2>
    <h3 class="sub">Principales</h3>
    <div class="list">${main.map((s) => storeCard(s, statusById)).join('')}</div>
    <h3 class="sub">${flag('ES')} Tiendas en España · ${es.length}</h3>
    <p class="lead">Ordenadas por puntuación: 60 % fiabilidad (Trustpilot ponderado por nº de reseñas) y 40 % precio comparado con las demás tiendas. Solo se incluyen tiendas con buenas reseñas.</p>
    <div class="list">${es.map((s) => storeCard(s, statusById)).join('')}</div>
    ${eu.length ? `<h3 class="sub">🇪🇺 Tiendas de la UE que envían a España · ${eu.length}</h3>
    <p class="lead">Sin aduanas y en euros, pero el envío suele ser más caro y lento: compáralo con el precio final.</p>
    <div class="list">${eu.map((s) => storeCard(s, statusById)).join('')}</div>` : ''}
    <h3 class="sub">Otras tiendas fiables (sin seguimiento automático)</h3>
    <div class="tips"><ul>${OTHER_SHOPS.map(([n, u, d]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(n)}</b></a><br><span class="muted">${esc(d)}</span></li>`).join('')}</ul></div>
    <h3 class="sub">Consejos para comprar seguro</h3>
    <div class="tips"><ul>
      <li>En Amazon, compra si pone <b>«Vendido por Amazon»</b> o <b>«Enviado por Amazon»</b>; en lanzamientos hay vendedores externos con sobreprecio.</li>
      <li>Desconfía de precios muy por debajo del resto: en productos agotados abundan las webs falsas.</li>
      <li>Paga con tarjeta o PayPal (tienen protección al comprador); evita transferencias a tiendas que no conoces.</li>
      <li>En preventas, revisa la fecha estimada y si te cobran al reservar o al enviar.</li>
      <li>Lee las reseñas de 1 y 2 estrellas recientes: dicen más que la media.</li>
    </ul></div>`;
}

function repoInfo() {
  const fromStatus = S.data?.status?.repo;
  if (fromStatus && fromStatus.includes('/')) { const [owner, repo] = fromStatus.split('/'); return { owner, repo }; }
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

function repoLinks() {
  const r = repoInfo();
  if (!r) return null;
  const base = `https://github.com/${r.owner}/${r.repo}`;
  return { config: `${base}/edit/main/config.toml`, actions: `${base}/actions`, run: `${base}/actions/workflows/monitor.yml` };
}

// ── Revisar las tiendas ahora (lanza el radar en GitHub) ───────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function setRunBtn(label, busy) {
  const b = $('#runnow');
  b.disabled = busy; b.classList.toggle('busy', busy);
  b.querySelector('span').textContent = label;
}
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
let running = false;

async function runNow() {
  if (running) return;
  const r = repoInfo();
  const token = store.get('ghToken', '');
  if (!r || !token) {
    S.tab = 'avisos'; store.set('tab', S.tab); render();
    setTimeout(() => $('#runnow-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    toast('Configura el botón una sola vez (aquí abajo)', 4000);
    return;
  }
  running = true;
  setRunBtn('Revisando…', true);
  const api = `https://api.github.com/repos/${r.owner}/${r.repo}`;
  const headers = ghHeaders(token);
  const since = new Date(Date.now() - 60000).toISOString().replace(/\.\d+Z$/, 'Z');
  const before = S.data?.status?.generated || '';
  try {
    const res = await fetch(`${api}/actions/workflows/monitor.yml/dispatches`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { test_notify: false } }),
    });
    if (res.status === 401) throw new Error('El token no es válido o ha caducado: vuelve a configurarlo en Avisos.');
    if (res.status === 403 || res.status === 404) throw new Error('El token no tiene el permiso «Actions: Read and write» sobre este repositorio.');
    if (!res.ok) throw new Error(`GitHub ha respondido ${res.status}.`);
    toast('📡 Revisando las tiendas… tarda 1-2 minutos', 5000);

    let run = null;
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(8000);
      const rr = await fetch(`${api}/actions/runs?event=workflow_dispatch&per_page=5`, { headers }).catch(() => null);
      if (!rr || !rr.ok) continue;
      const js = await rr.json();
      // la nuestra (no la que lanza el reloj externo cada 15 min)
      run = (js.workflow_runs || []).find((w) => w.created_at >= since && !/^Reloj/.test(w.display_title || '')) || run;
      if (run) setRunBtn(run.status === 'completed' ? 'Publicando…' : run.status === 'queued' ? 'En cola…' : 'Revisando…', true);
      if (run && run.status === 'completed') break;
    }
    if (!run || run.status !== 'completed') throw new Error('Está tardando más de lo normal; los datos aparecerán cuando termine.');
    if (run.conclusion === 'cancelled') {  // GitHub la sustituye por otra revisión que ya estaba en marcha
      toast('⏳ Ya había otra revisión en marcha: los datos se actualizan en 1-2 minutos', 6000);
      return;
    }
    if (run.conclusion !== 'success') throw new Error('La revisión ha fallado: mira los detalles en GitHub → Actions.');

    setRunBtn('Cargando…', true);
    for (let i = 0; i < 12; i += 1) {  // la web tarda unos segundos en publicar los datos nuevos
      const st = await getJSON('status.json').catch(() => ({}));
      if ((st.generated || '') > before) break;
      await sleep(5000);
    }
    await load();
    const n = S.data?.status?.events_this_run || 0;
    toast(n ? `✅ Listo: ${n} novedad${n === 1 ? '' : 'es'}` : '✅ Revisado: sin novedades por ahora', 5000);
  } catch (e) {
    toast(`⚠️ ${e.message}`, 7000);
  } finally {
    running = false;
    setRunBtn('Revisar', false);
  }
}

async function saveToken() {
  const input = $('#gh-token');
  const token = (input?.value || '').trim();
  const r = repoInfo();
  if (!token || !r) return;
  toast('Comprobando el token…', 0);
  try {
    const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}/actions/workflows/monitor.yml`, { headers: ghHeaders(token) });
    if (!res.ok) throw new Error(res.status === 401 ? 'token no válido' : `sin acceso al repositorio (${res.status})`);
    store.set('ghToken', token);
    toast('✅ Botón configurado. Pulsa «Revisar» cuando quieras.', 4500);
    render();
  } catch (e) {
    toast(`⚠️ No se ha guardado: ${e.message}`, 6000);
  }
}

function runNowPanel(links) {
  const r = repoInfo();
  if (store.get('ghToken', '')) {
    return `<div class="panel">
      <b>✅ Configurado en este iPhone</b>
      <p class="muted" style="margin:6px 0 0">Pulsa <b>Revisar</b> (arriba) para revisar todas las tiendas al momento. Tarda 1-2 minutos y la app se actualiza sola.</p>
      <div class="actions" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn" data-runnow>📡 Revisar ahora</button>
        <button class="btn ghost" data-clear-token>Quitar token</button>
      </div></div>`;
  }
  const owner = r ? encodeURIComponent(r.owner) : '';
  const tokenUrl = `https://github.com/settings/personal-access-tokens/new?name=PokeRadar&description=Boton%20Revisar%20de%20PokeRadar&target_name=${owner}&expires_in=365&actions=write`;
  return `<div class="panel">
    <b>Revisar las tiendas cuando tú quieras</b>
    <p class="muted" style="margin:6px 0 0">Se configura una sola vez. El token se guarda solo en este iPhone.</p>
    <ol>
      <li>Abre <a href="${esc(tokenUrl)}" target="_blank" rel="noopener"><b>Crear token en GitHub</b></a> (inicia sesión si te lo pide).</li>
      <li>En <b>Repository access</b> elige <b>Only select repositories</b> → <b>${esc(r ? r.repo : 'pokeradar')}</b>.</li>
      <li>En <b>Permissions</b> → <b>Repository permissions</b> → <b>Actions</b> elige <b>Read and write</b>.</li>
      <li>Pulsa <b>Generate token</b>, cópialo y pégalo aquí:</li>
    </ol>
    <div class="field">
      <input id="gh-token" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn" data-save-token>Guardar</button>
    </div>
    ${links ? `<p class="muted" style="margin:12px 0 0">Sin token también puedes lanzarlo desde <a href="${esc(links.run)}" target="_blank" rel="noopener">GitHub → Run workflow</a>.</p>` : ''}
  </div>`;
}

const TRIGGER = {
  reloj: ['⏱️', 'Reloj'], schedule: ['🐢', 'GitHub'], workflow_dispatch: ['👆', 'Botón'], push: ['🛠️', 'Ajustes'], local: ['💻', 'Manual'],
};
const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function clockSetup() {
  const r = repoInfo();
  const url = r ? `https://github.com/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/settings/environments` : '';
  return `<p class="lead">El radar revisa las tiendas y te avisa al iPhone en cuanto aparece algo nuevo. Ahora depende del programador de GitHub, que se salta o retrasa muchas revisiones.</p>
    <div class="panel">
      <b>⏱️ Activa el reloj de 15 minutos</b> <span class="muted">· 30 segundos, una sola vez</span>
      <ol>
        <li>Abre ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><b>GitHub → Environments</b></a>` : '<b>GitHub → Settings → Environments</b>'} y toca <b>reloj</b>.</li>
        <li>Marca <b>Wait timer</b>, escribe <b>15</b> y pulsa <b>Save protection rules</b>.</li>
        <li>Vuelve aquí y pulsa <b>Revisar</b>: eso pone el reloj en marcha.</li>
      </ol>
    </div>`;
}

function cadencePanel(st) {
  const hist = (st.history || []).filter((h) => h && h.at);
  const now = Date.now();
  const clockOn = hist.some((h) => h.by === 'reloj' && now - new Date(h.at).getTime() < 40 * 60000);
  const recent = hist.filter((h) => now - new Date(h.at).getTime() < 3 * 3600000);
  // hueco más largo entre revisiones en las últimas 3 horas
  let gap = 0;
  for (let i = 0; i + 1 < recent.length; i += 1) gap = Math.max(gap, new Date(recent[i].at) - new Date(recent[i + 1].at));
  if (recent.length) gap = Math.max(gap, now - new Date(recent[0].at));
  const gapMin = Math.round(gap / 60000);
  const everClock = hist.some((h) => h.by === 'reloj');
  const lead = clockOn
    ? '<p class="lead">⏱️ <b>Reloj puntual activo:</b> el radar revisa todas las tiendas cada 15 minutos y te avisa al iPhone en cuanto aparece algo nuevo.</p>'
    : everClock
      ? '<p class="lead">⚠️ <b>El reloj de 15 minutos está parado</b> (suele ser un fallo pasajero de GitHub). Mientras tanto revisa el respaldo de GitHub, y el reloj se vuelve a poner en marcha solo en la siguiente revisión. Si tienes prisa, pulsa <b>Revisar</b>.</p>'
      : clockSetup();
  if (!hist.length) return lead;
  const chips = hist.slice(0, 10).map((h) => {
    const [icon, label] = TRIGGER[h.by] || ['•', h.by];
    return `<span class="pill ${h.by === 'reloj' ? 'ok' : 'info'}" title="${esc(label)}">${icon} ${esc(hhmm(h.at))}</span>`;
  }).join('');
  return `${lead}
    <div class="panel">
      <b>Últimas revisiones</b>${recent.length > 1 ? ` <span class="muted">· hueco máximo en 3 h: ${gapMin} min</span>` : ''}
      <div class="tags">${chips}</div>
      <p class="muted" style="margin:8px 0 0;font-size:12.5px">⏱️ reloj · 👆 botón «Revisar» · 🐢 respaldo de GitHub · 🛠️ cambios en la app</p>
    </div>`;
}

function connectionSummary(st) {
  const shops = (st.stores || []).filter((s) => s.status !== 'skipped');
  if (!shops.length) return '';
  const ok = shops.filter((s) => s.status === 'ok').length;
  const paused = shops.filter((s) => s.status === 'blocked');
  const err = shops.filter((s) => s.status === 'error');
  const all = ok === shops.length;
  return `<div class="panel" style="margin-bottom:10px">
    <b>${all ? '✅' : '📡'} ${ok} de ${shops.length} fuentes conectadas</b>
    ${paused.length ? `<p class="muted" style="margin:6px 0 0">⏸️ En pausa: ${paused.map((s) => esc(s.name)).join(', ')}. Algunas tiendas limitan el acceso automático cuando reciben muchas peticiones; el radar espera (1 h, 2 h, 4 h…) y vuelve a intentarlo solo, sin saltarse sus protecciones.</p>` : ''}
    ${err.length ? `<p class="muted" style="margin:6px 0 0">⚠️ Con errores: ${err.map((s) => esc(s.name)).join(', ')} (suele ser una caída temporal de la tienda).</p>` : ''}
  </div>`;
}

// 👁️ productos que sigues: mejor precio ahora en cualquier tienda y si cumple tu objetivo
function followsHTML() {
  const rows = S.follows.map((f) => {
    const p = S.data.byId.get(f.id);
    if (!p) return `<div class="follow-row"><div class="thumb ph">${BALL}</div><div><b>${esc(f.title || f.id)}</b><small class="muted">Ya no aparece en la tienda</small></div><button class="btn sm ghost" data-follow="${esc(f.id)}">Quitar</button></div>`;
    const offers = [p, ...sameProduct(p)].filter((o) => inStock(o) && o.price).sort((a, b) => a.price - b.price);
    const best = offers[0];
    const ok = best && f.t && best.price <= f.t;
    return `<div class="follow-row" data-open="${esc((best || p).id)}">
      ${thumb(p.image)}
      <div style="min-width:0"><b>${esc(p.title)}</b>
        <div class="meta" style="margin-top:4px">${best ? `Ahora desde <b style="color:var(--text)">${money(best.price)}</b> en ${esc(shopName(best.store))}` : '<span class="pill no">Sin stock en ninguna tienda</span>'}</div>
        <div class="meta" style="margin-top:4px">${f.t ? `<span class="pill ${ok ? 'ok' : ''}">🎯 ${ok ? 'Objetivo cumplido' : 'Objetivo'}: ${money(f.t)}</span>` : '<span class="muted">Sin precio objetivo</span>'}</div>
      </div>
      <button class="btn sm ghost" data-follow="${esc(f.id)}" aria-label="Dejar de seguir">Quitar</button>
    </div>`;
  }).join('');
  const synced = store.get('followsSynced', '') === JSON.stringify(S.follows);
  const token = !!store.get('ghToken', '');
  return `<h3 class="sub">👁️ Siguiendo <small>${S.follows.length}</small></h3>
    <div class="panel">${rows || '<span class="muted">Toca <b>☆ Seguir</b> en la ficha de cualquier producto: te avisaremos con prioridad si vuelve a stock, si baja de precio en cualquier tienda o si llega al precio que tú digas.</span>'}
      ${S.follows.length && token && !synced ? '<p style="margin:10px 0 0"><button class="btn sm" data-sync-follows>Enviar al radar</button> <span class="muted" style="font-size:12.5px">Hay cambios sin enviar.</span></p>' : ''}
      ${S.follows.length && !token ? '<p class="note" style="margin-top:10px">Para recibir estos avisos en el iPhone, configura el botón <b>Revisar</b> aquí abajo (una sola vez).</p>' : ''}
    </div>`;
}

function viewAvisos() {
  const D = S.data;
  const st = D.status || {};
  const links = repoLinks();
  const rows = (st.stores || []).map((s) => {
    const map = { ok: ['ok', 'OK'], skipped: ['info', 'Sin configurar'], blocked: ['warn', 'En pausa'], error: ['no', 'Error'] };
    const [cls, l] = map[s.status] || ['info', s.status];
    const detail = s.status === 'ok' ? `${s.items} artículos · ${s.events} novedades · ${ago(s.at)}` : (s.message || '');
    return `<div class="status-row"><div>${esc(s.name)}<small>${esc(detail)}</small></div><span class="pill ${cls}">${l}</span></div>`;
  }).join('');
  return `<h2 class="section">Avisos</h2>
    ${cadencePanel(st)}
    <div class="panel">
      <b>Activar las notificaciones en el iPhone</b>
      <ol>
        <li>Instala la app gratuita <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener"><b>ntfy</b></a> desde el App Store.</li>
        <li>Pulsa <b>+</b> y suscríbete a tu tema privado (el valor de <code>NTFY_TOPIC</code> que guardaste en GitHub).</li>
        <li>Acepta las notificaciones. ¡Listo! Al tocar un aviso se abre el producto.</li>
      </ol>
    </div>
    ${followsHTML()}
    <h3 class="sub" id="runnow-setup">Botón «Revisar»</h3>
    ${runNowPanel(links)}
    <h3 class="sub">Te avisamos de</h3>
    <div class="panel">
      <div>Categorías: <span class="tags">${(st.categories || []).map((c) => `<span class="pill info">${esc(c)}</span>`).join('') || '—'}</span></div>
      <div style="margin-top:10px">Siempre con prioridad alta: <span class="tags">${(st.watchlist || []).map((w) => `<span class="pill accent">${esc(w)}</span>`).join('') || '—'}</span></div>
      ${links ? `<p style="margin:12px 0 0"><a class="btn ghost" href="${esc(links.config)}" target="_blank" rel="noopener">Cambiar preferencias</a></p>` : '<p class="muted" style="margin:12px 0 0">Se cambian en <code>config.toml</code>.</p>'}
    </div>
    <h3 class="sub">Historial de avisos</h3>
    <p class="muted" style="margin:-4px 0 10px">Todo lo que te hemos notificado (y lo que se quedó fuera por tus filtros).</p>
    ${D.events.length ? `<div class="list">${D.events.slice(0, S.limit).map(eventCard).join('')}</div>
      ${D.events.length > S.limit ? `<p style="text-align:center"><button class="btn ghost" data-more>Ver más (${D.events.length - S.limit})</button></p>` : ''}`
      : empty('Aún no hay avisos', 'La primera pasada solo memoriza el catálogo; a partir de ahí, cada novedad aparecerá aquí y en tu iPhone.')}
    <h3 class="sub">Tiendas conectadas ${st.generated ? `· revisado ${esc(ago(st.generated))}` : ''}</h3>
    ${connectionSummary(st)}
    <div class="panel">${rows || '<span class="muted">Todavía no se ha ejecutado.</span>'}
      ${(st.notify_errors || []).length ? `<p class="note" style="margin-top:10px">${st.notify_errors.map(esc).join('<br>')}</p>` : ''}
      ${links ? `<p style="margin:12px 0 0"><a class="btn ghost" href="${esc(links.actions)}" target="_blank" rel="noopener">Ver ejecuciones</a></p>` : ''}
    </div>`;
}

// ── colecciones vigiladas (151, Evoluciones Prismáticas…) ─────────────────
const KINDS = [
  ['etb', 'Elite Trainer Box', /elite trainer|entrenador (de )?elite|\betb\b|dresseur d.?elite|allenatore fuoriclasse|top.?trainer/],
  ['upc', 'Colección Premium y Ultra Premium', /ultra.?premium|super.?premium|premium (collection|figure)|coleccion premium|collezione premium|coffret premium/],
  ['display', 'Cajas de sobres (Booster Box)', /booster box|\bdisplay\b|caja (de )?(\d{2} )?sobres|\b(18|20|24|30|36) (sobres|boosters|buste)\b|box 36|\bbox de \d{2}\b/],
  ['bundle', 'Booster Bundle', /booster bundle|lote de sobres|paquete de sobres|\bbundle\b/],
  ['tin', 'Latas (Tin)', /\btins?\b|\blatas?\b/],
  ['blister', 'Blísteres', /blister|checklane|\b[23] ?-?pack\b/],
  ['coleccion', 'Colecciones y cajas especiales', /collection|coleccion|coffret|collezione|kollektion|\bbox\b|\bcaja\b|binder|poster|surprise/],
  ['sobre', 'Sobres sueltos', /\bsobres?\b|booster pack|\bboosters?\b|\bbust[ae]\b|sachet/],
];
const kindOf = (p) => {
  const t = fold(p.title);
  if (/card display|display (card )?set|display gift|collection display/.test(t)) return 'coleccion';  // expositores de cartas, no cajas de sobres
  for (const [k, , rx] of KINDS) if (rx.test(t)) return k;
  return 'otro';
};
const focusName = (id) => ((S.data.status.focus || []).find((f) => f.id === id) || {}).name || id;
const focusShort = (id) => ((S.data.status.focus || []).find((f) => f.id === id) || {}).short || focusName(id);
const focusPill = (id) => (id ? `<span class="pill accent">⭐ ${esc(focusShort(id))}</span>` : '');

function focusRow(p, best) {
  return `<div class="offer tap${p === best ? ' best' : ''}" data-open="${esc(p.id)}" role="button" tabindex="0">
    <div class="who">${shopFlag(p.store)}${esc(shopName(p.store))} ${relBadge(p.store)} ${p === best ? '<span class="badge-best">MÁS BARATO</span>' : ''} ${dealPill(p)}<small>${esc(p.title)}</small></div>
    <div style="text-align:right"><span class="price">${money(p.price)}</span><br>${stockPill(p)}</div>
  </div>`;
}

const fmtDate = (d) => { const p = String(d || '').split('-').map(Number); return p.length === 3 ? `${p[2]} ${MESES[p[1]]} ${p[0]}` : ''; };
// producto «estrella» de una colección (para su foto cuando no hay logo): ETB, caja… con foto
function setPhoto(id) {
  const order = ['etb', 'display', 'bundle', 'upc', 'coleccion', 'tin', 'blister', 'sobre', 'otro'];
  const list = S.data.products.filter((p) => p.category === 'sellado' && setOf(p) === id && p.image && langOf(p) !== 'asia');
  list.sort((a, b) => order.indexOf(kindOf(a)) - order.indexOf(kindOf(b)) || inStock(b) - inStock(a));
  return list[0] ? list[0].image : '';
}
const setLogo = (id, cls = 'set-logo') => { const info = S.data.sets[id] || {}; const photo = setPhoto(id);
  if (!info.logo && photo) return `<img class="${cls} photo" src="${esc(safeUrl(photo))}" alt="${esc(setName(id))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;${cls} ph&quot;>${BALL.replace(/"/g, '&quot;')}</div>'">`;
  return info.logo
  ? `<img class="${cls}" src="${esc(safeUrl(info.logo))}" alt="${esc(setName(id))}" loading="lazy" referrerpolicy="no-referrer" onerror="if(!this.dataset.f&&this.src.includes('/es/')){this.dataset.f=1;this.src=this.src.replace('/es/','/en/')}else{this.outerHTML='<div class=&quot;${cls} ph&quot;>${BALL.replace(/"/g, '&quot;')}</div>'}">`
  : `<div class="${cls} ph">${BALL}</div>`; };

// resumen de una colección: productos sellados, cuántos con stock, en cuántas tiendas y desde cuánto
function setSummary(list) {
  const stock = list.filter(inStock);
  return { n: list.length, stock: stock.length, stores: new Set(stock.map((p) => p.store)).size,
    from: stock.length ? Math.min(...stock.map((p) => p.price || Infinity)) : null };
}

function viewColecciones() {
  if (S.colPage) return viewSetPage(S.colPage);
  const D = S.data;
  const bySet = new Map();
  for (const p of D.products) {
    if (p.category !== 'sellado' || !setOf(p)) continue;
    if (!bySet.has(setOf(p))) bySet.set(setOf(p), []);
    bySet.get(setOf(p)).push(p);
  }
  const focus = (D.status.focus || []).filter((f) => f.set && bySet.has(f.set));
  const focusIds = new Set(focus.map((f) => f.set));
  const rel = (id) => (D.sets[id] || {}).release || '';
  const others = [...bySet.keys()].filter((id) => !focusIds.has(id) && bySet.get(id).length >= 2)
    .sort((a, b) => rel(b).localeCompare(rel(a)) || bySet.get(b).length - bySet.get(a).length);
  const tile = (id, featured = false) => {
    const sum = setSummary(bySet.get(id));
    return `<button class="set-tile${featured ? ' featured' : ''}" data-set="${esc(id)}">
      ${setLogo(id)}
      <b>${esc(setName(id))}</b>
      <small>${sum.n} productos · ${sum.stock ? `${sum.stock} con stock en ${sum.stores} tienda${sum.stores === 1 ? '' : 's'}` : 'sin stock ahora'}</small>
      ${sum.from ? `<span><small>desde</small> <span class="price">${money(sum.from)}</span></span>` : ''}
    </button>`;
  };
  return `<h2 class="section">Colecciones</h2>
    <p class="lead">Cada expansión con todos sus productos sellados en las tiendas vigiladas, el mejor precio con stock y sus cartas más caras.</p>
    ${focus.length ? `<h3 class="sub">⭐ Vigiladas de cerca <small>avisos prioritarios</small></h3>
      <div class="set-grid">${focus.map((f) => tile(f.set, true)).join('')}</div>` : ''}
    <h3 class="sub">Todas las colecciones <small>${others.length}</small></h3>
    <div class="set-grid">${others.map((id) => tile(id)).join('')}</div>`;
}

function viewSetPage(id) {
  const D = S.data;
  const info = D.sets[id] || {};
  const all = D.products.filter((p) => p.category === 'sellado' && setOf(p) === id);
  const sum = setSummary(all);
  const focus = (D.status.focus || []).find((f) => f.set === id);
  const today = new Date().toISOString().slice(0, 10);
  const when = info.release ? `${info.release > today ? 'Sale el' : 'Salió el'} ${fmtDate(info.release)}` : '';
  const tabs = { todos: all, stock: all.filter(inStock), sin: all.filter((p) => !inStock(p)) };
  const base = (tabs[S.colStock] || all).filter((p) => langOk(p) && (!S.esOnly || countryOf(p.store) === 'ES'));
  let html = `<section class="set-hero">
      <button class="back" data-set="">‹ Colecciones</button>
      ${setLogo(id, 'hero-logo')}
      <h2>${esc(setName(id))}</h2>
      <p>${[info.serie, when].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="stats">
        <div><small>En stock</small><b>${sum.stores} tienda${sum.stores === 1 ? '' : 's'}</b></div>
        <div><small>Precio desde</small><b>${sum.from ? money(sum.from) : '—'}</b></div>
        <div><small>Productos</small><b>${sum.n}</b></div>
      </div>
    </section>
    ${focus ? `<p class="lead" style="margin-top:14px">⭐ <b>Vigilada de cerca:</b> te avisamos con prioridad de cada novedad, reposición o bajada de precio (desde un 5 %).</p>` : ''}
    ${segmented('colstock', [['todos', `Todos (${tabs.todos.length})`], ['stock', `En stock (${tabs.stock.length})`], ['sin', `Sin stock (${tabs.sin.length})`]], S.colStock)}
    <div class="chips">${langSelect()}
      <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
    </div>`;
  const cheapPack = all.filter((p) => inStock(p) && perPack(p)).sort((a, b) => perPack(a) - perPack(b))[0];
  if (cheapPack) {
    html += `<div class="deal-box low" style="margin-top:14px" data-open="${esc(cheapPack.id)}">💡 <b>Lo más barato por sobre:</b> ${esc(cheapPack.title)} a <b>${money(perPack(cheapPack))}/sobre</b> (${money(cheapPack.price)} · ${packsOf(cheapPack)} sobres) en ${esc(shopName(cheapPack.store))}</div>`;
  }
  if (info.top && info.top.length) {
    html += `<h3 class="sub">💎 Las cartas más caras</h3>
      <div class="panel toplist">${info.top.map((c, i) => `<div><span>${i + 1}. ${esc(c.name)}${c.r && c.r !== 'ex' ? ` <small class="muted">${esc(RAREZA[c.r] || c.r)}</small>` : ''}</span><b>${eur(c.price)}</b></div>`).join('')}
      ${info.ev_pack ? `<p class="muted" style="margin:8px 0 0;font-size:12.5px">🎲 Un sobre vale de media unos <b>${eur(info.ev_pack)}</b> en cartas (precios de Cardmarket).</p>` : ''}</div>`;
  }
  const byKind = new Map();
  for (const p of base) { const k = kindOf(p); if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(p); }
  let any = false;
  for (const [k, label] of [...KINDS, ['otro', 'Otros']]) {
    const list = byKind.get(k);
    if (!list) continue;
    any = true;
    list.sort((a, b) => inStock(b) - inStock(a) || (a.price ?? 1e9) - (b.price ?? 1e9));
    const best = list.find((p) => inStock(p) && p.price) || null;
    const open = S.expanded[`${id}:${k}`];
    html += `<h3 class="sub">${esc(label)} <small>${list.length}</small></h3>
      <section class="compare">
        <div class="kind-best">${best ? `Desde <b>${money(best.price)}</b> con stock en ${esc(shopName(best.store))}` : '<span class="muted">Ahora mismo sin stock en ninguna tienda</span>'}</div>
        ${list.slice(0, open ? list.length : 5).map((p) => focusRow(p, best)).join('')}
        ${list.length > 5 && !open ? `<button class="btn ghost more-row" data-expand="${esc(`${id}:${k}`)}">Ver los ${list.length}</button>` : ''}
      </section>`;
  }
  if (!any) html += empty('Nada con estos filtros', 'Prueba con otro idioma o con «Todos».');
  return html;
}

// ── ficha del producto (se abre al tocar un producto) ─────────────────────
const RAREZA = { SIR: 'Ilustración especial', MHR: 'Mega hiper rara', HR: 'Hiper rara', IR: 'Ilustración rara', SUR: 'Ultra rara variocolor', UR: 'Ultra rara', ACE: 'AS TÁCTICO', SR: 'Rara variocolor', ex: 'Doble rara' };

function offerRow(o, cheapest, current) {
  const best = inStock(o) && o.price === cheapest;
  return `<a class="offer ${best ? 'best' : ''}${current ? ' current' : ''}" href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">
    <div class="who">${shopFlag(o.store)}${esc(shopName(o.store))} ${relBadge(o.store)} ${best ? '<span class="badge-best">MEJOR PRECIO</span>' : ''}${current ? '<span class="muted"> · esta</span>' : ''}<small>${esc(o.title)}</small></div>
    <div style="text-align:right"><span class="price">${money(o.price)}</span><br>${stockPill(o)}</div>
  </a>`;
}

function stockNote(p) {
  const st = (S.data.status.stores || []).find((s) => s.id === p.store) || {};
  if (p.extra && p.extra.unseen) return `⚠️ No aparece en la última revisión de la tienda (desde ${esc(ago(p.extra.unseen))}): puede que ya no esté a la venta. Compruébalo en su web.`;
  if (st.status === 'blocked') return `⏸️ La tienda está en pausa: el stock es el de la última revisión. Compruébalo en su web.`;
  return st.at ? `🕒 Stock y precio comprobados ${esc(ago(st.at))}.` : '';
}

// ¿es buen precio? mejor con stock, precio normal (mediana) y «la mayoría hasta» (percentil 90)
function priceStats(p) {
  const per = new Map();
  for (const o of [p, ...sameProduct(p)]) if (o.price) per.set(o.store, Math.min(per.get(o.store) || Infinity, o.price));
  const all = [...per.values()].sort((a, b) => a - b);
  const stock = [p, ...sameProduct(p)].filter((o) => o.price && inStock(o)).map((o) => o.price).sort((a, b) => a - b);
  if (all.length < 2) return null;
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  return { best: stock[0] ?? null, median: q(all, 0.5), p90: q(all, 0.9), n: all.length, inStock: stock.length };
}
function judgePrice(x, st, market) {
  const median = st ? st.median : market;
  if (!median) return null;
  if (st && st.best && x < st.best * 0.98) return ['hot', '🔥 Más barato que cualquier tienda con stock ahora mismo. ¡Corre!'];
  if (x <= median * 0.97) return ['good', `↓ Buen precio: ${Math.round((1 - x / median) * 100)} % por debajo de lo normal (${money(median)}).`];
  if (x <= median * 1.05) return ['fair', `= Precio normal: lo que suele costar (${money(median)}).`];
  if (st && x <= st.p90) return ['high', `↑ Algo caro: más de la mitad de las tiendas lo tienen más barato (lo normal es ${money(median)}).`];
  return ['high', `⚠️ Caro: casi todas las tiendas lo tienen más barato (lo normal es ${money(median)}).`];
}
function priceCheckHTML(p) {
  if (p.category !== 'sellado') return '';
  const st = priceStats(p);
  const m = p.extra && p.extra.valor && p.extra.valor.m;
  if (!st && !m) return '';
  return `<h3 class="sub">¿Es buen precio?</h3><div class="panel" id="pv" data-id="${esc(p.id)}">
    ${st ? `<div class="stats">
      <div><small>Mejor con stock</small><b>${st.best ? money(st.best) : '—'}</b></div>
      <div><small>Precio normal</small><b>${money(st.median)}</b></div>
      <div><small>La mayoría hasta</small><b>${money(st.p90)}</b></div>
    </div>` : ''}
    ${m ? `<p class="muted" style="margin:10px 0 0;font-size:13px">Cardmarket: unos <b>${eur(m)}</b> (edición en inglés).</p>` : ''}
    <div class="pv"><input id="pv-input" inputmode="decimal" autocomplete="off" placeholder="¿Has visto otro precio? p. ej. 54,90"><span class="muted" style="align-self:center">€</span></div>
    <div class="pv-result" id="pv-result" aria-live="polite"></div>
    <p class="muted" style="margin:8px 0 0;font-size:12px">${st ? `Comparamos con las ${st.n} tiendas vigiladas que venden este mismo producto en el mismo idioma (${st.inStock} con stock). «Precio normal» es la mediana; «la mayoría hasta», lo que no supera casi ninguna.` : 'Solo hay una tienda vigilada con este producto: se compara con Cardmarket.'}</p>
  </div>`;
}

function sheetHTML(p) {
  const D = S.data;
  const deal = dealOf(p);
  const v = (p.extra && p.extra.valor) || {};
  const setId = p.extra && p.extra.set;
  const info = setId ? D.sets[setId] : null;
  const m = D.meta[p.store] || {};
  const all = [p, ...sameProduct(p)].filter((o) => o.price)
    .sort((a, b) => inStock(b) - inStock(a) || a.price - b.price);
  const cheapest = Math.min(...all.filter(inStock).map((o) => o.price), Infinity);
  const cm = `https://www.cardmarket.com/es/Pokemon/Products/Search?searchString=${encodeURIComponent(info ? info.name : p.title)}`;
  let html = `<div class="sheet-top">
      ${thumb(p.image)}
      <div><p class="title">${esc(p.title)}</p>
        <div class="meta">${priceHTML(p)} ${dealPill(p)} ${lowPill(p)} ${stockPill(p)} ${salidaPill(p.extra)}</div>
        <div class="meta" style="margin-top:4px">${shopFlag(p.store)}${esc(shopName(p.store))} ${relBadge(p.store)}</div>
        ${setOf(p) ? `<div class="meta" style="margin-top:4px"><button class="link-btn" style="padding:0" data-set="${esc(setOf(p))}">${esc(setName(setOf(p)))} ›</button> · ${esc(kindLabel(p) || 'Otros')}</div>` : ''}
      </div>
    </div>`;
  if (deal) html += `<div class="deal-box">🔥 <b>Chollo:</b> ${esc(dealText(deal))}</div>`;
  else if (lowOf(p)) html += `<div class="deal-box low">📉 <b>Por debajo de la media:</b> ${esc(lowText(lowOf(p)))}</div>`;
  html += `<p class="muted sheet-note">${stockNote(p)}</p>`;
  const fol = followOf(p.id);
  html += `<div class="actions sheet-actions">
      <a class="btn" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">Ver en ${esc(shopName(p.store))}</a>
      <button class="btn ${fol ? 'accent' : 'line'}" data-follow="${esc(p.id)}">${fol ? '✓ Siguiendo' : '☆ Seguir'}</button>
      <button class="btn ghost" data-share="${esc(p.id)}" aria-label="Compartir">Compartir</button>
      <a class="btn ghost" href="${esc(cm)}" target="_blank" rel="noopener">Cardmarket</a>
    </div>
    ${fol ? followPanel(p, fol) : ''}`;
  if (m.trustpilot && m.trustpilot.score) {
    html += `<p class="muted sheet-note">★ ${String(m.trustpilot.score).replace('.', ',')} en Trustpilot (${Number(m.trustpilot.reviews).toLocaleString('es-ES')} reseñas)${m.note ? ` · ${esc(m.note)}` : ''}</p>`;
  } else if (m.note) html += `<p class="muted sheet-note">${esc(m.note)}</p>`;
  if (all.length > 1) {
    html += `<h3 class="sub">En ${new Set(all.map((o) => o.store)).size} tiendas</h3>
      <section class="compare">${all.map((o) => offerRow(o, cheapest, o.id === p.id)).join('')}</section>`;
  }
  html += priceCheckHTML(p);
  if (p.category === 'sellado') html += `<h3 class="sub">📈 Historial de precio</h3><div class="panel" id="hist" data-id="${esc(p.id)}"><span class="muted">Cargando…</span></div>`;
  if (p.category === 'sellado' && (v.m || v.v)) {
    html += `<h3 class="sub">¿Compensa abrirlo?</h3><div class="panel">`;
    if (v.m) {
      const d = v.vm;
      html += `<div>🏷️ En Cardmarket cuesta unos <b>${eur(v.m)}</b>: aquí está ${d <= -0.05 ? `un <b>${Math.round(-d * 100)} % más barato</b> ✅` : d >= 0.05 ? `un <b>${Math.round(d * 100)} % más caro</b> ⚠️` : '<b>a precio de mercado</b>'}.</div>`;
    }
    if (v.v) {
      const txt = { rentable: '✅ compensa', a_la_par: '⚖️ queda a la par', no_rentable: '❌ no compensa' }[v.v];
      html += `<div style="margin-top:6px">🎲 Sus ${v.n} sobre${v.n === 1 ? '' : 's'} valen de media <b>~${eur(v.ev)}</b> en cartas → ${txt} abrirlo para vender las cartas.</div>`;
    }
    html += `<p class="muted" style="margin:8px 0 0;font-size:12.5px">Estimación con los precios de Cardmarket y las probabilidades medias de cada rareza. Si buscas una carta concreta, casi siempre sale más barato comprarla suelta.</p></div>`;
  }
  if (info && info.top && info.top.length) {
    html += `<h3 class="sub">💎 Cartas más caras · ${esc(info.name || '')}</h3>
      <div class="panel toplist">${info.top.map((c, i) => `<div><span>${i + 1}. ${esc(c.name)}${c.r && c.r !== 'ex' ? ` <small class="muted">${esc(RAREZA[c.r] || c.r)}</small>` : ''}</span><b>${eur(c.price)}</b></div>`).join('')}</div>`;
  }
  return html;
}

// ── seguir productos: «avísame si baja de X €» ───────────────────────────
const followOf = (id) => S.follows.find((f) => f.id === id) || null;
function followPanel(p, f) {
  const token = !!store.get('ghToken', '');
  return `<div class="panel" style="margin-top:12px">
    <b>👁️ Siguiendo este producto</b>
    <p class="muted" style="margin:4px 0 0;font-size:13px">Te avisamos con prioridad si vuelve a stock o baja de precio <b>en cualquier tienda</b> que lo venda${f.t ? `, y en cuanto alguna lo tenga a <b>${money(f.t)} o menos</b>` : ''}.</p>
    <div class="pv"><input id="follow-target" data-id="${esc(p.id)}" inputmode="decimal" autocomplete="off" value="${f.t ? String(f.t).replace('.', ',') : ''}" placeholder="Avísame si baja de… (opcional)"><button class="btn" data-follow-save="${esc(p.id)}">Guardar</button></div>
    ${token ? '' : '<p class="note" style="margin-top:10px">Para que estos avisos lleguen al iPhone, configura una vez el botón <b>Revisar</b> (pestaña Avisos). Mientras, el seguimiento se ve solo en la app.</p>'}
  </div>`;
}
const parsePrice = (v) => { const raw = String(v || '').trim().replace(/\s|€/g, ''); const x = parseFloat(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : (/^\d+\.\d{1,2}$/.test(raw) ? raw : raw.replace(/\./g, ''))); return x > 0 ? Math.round(x * 100) / 100 : null; };
function saveFollows(msg) {
  store.set('follows', S.follows);
  syncFollows(msg);
}
// la lista se envía al radar al lanzar una revisión (con el token del botón «Revisar»)
const syncFollows = debounce(async (msg) => {
  const r = repoInfo();
  const token = store.get('ghToken', '');
  if (!r || !token) { if (msg) toast(`${msg} · solo en este iPhone`, 3500); return; }
  try {
    const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}/actions/workflows/monitor.yml/dispatches`, {
      method: 'POST', headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { origen: 'app', seguir: JSON.stringify(S.follows.map((f) => ({ id: f.id, t: f.t || null }))) } }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    store.set('followsSynced', JSON.stringify(S.follows));
    if (msg) toast(`${msg} · avisos al iPhone activados`, 3500);
  } catch (e) {
    toast(`⚠️ No se pudo enviar al radar (${e.message}). Se reintentará al seguir otro producto.`, 5000);
  }
}, 1500);

// ── historial de precio (se carga al abrir una ficha) ─────────────────────
let histPromise = null;
const loadHistory = () => (histPromise ||= getJSON('history.json').then((d) => d.items || {}).catch(() => ({})));
function histHTML(pts) {
  if (!pts || !pts.length) return '<span class="muted">Aún no hay historial: se va guardando desde ahora en cada revisión.</span>';
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (d) => Math.round((new Date(`${today}T12:00:00`) - new Date(`${d}T12:00:00`)) / 86400000);
  const series = [...pts, [today, pts[pts.length - 1][1], pts[pts.length - 1][2]]];
  const span = Math.max(7, daysAgo(series[0][0]));
  const prices = series.map((x) => x[1]);
  const lo = Math.min(...prices), hi = Math.max(...prices), pad = (hi - lo) * 0.15 || hi * 0.05 || 1;
  const W = 320, H = 110;
  const X = (d) => ((span - daysAgo(d)) / span) * W;
  const Y = (v) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
  let path = '';
  series.forEach((x, i) => { path += i ? `H${X(x[0]).toFixed(1)}V${Y(x[1]).toFixed(1)}` : `M${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`; });
  // tramos sin stock en gris
  const gaps = [];
  for (let i = 0; i < series.length - 1; i += 1) if (!series[i][2]) gaps.push(`<rect x="${X(series[i][0]).toFixed(1)}" y="0" width="${Math.max(1, X(series[i + 1][0]) - X(series[i][0])).toFixed(1)}" height="${H}" class="gap"/>`);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const in30 = series.filter((x, i) => x[0] >= d30 || (series[i + 1] && series[i + 1][0] >= d30));
  const min30 = Math.min(...in30.map((x) => x[1]));
  const restocks = series.filter((x, i) => i && x[0] >= d30 && x[2] && !series[i - 1][2]).length;
  const now = series[series.length - 1][1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Precio en los últimos ${span} días">${gaps.join('')}<path d="${path}"/></svg>
    <div class="chart-axis"><span>hace ${span} días</span><span>hoy</span></div>
    <div class="stats" style="margin-top:10px">
      <div><small>Mínimo 30 días</small><b>${money(min30)}</b></div>
      <div><small>Máximo</small><b>${money(hi)}</b></div>
      <div><small>Reposiciones 30 d</small><b>${restocks}</b></div>
    </div>
    ${now <= min30 ? '<p class="pv-result good" style="margin-top:10px">✓ Está en su precio más bajo de los últimos 30 días.</p>' : ''}
    <p class="muted" style="margin:8px 0 0;font-size:12px">Precio en esta tienda en cada revisión. Las zonas grises son días sin stock.</p>`;
}

function openSheet(id) {
  const p = S.data && S.data.byId.get(id);
  if (!p) return;
  closeSheet();
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(p.title)}">
    <div class="grab" aria-hidden="true"></div>
    <button class="sheet-x" data-close aria-label="Cerrar">✕</button>
    ${sheetHTML(p)}</div>`;
  back.addEventListener('click', (ev) => { if (ev.target === back || ev.target.closest('[data-close]')) closeSheet(); });
  document.body.appendChild(back);
  document.body.classList.add('locked');
  const h = back.querySelector('#hist');
  if (h) loadHistory().then((items) => { if (h.isConnected) h.innerHTML = histHTML(items[h.dataset.id]); });
  back.querySelector('.sheet-x').focus({ preventScroll: true });
}
function closeSheet() {
  document.querySelectorAll('.sheet-back').forEach((n) => n.remove());
  document.body.classList.remove('locked');
}
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeSheet();
  if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('[data-open]')) openSheet(ev.target.dataset.open);
});

// ── render y eventos ───────────────────────────────────────────────────────
const VIEWS = { novedades: viewNovedades, colecciones: viewColecciones, comparar: viewComparar, tiendas: viewTiendas, avisos: viewAvisos };

function render() {
  if (!S.data) return;
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  $('#view').innerHTML = (VIEWS[S.tab] || viewNovedades)();
}

const updateResults = debounce(() => { const r = $('#results'); if (r) r.innerHTML = resultsHTML(); }, 180);

document.addEventListener('click', (ev) => {
  const opener = ev.target.closest('[data-open]');
  const link = ev.target.closest('a');
  if (opener && (!link || link === opener) && !ev.target.closest('.sheet')) {
    ev.preventDefault();
    openSheet(opener.dataset.open);
    return;
  }
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.tab === 'colecciones' && S.tab === 'colecciones') S.colPage = '';
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.limit = PAGE; store.set('tab', S.tab); render(); window.scrollTo(0, 0); return; }
  if ('set' in t.dataset) { closeSheet(); S.colPage = t.dataset.set; S.colStock = 'todos'; S.tab = 'colecciones'; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.colstock) { S.colStock = t.dataset.colstock; render(); return; }
  if (t.dataset.follow) {
    const id = t.dataset.follow;
    const p = S.data.byId.get(id);
    if (followOf(id)) { S.follows = S.follows.filter((f) => f.id !== id); saveFollows('Ya no lo sigues'); }
    else { S.follows = [...S.follows, { id, t: null, title: p ? p.title : id }]; saveFollows('👁️ Siguiendo'); }
    if (document.querySelector('.sheet-back')) { const sc = document.querySelector('.sheet').scrollTop; openSheet(id); document.querySelector('.sheet').scrollTop = sc; }
    if (S.tab === 'avisos') render();
    return;
  }
  if ('syncFollows' in t.dataset) { syncFollows('Avisos guardados'); setTimeout(render, 2500); return; }
  if (t.dataset.followSave) {
    const id = t.dataset.followSave;
    const f = followOf(id);
    const input = document.querySelector(`#follow-target[data-id="${CSS.escape(id)}"]`) || document.querySelector('#follow-target');
    if (f) { f.t = parsePrice(input && input.value); saveFollows(f.t ? `🎯 Te avisamos si baja de ${money(f.t)}` : 'Objetivo quitado'); }
    if (S.tab === 'avisos') render();
    return;
  }
  if (t.dataset.share) {
    const p = S.data.byId.get(t.dataset.share);
    if (!p) return;
    const text = `${p.title} — ${money(p.price)} en ${shopName(p.store)} (visto en PokéRadar)`;
    if (navigator.share) navigator.share({ title: p.title, text, url: p.url }).catch(() => {});
    else navigator.clipboard?.writeText(`${text}\n${p.url}`).then(() => toast('Enlace copiado'), () => {});
    return;
  }
  if (t.dataset.go) {
    const [seg, sub] = t.dataset.go.split(':');
    S.seg = seg; if (sub) S.oferta = sub; S.limit = PAGE;
    store.set('seg', S.seg); store.set('oferta', S.oferta); render();
    setTimeout(() => $('#segs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    return;
  }
  if (t.dataset.layout) { S.layout = t.dataset.layout; store.set('layout', S.layout); render(); return; }
  if (t.dataset.oferta) { S.oferta = t.dataset.oferta; S.limit = PAGE; store.set('oferta', S.oferta); render(); return; }
  if ('clearf' in t.dataset) {
    Object.assign(S, { fcol: '', fkind: '', fprice: '', sort: 'auto', lang: 'todos', esOnly: false, stockOnly: false, shop: 'todas', limit: PAGE });
    for (const k of ['fcol', 'fkind', 'fprice', 'sort', 'lang', 'esOnly', 'stockOnly', 'shop']) store.set(k, S[k]);
    render(); return;
  }
  if (t.dataset.focus) { S.focus = t.dataset.focus; store.set('focus', S.focus); render(); return; }
  if (t.dataset.expand) { S.expanded[t.dataset.expand] = true; render(); return; }
  if (t.dataset.seg) { S.seg = t.dataset.seg; S.limit = PAGE; store.set('seg', S.seg); render(); return; }
  if (t.dataset.cat) { S.cat = t.dataset.cat; S.limit = PAGE; store.set('cat', S.cat); render(); return; }
  if ('stock' in t.dataset) { S.stockOnly = !S.stockOnly; store.set('stockOnly', S.stockOnly); render(); return; }
  if ('esonly' in t.dataset) {
    S.esOnly = !S.esOnly; store.set('esOnly', S.esOnly);
    if (S.tab === 'comparar') { document.querySelectorAll('[data-esonly]').forEach((b) => b.setAttribute('aria-pressed', String(S.esOnly))); updateResults(); }
    else render();
    return;
  }
  if ('more' in t.dataset) { S.limit += PAGE; render(); return; }
  if ('dismissInstall' in t.dataset) { $('#install-hint').hidden = true; store.set('installHint', false); return; }
  if (t.id === 'refresh') load();
  if (t.id === 'runnow' || 'runnow' in t.dataset) runNow();
  if ('saveToken' in t.dataset) saveToken();
  if ('clearToken' in t.dataset) { store.set('ghToken', ''); toast('Token eliminado de este iPhone'); render(); }
});
document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-shop]')) { S.shop = ev.target.value; S.limit = PAGE; store.set('shop', S.shop); render(); }
  for (const [attr, key] of [['fcol', 'fcol'], ['fkind', 'fkind'], ['fprice', 'fprice'], ['sort', 'sort']]) {
    if (ev.target.matches(`[data-${attr}]`)) {
      S[key] = ev.target.value || (key === 'sort' ? 'auto' : '');
      store.set(key, S[key]); S.limit = PAGE; render(); return;
    }
  }
  if (ev.target.matches('[data-lang]')) { S.lang = ev.target.value; S.limit = PAGE; store.set('lang', S.lang); render(); }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'pv-input') {
    const box = ev.target.closest('#pv');
    const p = box && S.data.byId.get(box.dataset.id);
    const out = $('#pv-result');
    const raw = ev.target.value.trim().replace(/\s|€/g, '');
    // «54,90», «1.499,90» o «54.90»
    const x = parseFloat(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : (/^\d+\.\d{1,2}$/.test(raw) ? raw : raw.replace(/\./g, '')));
    const res = p && x > 0 ? judgePrice(x, priceStats(p), p.extra && p.extra.valor && p.extra.valor.m) : null;
    out.className = `pv-result ${res ? res[0] : ''}`;
    out.textContent = res ? res[1] : '';
    return;
  }
  if (ev.target.id === 'q') { S.query = ev.target.value; updateResults(); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) load(); });

// Sugerencia de instalación en iPhone (Safari, fuera de modo app)
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
if (isIOS && !standalone && store.get('installHint', true)) $('#install-hint').hidden = false;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
load();
