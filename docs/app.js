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
  etb: ['etb', 'elite trainer', 'entrenador elite', 'entrenador de elite', 'caja elite'],
  sobre: ['sobre', 'booster', 'pack'], sobres: ['sobre', 'booster', 'pack'], booster: ['booster', 'sobre'],
  lata: ['lata', 'tin'], tin: ['tin', 'lata'], display: ['display', 'booster box', '36 sobres'],
  espanol: ['espanol', 'spanish', 'castellano'], ingles: ['ingles', 'english'], japones: ['japones', 'japanese', 'jpn'],
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
    S.data = {
      status, meta, seededAt, byProduct, byId, groups, sets: sets.sets || {},
      products: products.items || [], news: news.items || [], events: events.items || [],
      stores: stores.stores || [], comparisons: stores.comparisons || [],
    };
    $('#updated').textContent = status.generated ? `Revisado ${agoShort(status.generated)}` : 'Sin datos todavía';
  } catch (e) {
    $('#updated').textContent = 'Sin conexión';
  } finally {
    btn.classList.remove('spin');
  }
  render();
}

// ── componentes ─────────────────────────────────────────────────────────────
const shopName = (id) => S.data.meta[id]?.name || id;
const COUNTRY = { ES: 'España', FR: 'Francia', IT: 'Italia', NL: 'Países Bajos', DE: 'Alemania', PT: 'Portugal', BE: 'Bélgica' };
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

function stockPill(p) {
  if (isPre(p)) {
    if (p.available === true) return '<span class="pill ok">Preventa · reservable</span>';
    if (p.available === false) return '<span class="pill warn">Reservas agotadas</span>';
    return '<span class="pill warn">Preventa</span>';
  }
  if (p.available === true) return '<span class="pill ok">En stock</span>';
  if (p.available === false) {
    return /reserva|preventa|pre-?order/i.test(p.title) ? '<span class="pill warn">Reserva</span>' : '<span class="pill no">Agotado</span>';
  }
  return '';
}

