# PokéRadar 📡🃏

Vigila las tiendas de **Pokémon TCG** más baratas y fiables, te enseña dónde está cada producto al mejor precio y te **avisa en el iPhone** en cuanto suben algo nuevo.

- **App para iPhone** (web instalable, se abre como una app normal): novedades, comparador de precios, ranking de tiendas y estado de los avisos.
- **Avisos push** al momento con la app gratuita **ntfy** (y, si quieres, por Telegram).
- **Gratis**: funciona con GitHub Actions y GitHub Pages (aloja la app), con un [reloj propio](#revisión-puntual-cada-15-minutos-reloj) que lo lanza cada 15 minutos. No necesitas servidor ni ordenador encendido.

| Novedades | Colecciones | Comparar | Tiendas | Avisos |
|---|---|---|---|---|
| Portada con el resumen (chollos, bajo la media, preventas, nuevos), productos, ofertas, calendario y noticias | Página de cada expansión: logo, fecha, en cuántas tiendas hay stock, desde cuánto y sus cartas más caras | Buscador que entiende nombres de colección en varios idiomas | Ranking por fiabilidad y precio | Avisos, reloj de 15 min y estado de las tiendas |

---

## ¿Qué tiendas vigila?

**36 fuentes**: Amazon y Pokémon Center (principales), **20 tiendas especializadas en España**, **13 tiendas de la UE que envían a España** y noticias de lanzamientos.

Criterios para que una tienda entre (revisados en noviembre de 2026, sobre más de 170 tiendas de los directorios StockTCG y PokeOfertaTCG):
1. **Vende Pokémon TCG y envía a España.** En las tiendas Shopify se comprueba en la configuración pública de envíos de la propia tienda.
2. **Reseñas positivas verificables en Trustpilot.**
   - Tiendas españolas: nota de 4,0 o más con al menos 10 reseñas.
   - Tiendas de la UE: nota de 4,3 o más con al menos 30 reseñas (comprar fuera tiene más riesgo).
   - Las tiendas sin perfil en Trustpilot se han dejado fuera porque no se pueden verificar. **Única excepción: Universe TCG**, tienda física en Mollet del Vallès (Barcelona) y organizadora oficial de torneos Play! Pokémon; como aún no tiene reseñas, su fiabilidad sale como 50/100.
3. **Publica su catálogo** en un formato público (Shopify, WooCommerce o RSS) y su `robots.txt` lo permite.

| | Tiendas |
|---|---|
| 🇪🇸 **España** | Universe TCG · El Duelista · SunnyStore · Graciano Cards · Pokewoke · TodoHits · JJCOLLECTION · Kadoplay · Tiger Cards · El Bazar TCG · Monsters Collectors · Reino de Cartas · Ruta 151 · CardZone · Pokemillon · UNSOBREMAS · La Tienda de las Cartas · Cartadia · Flash Store · The Poke Shop |
| 🇪🇺 **UE** | BaruzCard 🇮🇹 · Beam Card Shop 🇳🇱 · Hikaru Distribution 🇫🇷 · Pikamon 🇳🇱 · Otakura 🇮🇹 · Dracau Games 🇫🇷 · Poke-Geek 🇫🇷 · Bescards 🇳🇱 · CardCosmos 🇩🇪 · Cardverse 🇮🇹 · Universe Cards 🇫🇷 · Templars Arena 🇵🇹 · CandyCards 🇮🇪 |
| ⭐ **Principales** | Amazon.es (API oficial, opcional) · Pokémon Center (vía noticias) |
| 📰 **Noticias** | PokéBeach (portada): nuevas colecciones, cajas y preventas |

La nota de **fiabilidad** (0-100) sale de Trustpilot ponderado por el número de reseñas: un 4,9 con 74 reseñas pesa menos que un 4,6 con 2.599. La **puntuación** del ranking combina fiabilidad (60 %) y precio (40 %). El precio se mide comparando el mismo producto, en el mismo idioma, entre tiendas, y solo cuenta cuando hay al menos 8 comparaciones.

**Ten en cuenta**
- **Pokémon Center** solo vende online en Europa en Reino Unido y Alemania (sin envío a España según la información disponible). Por eso se vigila con noticias: te enterarás de sus lanzamientos, preventas y colecciones exclusivas.
- **Amazon** retiró en 2026 su API antigua (PA-API 5). La nueva *Creators API* exige una cuenta de **Amazon Afiliados** (afiliados.amazon.es, el programa de comisiones; no tiene nada que ver con Amazon Prime) con la aprobación definitiva. Sin ella, la app te deja un acceso directo a las novedades de Amazon ordenadas por fecha.
- **Flash Store** bloquea su catálogo completo a programas automáticos, pero publica un feed RSS de novedades. Por eso de esta tienda verás sus últimos productos (con precio y stock), no todo su catálogo.
- PokéRadar **respeta el `robots.txt`** de cada web, se identifica como lo que es y no intenta saltarse captchas ni protecciones anti-bot. Si una tienda bloquea el acceso, hace una pausa progresiva (1 h, 2 h, 4 h… hasta 12 h) antes de reintentarlo.
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
2. Vuelve a lanzar *Run workflow*, esta vez **sin** marcar la casilla. La primera pasada memoriza los catálogos sin avisar. A partir de ahí se ejecuta solo y te avisa de cada novedad. Para que sea cada 15 minutos exactos, activa el [reloj](#revisión-puntual-cada-15-minutos-reloj).

### 6. Instala la app
Abre `https://TU-USUARIO.github.io/pokeradar/` en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.

---

## Preventas (productos que aún no han salido)

PokéRadar detecta las preventas de cada tienda aunque cada una las marque de forma distinta:
- En el **título**: «RESERVA», «Précommande», «Pre-order»…
- En las **etiquetas**: «Preventa», «pre-order-Q42026»…
- En el **estado de stock**: «Disponible para reserva».
- Por la **fecha de salida** de la descripción: «Fecha de lanzamiento: 27 de junio de 2026», «Release date: March 27, 2026», «Expédition 06/11/2026», «noviembre de 2026»…

Te avisa **siempre y con prioridad alta** en dos casos:
- 📅 Una tienda abre una **preventa nueva**.
- 🔓 Una preventa que estaba cerrada o agotada **se puede reservar** otra vez.

En la app, **Novedades → Preventas** las ordena por fecha de salida.

Los productos anunciados que todavía no están en ninguna tienda aparecen en **Noticias**, a partir de las presentaciones oficiales que publica PokéBeach.

## ¿Qué cartas trae y es rentable? (en cada aviso y en la app)

Cada producto sellado (ETB, booster bundle, caja de sobres, blíster, lata…) lleva hasta tres datos:

```
💎 Top cartas: Team Rocket's Mewtwo ex (SIR) 403 € · Cynthia's Garchomp ex (SIR) 233 € · Ethan's Ho-Oh ex (SIR) 160 €
🏷️ Cardmarket ~115 € → aquí 13% más caro ⚠️
🎲 Abrirlo: ~38 € de valor esperado en 9 sobres → ❌ no compensa
```

- **💎 Cartas más caras de su colección**, con precios de Cardmarket que se actualizan cada día.
- **🏷️ Precio frente a Cardmarket**: si la tienda lo vende más barato o más caro que el mercado. Solo se calcula para productos en inglés, porque la cotización de Cardmarket corresponde sobre todo a esa edición.
- **🎲 ¿Compensa abrirlo?**: el *valor esperado* de las cartas que salen (precio medio de cada rareza × probabilidad de que salga en un sobre × número de sobres), comparado con lo que cuesta.
  - Es una **estimación**: usa tasas de aparición medias de la era Escarlata y Púrpura / Megaevolución, y cada colección varía.
  - Casi nunca compensa abrir para ganar dinero. Si buscas una carta concreta, suele salir más barato comprarla suelta.

**Fuentes:**
- **Cardmarket:** guía de precios pública y diaria, para el precio de cada carta y de cada producto sellado.
- **TCGdex:** nombres de cada colección en 5 idiomas (para reconocerla en el título) y rareza de cada carta.

**Limitación:** las ediciones japonesas, coreanas y chinas no se valoran, porque sus cartas cotizan aparte.

## 🔥 Chollos

Un **chollo** es un producto sellado **con stock** claramente por debajo de su precio habitual:
- un **15 % o más por debajo de Cardmarket** (solo ediciones en inglés, que es lo que cotiza ahí), o
- un **10 % o más por debajo de lo que piden las demás tiendas vigiladas** por ese mismo producto (mediana de al menos 2 tiendas más), siempre que no sea claramente más caro que en Cardmarket.

Para evitar falsos chollos, se descartan los descuentos de más del 70 % (suelen ser emparejamientos erróneos o webs dudosas) y los ahorros de menos de 3 €.

Cada chollo nuevo te llega como **aviso prioritario** («🔥 Chollo · Tienda»). No se repite cada 15 minutos: solo vuelve a avisar si el precio baja otro 3 % o si se agota y vuelve. En la app los tienes todos en **Novedades → 🔥 Ofertas → Chollos**. Se desactivan con `notify_chollos = false` en `config.toml`.

## 📉 Por debajo de la media

Junto a los chollos, en **Novedades → 🔥 Ofertas → Por debajo de la media** están los productos sellados **con stock** que cuestan menos que el **precio medio de las demás tiendas** que venden ese mismo producto (al menos un 3 % y 1 € menos) o que Cardmarket (un 5 % menos), **sin llegar a chollo**. Son buenas compras, pero no envían aviso al iPhone para no llenarlo de notificaciones.

## La app: qué te enseña de cada producto

- **Veredicto de precio** en cada producto sellado: 🔥 *Chollo*, ↓ *Buena oferta*, = *Precio justo* o ↑ *X % más caro que la media*, con la media de las demás tiendas y el precio de Cardmarket debajo del precio.
- **¿Es buen precio?** (en la ficha): mejor precio con stock ahora, *precio normal* (la mediana de las tiendas) y *la mayoría hasta* (lo que casi ninguna supera). Escribe un precio que hayas visto en otra web y te dice si es bueno, normal o caro.
- **Colecciones**: cada expansión con su logo, fecha de salida, en cuántas tiendas hay stock, el precio más bajo, sus cartas más caras y todos sus productos por tipo (ETB, cajas de sobres, Booster Bundle…). Las vigiladas (151, Prismáticas, 30 Aniversario) aparecen arriba. Si TCGdex aún no tiene el logo de una colección (p. ej. 30 Aniversario), se muestra la foto de su producto estrella y el logo se vuelve a buscar cada semana.
- **Calendario** de lanzamientos y preventas por meses: el mismo producto de varias tiendas sale una sola vez, con en cuántas se puede reservar, desde cuánto, idiomas y un botón para **añadirlo al calendario del iPhone**.
- **⚡ Se acaba de agotar**: lo que se ha quedado sin stock en los últimos días y cuánto duró (por ejemplo, «Se agotó en 25 min»).
- **Vista de lista o de cuadrícula** y un **buscador multilingüe**: «etb prismáticas», «Évolutions Prismatiques» o «30 aniversario» encuentran la colección en todos los idiomas.

## Seguir productos, historial y resumen diario

Ideas tomadas de otras apps del sector (TCGRadar, TCGCompare, PokeRestock, Pack Magik…):
- **👁️ Seguir un producto** (botón *☆ Seguir* en su ficha) con **precio objetivo** opcional: te avisa con prioridad si vuelve a stock o baja de precio **en cualquier tienda** que venda ese mismo producto, y en cuanto alguna lo tenga a tu precio o menos («🎯 Precio objetivo»). La lista está en **Avisos → Siguiendo** y se envía al radar con el token del botón «Revisar» (sin token, se ve solo en la app).
- **📈 Historial de precio** en la ficha: gráfica de los últimos 90 días (las zonas grises son días sin stock), mínimo de 30 días, máximo y cuántas veces se ha repuesto. Se guarda en `docs/data/history.json` desde noviembre de 2026.
- **💸 Bajadas de la semana** (Ofertas → Bajadas): lo que ha bajado al menos un 5 % respecto a lo más caro de los últimos 7 días.
- **🔁 Vuelven a stock**: lo repuesto en las últimas 48 h, junto a «⚡ Se acaba de agotar».
- **Precio por sobre** (€/sobre) en cada producto, orden «Precio por sobre» y, en cada colección, **💡 lo más barato por sobre**.
- **📋 Resumen del día** a las 21:00 (`daily_digest` en `config.toml`): un solo aviso con lo que ha pasado hoy, los mejores chollos y las bajadas.
- **Compartir** un producto (WhatsApp, Mensajes…) desde su ficha.
- La app **se recarga sola** cada pocos minutos y la cabecera dice cuándo toca la siguiente revisión.

## Filtros

En **Productos**, **Ofertas**, **Preventas** y en las búsquedas de **Comparar** puedes filtrar por:
- **Colección** (con su nombre en español: «Evoluciones Prismáticas», «Héroes Ascendentes»…; las ediciones japonesas de las colecciones vigiladas cuentan en su colección);
- **Producto** (Elite Trainer Box, cajas de sobres, Booster Bundle, colecciones premium, latas, blísteres, sobres…);
- **Precio** (hasta 10 €, 10–25 €, 25–50 €… más de 500 €);
- y **ordenar** por precio, descuento o novedad, además de por idioma, tienda, «solo en stock» y «solo España». Los filtros se recuerdan en el iPhone; «✕ Quitar filtros» los borra todos.

## ⭐ Colecciones vigiladas: 151, Evoluciones Prismáticas y 30 Aniversario

Son las colecciones más caras y las que más se revenden, así que se vigilan de cerca en **todas las tiendas**:
- **Cobertura completa:** además de las novedades, se leen enteras las colecciones de 151 y Prismáticas de cada tienda Shopify, y en las tiendas WooCommerce se buscan por nombre. Así no se escapan los productos antiguos, que son los que suben y bajan de precio.
- **Avisos prioritarios** («⭐ 151 · 💸 Baja de precio · Tienda») de cada producto sellado que aparece (aunque sea antiguo), vuelve a tener stock o **baja de precio un 5 % o más** (`focus_drop_pct`).
- **Pestaña Colecciones** en la app: todos sus productos agrupados por tipo (ETB, Booster Bundle, cajas de sobres, colecciones premium, latas…) con el más barato con stock destacado, filtro por idioma y los últimos movimientos.

Incluye las ediciones en todos los idiomas; en japonés, la equivalente a Evoluciones Prismáticas es **Terastal Festival ex** (SV8a). El **30 Aniversario** se reconoce con todos sus nombres: «30th Celebration», «30 Aniversario», «30e Anniversaire», «30° Anniversario», «30. Jubiläum», ME05.5… Se añaden más colecciones en `config.toml`, en la sección `[[focus]]`.

## Ficha de cada producto

Al tocar un producto en la app se abre su ficha:
- el **mismo producto en las demás tiendas**, ordenado por precio y con la fiabilidad de cada una;
- si es un chollo y por qué;
- su precio en **Cardmarket** y si **compensa abrirlo**;
- las **cartas más caras** de su colección.

**¿«En stock» de verdad?** Solo se muestra «En stock» si se puede comprar ahora mismo:
- los productos con **varias versiones** (idioma, estado de la caja, diseño de la lata…) aparecen por separado, cada uno con su precio y stock, y el enlace abre la ficha con esa versión elegida;
- **«Bajo pedido»**: la tienda no tiene unidades pero deja comprar y envía cuando le lleguen (si aún no ha salido, es una preventa y sale como «Preventa · reservable»);
- **«Sin confirmar»**: el producto no aparece en la última revisión de la tienda o la tienda está en pausa, así que no se puede asegurar que siga disponible. La ficha indica cuándo se comprobó el stock por última vez.

En **Productos**, **Chollos** y **Preventas** puedes filtrar por **idioma** (español, inglés o japonés y Asia).

## Botón «Revisar» (revisar las tiendas al momento)

El botón **📡 Revisar** de la app lanza el radar en GitHub sin esperar a la siguiente revisión programada. Tarda 1-2 minutos y después la app se actualiza sola. El botón ⟳ de al lado solo recarga los datos.

Se configura **una sola vez** en el iPhone, desde la pestaña **Avisos → Botón «Revisar»**:
1. Crea un token en GitHub (*Settings → Developer settings → Fine-grained tokens → Generate new token*).
2. En *Repository access* elige **Only select repositories → pokeradar**.
3. En *Permissions → Repository permissions → Actions* elige **Read and write**. No hace falta ningún otro permiso.
4. Pega el token en la app y pulsa **Guardar**.

El token se guarda solo en ese iPhone (no se sube a ningún sitio) y solo sirve para lanzar el radar de este repositorio. Puedes borrarlo con **Quitar token** o revocarlo en GitHub cuando quieras.

## Revisión puntual cada 15 minutos (reloj)

El programador gratuito de GitHub (`schedule`) **no es puntual**: en la práctica se salta muchas ejecuciones y retrasa otras (hay horas con una sola revisión). Por eso el radar lleva su propio reloj, [`reloj.yml`](.github/workflows/reloj.yml), que no necesita servicios externos ni tokens:

1. Cada vuelta del reloj espera 15 minutos en el entorno **reloj** de GitHub. Ese temporizador (*Wait timer*) sí se cumple con puntualidad y no consume minutos.
2. Al terminar la espera, deja programada la siguiente vuelta y lanza la revisión de las tiendas (`monitor.yml`), que arranca en segundos.
3. Si la cadena se rompiera (por ejemplo, por una caída de GitHub), la siguiente revisión que llegue por otra vía (el respaldo de GitHub, el botón «Revisar» o un cambio en la app) la vuelve a poner en marcha.

El programador de GitHub queda como **respaldo**: si el reloj acaba de revisar, sus pasadas terminan en segundos sin hacer nada.

**Si GitHub falla** (como el 5 de noviembre de 2026, cuando un error 502 de su API dejó una vuelta del reloj colgada y la cadena se paró): cada paso del reloj reintenta hasta 3 veces, las vueltas colgadas de más de 25 minutos se ignoran, el vigilante vuelve a arrancar el reloj en la siguiente revisión de respaldo y, si por un fallo hubiera dos cadenas a la vez, la más antigua se detiene sola. La app avisa en **Avisos** si el reloj está parado.

**Activación (una sola vez, 30 segundos):** en GitHub, ve a **Settings → Environments → reloj**, marca **Wait timer**, escribe **15** y pulsa **Save protection rules**. Después pulsa **Revisar** en la app para poner el reloj en marcha. Sin el temporizador, el reloj se detiene solo y avisa (para no lanzar revisiones sin pausa).

**Cómo comprobarlo:** en la app, en **Avisos**, aparece «⏱️ Reloj puntual activo» y la lista de *Últimas revisiones* con la hora de cada una (⏱️ reloj, 👆 botón, 🐢 respaldo de GitHub). En GitHub → Actions, las revisiones del reloj se llaman «Reloj · cada 15 min».

## Conexión con las tiendas (24/7)

El radar revisa todas las tiendas cada 15 minutos, día y noche. Algunas tiendas tienen protecciones que **limitan el acceso automático** cuando reciben muchas peticiones (sobre todo desde los servidores de GitHub). El radar **las respeta y no intenta saltárselas**: se identifica siempre como PokeRadar, cumple su `robots.txt` y, si una tienda le corta el paso:
- hace una **pausa progresiva** (1 h, 2 h, 4 h… hasta 12 h; 1 h, 2 h… hasta 3 h si pide bajar el ritmo) y vuelve a intentarlo solo; al reconectar, el contador vuelve a cero;
- las tiendas más sensibles se consultan con menos frecuencia (`every_minutes`): Flash Store y Graciano Cards cada 30 min y Ruta 151 cada hora.

En la app, **Avisos → Tiendas conectadas** muestra cuántas fuentes están conectadas y, si alguna está en pausa, hasta qué hora. Si una tienda bloquea siempre, lo correcto es pedirle permiso (por ejemplo, que acepte el agente `PokeRadar/1.0`).

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
reloj.yml (cada 15 min) → GitHub Actions   (+ programador de GitHub como respaldo)
  └─ python -m pokeradar
       ├─ sources/shopify.py · woocommerce.py   catálogo público de cada tienda (respetando robots.txt)
       ├─ sources/amazon_creators.py            API oficial de Amazon (opcional)
       ├─ sources/news.py                       RSS de noticias (Pokémon Center, preventas)
       ├─ state.py      detecta novedades, reposiciones y bajadas de precio
       ├─ analysis.py   fiabilidad, índice de precios y comparativas entre tiendas
       └─ notify.py     push al iPhone (ntfy) / Telegram
  └─ guarda docs/data/*.json y publica docs/ en GitHub Pages → app del iPhone
```
