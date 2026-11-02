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
};
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
  query: '',
  limit: PAGE,
  data: null,
};

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
    const [status, products, news, events, stores, state] = await Promise.all(
      ['status.json', 'products.json', 'news.json', 'events.json', 'stores.json', 'state.json'].map((n) => getJSON(n).catch(() => ({}))),
    );
    const meta = Object.fromEntries((stores.stores || []).map((s) => [s.id, s]));
    const seededAt = Object.fromEntries(Object.entries(state.stores || {}).map(([k, v]) => [k, v.seeded_at]));
    const byProduct = new Map();
    for (const c of stores.comparisons || []) for (const o of c.offers) byProduct.set(o.id, c);
    S.data = {
      status, meta, seededAt, byProduct,
      products: products.items || [], news: news.items || [], events: events.items || [],
      stores: stores.stores || [], comparisons: stores.comparisons || [],
    };
    $('#updated').textContent = status.generated ? `Actualizado ${ago(status.generated)}` : 'Sin datos todavía';
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
  if (p.extra && p.extra.preventa) return '<span class="pill warn">Preventa</span>';
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

function cheaperHint(p) {
  const c = S.data.byProduct.get(p.id);
  if (!c || !p.price) return '';
  const better = c.offers.filter((o) => o.store !== p.store && o.price && o.price < p.price && o.available !== false);
  if (!better.length) {
    return c.offers.length > 1 ? `<div class="hint">✓ Mejor precio entre ${c.offers.length} tiendas</div>` : '';
  }
  const b = better.sort((x, y) => x.price - y.price)[0];
  return `<div class="hint">↓ Más barato en <a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">${esc(shopName(b.store))}: ${money(b.price)}</a></div>`;
}

function productCard(p, when) {
  const price = p.price ? `<span class="price">${money(p.price, p.currency)}${p.prev_price && p.prev_price > p.price ? `<s>${money(p.prev_price, p.currency)}</s>` : ''}</span>` : '';
  return `
  <article class="card">
    <a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" aria-label="${esc(p.title)}">${thumb(p.image)}</a>
    <div class="body">
      <a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><p class="title">${esc(p.title)}</p></a>
      <div class="meta">${price} ${stockPill(p)}</div>
      <div class="meta" style="margin-top:4px">${shopFlag(p.store)}${esc(shopName(p.store))} ${relBadge(p.store)} ${when ? `· ${esc(when)}` : ''}</div>
      ${cheaperHint(p)}
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
  return `
  <a class="card" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener">
    ${thumb(e.image, icon)}
    <div class="body">
      <div class="meta"><span class="pill ${e.type === 'restock' ? 'ok' : e.type === 'price_drop' ? 'warn' : e.type === 'news' ? 'info' : 'accent'}">${icon} ${label}</span> ${esc(ago(e.at))}</div>
      <p class="title" style="margin-top:4px">${esc(e.title)}</p>
      <div class="meta">${price} ${esc(shopName(e.store))}</div>
    </div>
  </a>`;
}

const segmented = (name, options, current) => `
  <div class="segmented" role="group">${options.map(([v, l]) => `<button data-${name}="${esc(v)}" aria-pressed="${v === current}">${esc(l)}</button>`).join('')}</div>`;

const empty = (title, text) => `<div class="empty"><b>${esc(title)}</b>${text}</div>`;

// ── vistas ──────────────────────────────────────────────────────────────────
function viewNovedades() {
  const D = S.data;
  let html = `<h2 class="section">Novedades</h2>
    ${segmented('seg', [['productos', 'Productos'], ['noticias', 'Noticias'], ['historial', 'Avisos']], S.seg)}`;

  if (S.seg === 'noticias') {
    const items = [...D.news].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    html += `<p class="lead">Anuncios de Pokémon Center y de nuevos lanzamientos y preventas.</p>`;
    html += items.length ? `<div class="list">${items.map(newsCard).join('')}</div>`
      : empty('Sin noticias recientes', 'Aparecerán aquí cuando se publiquen.');
    return html;
  }
  if (S.seg === 'historial') {
    html += `<p class="lead">Todo lo que te hemos notificado (y lo que se quedó fuera por tus filtros).</p>`;
    html += D.events.length ? `<div class="list">${D.events.slice(0, 150).map(eventCard).join('')}</div>`
      : empty('Aún no hay avisos', 'La primera pasada solo memoriza el catálogo; a partir de ahí, cada producto nuevo aparecerá aquí y en tu iPhone.');
    return html;
  }

  const shops = D.stores.filter((s) => s.products > 0);
  html += `<div class="chips">
      ${CATS.map(([v, l]) => `<button class="chip" data-cat="${esc(v)}" aria-pressed="${v === S.cat}">${esc(l)}</button>`).join('')}
      <button class="chip" data-stock aria-pressed="${S.stockOnly}">Solo en stock</button>
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
      && (!S.stockOnly || p.available) && (!S.esOnly || countryOf(p.store) === 'ES'))
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
    const map = { ok: ['ok', 'Vigilando'], skipped: ['warn', 'Sin configurar'], blocked: ['no', 'Bloqueada'], error: ['no', 'Error'] };
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