function thumb(src, emoji = '🃏') {
  return src
    ? `<img class="thumb" src="${esc(safeUrl(src))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb ph',textContent:'${emoji}'}))">`
    : `<div class="thumb ph">${emoji}</div>`;
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
  const better = others.filter((o) => o.store !== p.store && o.price && o.price < p.price && o.available === true);
  if (!better.length) {
    const n = new Set([p.store, ...others.map((o) => o.store)]).size;
    return n > 1 && p.available === true ? `<div class="hint">✓ Mejor precio con stock entre ${n} tiendas</div>` : '';
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

function productCard(p, when) {
  const deal = dealOf(p);
  return `
  <article class="card tap${deal ? ' deal' : ''}" data-open="${esc(p.id)}" tabindex="0" aria-label="${esc(p.title)}">
    ${thumb(p.image)}
    <div class="body">
      <p class="title">${esc(p.title)}</p>
      <div class="meta">${priceHTML(p)} ${dealPill(p)} ${stockPill(p)} ${salidaPill(p.extra)}</div>
      <div class="meta" style="margin-top:4px">${shopFlag(p.store)}${esc(shopName(p.store))} ${relBadge(p.store)} ${focusPill(p.extra && p.extra.focus)} ${when ? `· ${esc(when)}` : ''}</div>
      ${deal ? `<div class="hint hot">🔥 ${esc(dealText(deal))}</div>` : cheaperHint(p)}
      ${p.category === 'sellado' && p.extra ? valueBlock(p.extra.valor, p.extra.set) : ''}
    </div>
  </article>`;
}

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
function viewNovedades() {
  const D = S.data;
  let html = `<h2 class="section">Novedades</h2>
    ${segmented('seg', [['productos', 'Productos'], ['chollos', '🔥 Chollos'], ['preventas', 'Preventas'], ['noticias', 'Noticias']], S.seg)}`;

  if (S.seg === 'chollos') {
    const deals = D.products.filter((p) => dealOf(p) && langOk(p) && (!S.esOnly || countryOf(p.store) === 'ES'))
      .sort((a, b) => dealOf(b).pct - dealOf(a).pct);
    html += `<p class="lead">Productos sellados <b>con stock</b> claramente por debajo de su precio habitual: un 15 % menos que en Cardmarket o un 10 % menos que en las demás tiendas vigiladas. Te avisamos al momento de cada chollo nuevo.</p>
      <div class="chips">${langSelect()}
        <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
      </div>`;
    html += deals.length
      ? `<div class="list">${deals.slice(0, S.limit).map((p) => productCard(p, '')).join('')}</div>
         ${deals.length > S.limit ? `<p style="text-align:center"><button class="btn ghost" data-more>Ver más (${deals.length - S.limit})</button></p>` : ''}`
      : empty('Ningún chollo ahora mismo', 'Cuando un producto con stock baje claramente de su precio habitual, aparecerá aquí y te llegará un aviso.');
    html += `<p class="muted" style="margin-top:16px">Antes de comprar, revisa los gastos de envío y la valoración de la tienda (en la ficha del producto). Un precio muy por debajo del resto puede ser un error de la tienda.</p>`;
    return html;
  }

  if (S.seg === 'preventas') {
    const pre = D.products.filter((p) => isPre(p) && langOk(p) && (!S.esOnly || countryOf(p.store) === 'ES') && (!S.stockOnly || p.available));
    // primero las que tienen fecha (la más próxima arriba); después el resto, las más recientes primero
    pre.sort((a, b) => {
      const sa = a.extra.salida || '9999', sb = b.extra.salida || '9999';
      return sa.localeCompare(sb) || (b.first_seen || '').localeCompare(a.first_seen || '');
    });
    const withDate = pre.filter((p) => p.extra.salida).length;
    html += `<p class="lead">Productos que todavía no han salido. Te avisamos al momento cuando una tienda abre una preventa o cuando se vuelve a poder reservar.</p>
      <div class="chips">${langSelect()}
        <button class="chip" data-stock aria-pressed="${S.stockOnly}">Solo reservables</button>
        <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
      </div>`;
    html += pre.length
      ? `<h3 class="sub">${pre.length} preventa${pre.length === 1 ? '' : 's'} · ${withDate} con fecha de salida</h3>
         <div class="list">${pre.slice(0, S.limit).map((p) => productCard(p, ago(p.first_seen))).join('')}</div>
         ${pre.length > S.limit ? `<p style="text-align:center"><button class="btn ghost" data-more>Ver más (${pre.length - S.limit})</button></p>` : ''}`
      : empty('Sin preventas abiertas ahora mismo', 'En cuanto una tienda abra una, aparecerá aquí y te llegará un aviso.');
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

  const shops = D.stores.filter((s) => s.products > 0);
  html += `<div class="chips">
      ${CATS.map(([v, l]) => `<button class="chip" data-cat="${esc(v)}" aria-pressed="${v === S.cat}">${esc(l)}</button>`).join('')}
      <button class="chip" data-stock aria-pressed="${S.stockOnly}">Solo en stock</button>
      ${langSelect()}
      <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
      <select class="chip" data-shop aria-label="Tienda">
        <option value="todas">Todas las tiendas</option>
        ${[['España', shops.filter((s) => (s.country || 'ES') === 'ES')], ['Unión Europea', shops.filter((s) => (s.country || 'ES') !== 'ES')]]
          .filter(([, l]) => l.length)
          .map(([g, l]) => `<optgroup label="${g}">${l.sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => `<option value="${esc(s.id)}" ${s.id === S.shop ? 'selected' : ''}>${flag(s.country || 'ES')} ${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}
      </select>
    </div>`;
  const key = (p) => p.created || (p.first_seen === D.seededAt[p.store] ? '' : p.first_seen) || '';
  const items = D.products
    .filter((p) => (S.cat === 'todo' || p.category === S.cat) && (S.shop === 'todas' || p.store === S.shop)
      && (!S.stockOnly || p.available) && (!S.esOnly || countryOf(p.store) === 'ES') && langOk(p))
    .sort((a, b) => key(b).localeCompare(key(a)));
  html += items.length
    ? `<div class="list">${items.slice(0, S.limit).map((p) => productCard(p, ago(key(p)))).join('')}</div>
       ${items.length > S.limit ? `<p style="text-align:center"><button class="btn ghost" data-more>Ver más (${items.length - S.limit})</button></p>` : ''}`
    : empty('Nada por aquí', 'Prueba con otra categoría o tienda.');
  return html;
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
  const terms = fold(q).split(/\s+/).filter(Boolean).map((w) => SYN[w] || [w]);
  const hits = D.products
    .filter((p) => !S.esOnly || countryOf(p.store) === 'ES')
    .filter((p) => { const t = fold(p.title); return terms.every((alts) => alts.some((w) => t.includes(w))); })
    .sort((a, b) => (b.available === true) - (a.available === true) || (a.price ?? 1e9) - (b.price ?? 1e9));
  html += `<h3 class="sub">${hits.length} resultado${hits.length === 1 ? '' : 's'} en tiendas vigiladas</h3>`;
  html += hits.length
    ? `<div class="list">${hits.slice(0, 60).map((p) => productCard(p, '')).join('')}</div>`
    : empty('Sin resultados', 'Prueba con menos palabras o en otro idioma (p. ej. «Destined Rivals» / «Rivales Predestinados»).');
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
  const lead = clockOn
    ? '<p class="lead">⏱️ <b>Reloj puntual activo:</b> el radar revisa todas las tiendas cada 15 minutos y te avisa al iPhone en cuanto aparece algo nuevo.</p>'
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

function viewColecciones() {
  const D = S.data;
  const focus = D.status.focus || [];
  let html = '<h2 class="section">Colecciones vigiladas</h2>';
  if (!focus.length) return html + empty('Ninguna colección vigilada', 'Se añaden en config.toml, en la sección [[focus]].');
  if (!focus.some((f) => f.id === S.focus)) S.focus = focus[0].id;
  const all = D.products.filter((p) => p.extra && p.extra.focus === S.focus);
  const items = all.filter((p) => langOk(p) && (!S.esOnly || countryOf(p.store) === 'ES') && (!S.stockOnly || p.available === true));
  const inStock = all.filter((p) => p.available === true).length;
  html += `${segmented('focus', focus.map((f) => [f.id, f.short || f.name]), S.focus)}
    <p class="lead">Todo lo sellado de <b>${esc(focusName(S.focus))}</b> en ${new Set(all.map((p) => p.store)).size} tiendas: ${all.length} productos, <b>${inStock} con stock</b>. Te avisamos con prioridad de cada novedad, reposición o bajada de precio (desde un 5 %).</p>
    <div class="chips">${langSelect()}
      <button class="chip" data-stock aria-pressed="${S.stockOnly}">Solo con stock</button>
      <button class="chip" data-esonly aria-pressed="${S.esOnly}">${flag('ES')} Solo España</button>
    </div>`;
  const moves = D.events.filter((e) => e.focus === S.focus && e.type !== 'news').slice(0, 4);
  if (moves.length) html += `<h3 class="sub">Últimos movimientos</h3><div class="list">${moves.map(eventCard).join('')}</div>`;
  const byKind = new Map();
  for (const p of items) { const k = kindOf(p); if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(p); }
  let any = false;
  for (const [k, label] of [...KINDS, ['otro', 'Otros']]) {
    const list = byKind.get(k);
    if (!list) continue;
    any = true;
    list.sort((a, b) => (b.available === true) - (a.available === true) || (a.price ?? 1e9) - (b.price ?? 1e9));
    const best = list.find((p) => p.available === true && p.price) || null;
    const open = S.expanded[`${S.focus}:${k}`];
    html += `<h3 class="sub">${esc(label)} · ${list.length}</h3>
      <section class="compare">
        <div class="kind-best">${best ? `Desde <b>${money(best.price)}</b> con stock en ${esc(shopName(best.store))}` : '<span class="muted">Ahora mismo sin stock en ninguna tienda</span>'}</div>
        ${list.slice(0, open ? list.length : 5).map((p) => focusRow(p, best)).join('')}
        ${list.length > 5 && !open ? `<button class="btn ghost more-row" data-expand="${esc(`${S.focus}:${k}`)}">Ver los ${list.length}</button>` : ''}
      </section>`;
  }
  if (!any) html += empty('Nada con estos filtros', 'Prueba con otro idioma o quita «Solo con stock».');
  return html;
}

// ── ficha del producto (se abre al tocar un producto) ─────────────────────
const RAREZA = { SIR: 'Ilustración especial', MHR: 'Mega hiper rara', HR: 'Hiper rara', IR: 'Ilustración rara', SUR: 'Ultra rara variocolor', UR: 'Ultra rara', ACE: 'AS TÁCTICO', SR: 'Rara variocolor', ex: 'Doble rara' };

function offerRow(o, cheapest, current) {
  const best = o.available === true && o.price === cheapest;
  return `<a class="offer ${best ? 'best' : ''}${current ? ' current' : ''}" href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">
    <div class="who">${shopFlag(o.store)}${esc(shopName(o.store))} ${relBadge(o.store)} ${best ? '<span class="badge-best">MEJOR PRECIO</span>' : ''}${current ? '<span class="muted"> · esta</span>' : ''}<small>${esc(o.title)}</small></div>
    <div style="text-align:right"><span class="price">${money(o.price)}</span><br>${stockPill(o)}</div>
  </a>`;
}

function sheetHTML(p) {
  const D = S.data;
  const deal = dealOf(p);
  const v = (p.extra && p.extra.valor) || {};
  const setId = p.extra && p.extra.set;
  const info = setId ? D.sets[setId] : null;
  const m = D.meta[p.store] || {};
  const all = [p, ...sameProduct(p)].filter((o) => o.price)
    .sort((a, b) => (b.available === true) - (a.available === true) || a.price - b.price);
  const cheapest = Math.min(...all.filter((o) => o.available === true).map((o) => o.price), Infinity);
  const cm = `https://www.cardmarket.com/es/Pokemon/Products/Search?searchString=${encodeURIComponent(info ? info.name : p.title)}`;
  let html = `<div class="sheet-top">
      ${thumb(p.image)}
      <div><p class="title">${esc(p.title)}</p>
        <div class="meta">${priceHTML(p)} ${dealPill(p)} ${stockPill(p)} ${salidaPill(p.extra)}</div>
        <div class="meta" style="margin-top:4px">${shopFlag(p.store)}${esc(shopName(p.store))} ${relBadge(p.store)}</div>
      </div>
    </div>`;
  if (deal) html += `<div class="deal-box">🔥 <b>Chollo:</b> ${esc(dealText(deal))}</div>`;
  html += `<div class="actions sheet-actions">
      <a class="btn" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">Ver en ${esc(shopName(p.store))}</a>
      <a class="btn ghost" href="${esc(cm)}" target="_blank" rel="noopener">Cardmarket</a>
    </div>`;
  if (m.trustpilot && m.trustpilot.score) {
    html += `<p class="muted sheet-note">★ ${String(m.trustpilot.score).replace('.', ',')} en Trustpilot (${Number(m.trustpilot.reviews).toLocaleString('es-ES')} reseñas)${m.note ? ` · ${esc(m.note)}` : ''}</p>`;
  } else if (m.note) html += `<p class="muted sheet-note">${esc(m.note)}</p>`;
  if (all.length > 1) {
    html += `<h3 class="sub">En ${new Set(all.map((o) => o.store)).size} tiendas</h3>
      <section class="compare">${all.map((o) => offerRow(o, cheapest, o.id === p.id)).join('')}</section>`;
  }
  if (p.category === 'sellado' && (v.m || v.v)) {
    html += `<h3 class="sub">¿Buen precio? ¿Compensa abrirlo?</h3><div class="panel">`;
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
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.limit = PAGE; store.set('tab', S.tab); render(); window.scrollTo(0, 0); return; }
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
  if (ev.target.matches('[data-lang]')) { S.lang = ev.target.value; S.limit = PAGE; store.set('lang', S.lang); render(); }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'q') { S.query = ev.target.value; updateResults(); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) load(); });

// Sugerencia de instalación en iPhone (Safari, fuera de modo app)
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
if (isIOS && !standalone && store.get('installHint', true)) $('#install-hint').hidden = false;

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
load();
