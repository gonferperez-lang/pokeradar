# PokéRadar 📡🃏

Vigila las tiendas de **Pokémon TCG** más baratas y fiables, te enseña dónde está cada producto al mejor precio y te **avisa en el iPhone** en cuanto suben algo nuevo.

- **App para iPhone** (web instalable, se abre como una app normal): novedades, comparador de precios, ranking de tiendas y estado de los avisos.
- **Avisos push** al momento con la app gratuita **ntfy** (y, si quieres, por Telegram).
- **Gratis**: funciona con GitHub Actions (lo intenta cada 15 min; GitHub no es puntual y el hueco real suele ser de unos 30) y GitHub Pages (aloja la app). No necesitas servidor ni ordenador encendido.

| Novedades | Comparar | Tiendas |
|---|---|---|
| Productos recién añadidos, noticias de Pokémon Center y avisos | Mismo producto en varias tiendas, ordenado por precio | Ranking por fiabilidad (Trustpilot) y precio |

---

## ¿Qué tiendas vigila?

**34 fuentes**: Amazon y Pokémon Center (principales), **19 tiendas especializadas en España**, **12 tiendas de la UE que envían a España** y noticias de lanzamientos.

Criterios para que una tienda entre (revisados en noviembre de 2026, sobre más de 170 tiendas de los directorios StockTCG y PokeOfertaTCG):
1. **Vende Pokémon TCG y envía a España.** En las tiendas Shopify se comprueba en la configuración pública de envíos de la propia tienda.
2. **Reseñas positivas verificables en Trustpilot.**
   - Tiendas españolas: nota de 4,0 o más con al menos 10 reseñas.
   - Tiendas de la UE: nota de 4,3 o más con al menos 30 reseñas (comprar fuera tiene más riesgo).
   - Las tiendas sin perfil en Trustpilot se han dejado fuera porque no se pueden verificar.
3. **Publica su catálogo** en un formato público (Shopify, WooCommerce o RSS) y su `robots.txt` lo permite.

| | Tiendas |
|---|---|
| 🇪🇸 **España** | El Duelista · SunnyStore · Graciano Cards · Pokewoke · TodoHits · JJCOLLECTION · Kadoplay · Tiger Cards · El Bazar TCG · Monsters Collectors · Reino de Cartas · Ruta 151 · CardZone · Pokemillon · UNSOBREMAS · La Tienda de las Cartas · Cartadia · Flash Store · The Poke Shop |
| 🇪🇺 **UE** | BaruzCard 🇮🇹 · Beam Card Shop 🇳🇱 · Hikaru Distribution 🇫🇷 · Pikamon 🇳🇱 · Otakura 🇮🇹 · Dracau Games 🇫🇷 · Poke-Geek 🇫🇷 · Bescards 🇳🇱 · CardCosmos 🇩🇪 · Cardverse 🇮🇹 · Universe Cards 🇫🇷 · Templars Arena 🇵🇹 |
| ⭐ **Principales** | Amazon.es (API oficial, opcional) · Pokémon Center (vía noticias) |
| 📰 **Noticias** | PokéBeach (portada) y Bing Noticias: nuevas colecciones, cajas y preventas |

La nota de **fiabilidad** (0-100) sale de Trustpilot ponderado por el número de reseñas: un 4,9 con 74 reseñas pesa menos que un 4,6 con 2.599. La **puntuación** del ranking combina fiabilidad (60 %) y precio (40 %). El precio se mide comparando el mismo producto, en el mismo idioma, entre tiendas, y solo cuenta cuando hay al menos 8 comparaciones.

**Ten en cuenta**
- **Pokémon Center** solo vende online en Europa en Reino Unido y Alemania (sin envío a España según la información disponible). Por eso se vigila con noticias: te enterarás de sus lanzamientos, preventas y colecciones exclusivas.
- **Amazon** retiró en 2026 su API antigua (PA-API 5). La nueva *Creators API* exige una cuenta de **Amazon Afiliados** (afiliados.amazon.es, el programa de comisiones; no tiene nada que ver con Amazon Prime) con la aprobación definitiva. Sin ella, la app te deja un acceso directo a las novedades de Amazon ordenadas por fecha.
- **Flash Store** bloquea su catálogo completo a programas automáticos, pero publica un feed RSS de novedades. Por eso de esta tienda verás sus últimos productos (con precio y stock), no todo su catálogo.
- PokéRadar **respeta el `robots.txt`** de cada web, se identifica como lo que es y no intenta saltarse captchas ni protecciones anti-bot. Si una tienda bloquea el acceso, se hace una pausa de 12 horas antes de reintentarlo.
- **Tiendas de Canarias** (como La Tienda de las Cartas): los envíos a la Península pueden tener trámites de aduana. Revisa plazos y gastos.

---

## Puesta en marcha (unos 10 minutos)

> Lo más cómodo es hacerlo desde un ordenador. Solo hace falta una cuenta gratuita de GitHub.