function repoLinks() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return null;
  const repo = location.pathname.split('/').filter(Boolean)[0];
  if (!repo) return null;
  const base = `https://github.com/${m[1]}/${repo}`;
  return { config: `${base}/edit/main/config.toml`, actions: `${base}/actions` };
}

function viewAvisos() {
  const D = S.data;
  const st = D.status || {};
  const links = repoLinks();
  const rows = (st.stores || []).map((s) => {
    const map = { ok: ['ok', 'OK'], skipped: ['warn', 'Omitida'], blocked: ['no', 'Bloqueada'], error: ['no', 'Error'] };
    const [cls, l] = map[s.status] || ['info', s.status];
    const detail = s.status === 'ok' ? `${s.items} artículos · ${s.events} novedades · ${ago(s.at)}` : (s.message || '');
    return `<div class="status-row"><div>${esc(s.name)}<small>${esc(detail)}</small></div><span class="pill ${cls}">${l}</span></div>`;
  }).join('');
  return `<h2 class="section">Avisos</h2>
    <p class="lead">El radar revisa las tiendas varias veces por hora (GitHub no es puntual: el hueco real suele ser de unos 30 minutos) y te envía una notificación al iPhone en cuanto aparece algo nuevo.</p>
    <div class="panel">
      <b>Activar las notificaciones en el iPhone</b>
      <ol>
        <li>Instala la app gratuita <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener"><b>ntfy</b></a> desde el App Store.</li>
        <li>Pulsa <b>+</b> y suscríbete a tu tema privado (el valor de <code>NTFY_TOPIC</code> que guardaste en GitHub).</li>
        <li>Acepta las notificaciones. ¡Listo! Al tocar un aviso se abre el producto.</li>
      </ol>
    </div>
    <h3 class="sub">Te avisamos de</h3>
    <div class="panel">
      <div>Categorías: <span class="tags">${(st.categories || []).map((c) => `<span class="pill info">${esc(c)}</span>`).join('') || '—'}</span></div>
      <div style="margin-top:10px">Siempre con prioridad alta: <span class="tags">${(st.watchlist || []).map((w) => `<span class="pill accent">${esc(w)}</span>`).join('') || '—'}</span></div>
      ${links ? `<p style="margin:12px 0 0"><a class="btn ghost" href="${esc(links.config)}" target="_blank" rel="noopener">Cambiar preferencias</a></p>` : '<p class="muted" style="margin:12px 0 0">Se cambian en <code>config.toml</code>.</p>'}
    </div>
    <h3 class="sub">Última revisión ${st.generated ? `· ${esc(ago(st.generated))}` : ''}</h3>
    <div class="panel">${rows || '<span class="muted">Todavía no se ha ejecutado.</span>'}
      ${(st.notify_errors || []).length ? `<p class="note" style="margin-top:10px">${st.notify_errors.map(esc).join('<br>')}</p>` : ''}
      ${links ? `<p style="margin:12px 0 0"><a class="btn ghost" href="${esc(links.actions)}" target="_blank" rel="noopener">Ver ejecuciones</a></p>` : ''}
    </div>`;
}

// ── render y eventos ───────────────────────────────────────────────────────
const VIEWS = { novedades: viewNovedades, comparar: viewComparar, tiendas: viewTiendas, avisos: viewAvisos };

function render() {
  if (!S.data) return;
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  $('#view').innerHTML = (VIEWS[S.tab] || viewNovedades)();
}

const updateResults = debounce(() => { const r = $('#results'); if (r) r.innerHTML = resultsHTML(); }, 180);

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; S.limit = PAGE; store.set('tab', S.tab); render(); window.scrollTo(0, 0); return; }
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
});
document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-shop]')) { S.shop = ev.target.value; S.limit = PAGE; store.set('shop', S.shop); render(); }
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