### 1. Sube el proyecto a GitHub
1. Crea un repositorio **público** llamado `pokeradar` en <https://github.com/new>. Tiene que ser público para que GitHub Pages y las Actions sean gratis.
2. Sube **todo** el contenido de esta carpeta, incluida la carpeta oculta `.github`. Puedes usar `git push` o el botón *Add file → Upload files*.

### 2. Elige tu canal privado de avisos
Inventa un nombre de tema difícil de adivinar, por ejemplo `pokeradar-7f3k9q2xw`. Funciona como una contraseña: quien lo conozca podrá leer tus avisos.

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**
- Nombre: `NTFY_TOPIC` · Valor: tu tema (`pokeradar-7f3k9q2xw`)

### 3. Activa la web
**Settings → Pages → Build and deployment → Source: _GitHub Actions_**

### 4. Prepara el iPhone
1. Instala **ntfy** desde el App Store (gratis).
2. En ntfy pulsa **+**, escribe tu tema y suscríbete. Acepta las notificaciones.

### 5. Primera ejecución
1. En GitHub, ve a **Actions → PokéRadar → Run workflow**, marca *Enviar solo un aviso de prueba* y pulsa *Run*. Te llegará «✅ PokéRadar conectado» al iPhone.
2. Vuelve a lanzar *Run workflow*, esta vez **sin** marcar la casilla. La primera pasada memoriza los catálogos sin avisar. A partir de ahí se ejecuta solo cada 30 minutos y te avisa de cada novedad.

### 6. Instala la app
Abre `https://TU-USUARIO.github.io/pokeradar/` en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.

---

## Personalización (`config.toml`)

Puedes editarlo desde la propia web de GitHub, también en el móvil. Al guardar, el radar se ejecuta y se publica al momento.

- **`[notifications]`**
  - `categories`: qué te avisa (`sellado`, `accesorio`, `carta suelta`).
  - `watchlist`: palabras que siempre avisan con prioridad alta (ETB, Booster Bundle, preventa…).
  - `notify_price_drop_pct`: pon `15`, por ejemplo, para que te avise de bajadas de precio del 15 % o más.
- **`[filters]`**: palabras para incluir o excluir productos.
- **Añadir una tienda**: muchas tiendas usan Shopify o WooCommerce. Para comprobarlo:
  - Shopify: abre `https://latienda.com/products.json`. Si ves texto con `"products"`, añádela con `platform = "shopify"`.
  - WooCommerce: abre `https://latienda.com/wp-json/wc/store/v1/products`. Si ves una lista de productos, añádela con `platform = "woocommerce"`.
  - Rellena `trustpilot = { score = …, reviews = …, url = "…" }` para que puntúe bien en el ranking.

```toml
[[stores]]
id = "mitienda"
name = "Mi Tienda"
platform = "shopify"
url = "https://mitienda.es"
tier = "especializada"
trustpilot = { score = 4.5, reviews = 300, url = "https://es.trustpilot.com/review/mitienda.es" }
```

## Extras opcionales (secrets de GitHub)

| Secret | Para qué |
|---|---|
| `AMAZON_CREDENTIAL_ID`, `AMAZON_CREDENTIAL_SECRET`, `AMAZON_PARTNER_TAG` | Novedades de Amazon.es con la API oficial. Se crean en afiliados.amazon.es → Herramientas → Creators API → *Create Application* → *Create Credential*. El *partner tag* es tu ID de afiliado (termina en `-21`). `AMAZON_CREDENTIAL_VERSION` es opcional: `3.2` por defecto y `2.2` para credenciales antiguas de la UE. **Ponlos solo como secrets de GitHub; no los compartas con nadie.** |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Recibir también los avisos por Telegram (bot creado con @BotFather) |
| `NTFY_SERVER`, `NTFY_TOKEN` | Usar tu propio servidor ntfy o un tema protegido con contraseña |

> El conector de Amazon sigue la documentación pública de la Creators API, pero no se ha podido probar con credenciales reales. Si falla, la app lo mostrará en **Avisos → Última revisión** y el resto de tiendas seguirá funcionando.

## Ejecutarlo en tu ordenador

Necesitas Python 3.11 o superior. No hay que instalar dependencias.

```bash
python3 -m pokeradar --dry-run        # revisa las tiendas sin enviar avisos
NTFY_TOPIC=tu-tema python3 -m pokeradar --test-notify
python3 -m unittest discover -s tests # tests
cd docs && python3 -m http.server     # app en http://localhost:8000
```

## Cómo funciona

```
GitHub Actions (cada 30 min)
  └─ python -m pokeradar
       ├─ sources/shopify.py · woocommerce.py   catálogo público de cada tienda (respetando robots.txt)
       ├─ sources/amazon_creators.py            API oficial de Amazon (opcional)
       ├─ sources/news.py                       RSS de noticias (Pokémon Center, preventas)
       ├─ state.py      detecta novedades, reposiciones y bajadas de precio
       ├─ analysis.py   fiabilidad, índice de precios y comparativas entre tiendas
       └─ notify.py     push al iPhone (ntfy) / Telegram
  └─ guarda docs/data/*.json y publica docs/ en GitHub Pages → app del iPhone
```
