"""PokéRadar · ejecuta una pasada de vigilancia.

    python -m pokeradar                 # vigila, guarda y avisa
    python -m pokeradar --dry-run       # no envía avisos (los muestra en pantalla)
    python -m pokeradar --only cardzone # solo algunas tiendas
    python -m pokeradar --test-notify   # envía un aviso de prueba al iPhone
"""
from __future__ import annotations

import argparse
import inspect
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
import sys
import time
import tomllib
from pathlib import Path
from typing import Any

from . import __version__, analysis, deals, notify
from .cardvalue import CardValue, packs_in
from .http import Blocked, PoliteClient, RateLimited, SourceSkipped
from .filters import matches_any
from .models import now_iso, parse_iso
from .sources import PLATFORMS
from .state import State

ROOT = Path(__file__).resolve().parent.parent
DETECTORS_VERSION = "variantes-1"   # cámbialo al mejorar la detección para re-sembrar sin avisos
# opciones de una tienda que cambian QUÉ productos se leen: si cambian, esa tienda se re-siembra sin avisos
FETCH_KEYS = ("platform", "url", "collection", "collections", "max_pages", "collection_pages", "per_page",
              "feeds", "pokemon_only", "must_include", "must_include_any", "exclude")


def fetch_hash(store: dict[str, Any], cfg: dict[str, Any] | None = None) -> str:
    import hashlib
    import json
    sel = {k: store[k] for k in FETCH_KEYS if k in store}
    if cfg and cfg.get("focus"):   # las colecciones vigiladas también cambian lo que se lee (búsquedas)
        sel["_focus"] = [[f.get("match"), f.get("search")] for f in cfg["focus"]]
    return hashlib.sha1(json.dumps(sel, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]


def topic_fingerprint() -> str:
    """Huella del tema de ntfy para comprobarlo sin publicarlo (los logs de un repo público son visibles)."""
    import hashlib
    topic = (os.environ.get("NTFY_TOPIC") or "").strip()
    if not topic:
        return ""
    digest = hashlib.sha256(topic.encode()).hexdigest()[:8]
    source = os.environ.get("NTFY_TOPIC_SOURCE") or "?"
    return f"Tema configurado en: {source} · {len(topic)} caracteres · huella {digest}."


def local_hhmm(dt: datetime) -> str:
    """Hora de España para los mensajes de la app («19:21»)."""
    try:
        from zoneinfo import ZoneInfo
        return dt.astimezone(ZoneInfo("Europe/Madrid")).strftime("%H:%M")
    except Exception:
        return dt.strftime("%H:%M UTC")


def annotate(level: str, message: str) -> None:
    """Muestra el mensaje en el panel «Annotations» de GitHub Actions (además del log)."""
    print(message, file=sys.stderr if level != "notice" else sys.stdout)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        clean = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::{level} title=PokéRadar::{clean}")


def load_config(path: Path) -> dict[str, Any]:
    with path.open("rb") as f:
        cfg = tomllib.load(f)
    ids = [s["id"] for s in cfg.get("stores", [])]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"IDs de tienda repetidos en la configuración: {', '.join(sorted(dupes))}")
    for s in cfg.get("stores", []):
        if s.get("platform") not in PLATFORMS:
            raise SystemExit(f"Tienda {s.get('id')}: plataforma desconocida '{s.get('platform')}'")
    return cfg


def run(args: argparse.Namespace) -> int:
    cfg = load_config(Path(args.config))
    gen = cfg["general"]
    client = PoliteClient(gen.get("user_agent", f"PokeRadar/{__version__}"),
                          delay=float(gen.get("request_delay_seconds", 2.0)),
                          respect_robots=bool(gen.get("respect_robots_txt", True)))
    store_names = {s["id"]: s["name"] for s in cfg["stores"]}

    if args.test_notify:
        msg = notify.Message(title="✅ PokéRadar conectado",
                             body="Los avisos de novedades Pokémon TCG llegarán aquí.",
                             url="https://www.pokemoncenter.com", tags=["white_check_mark"])
        errs = notify.send([msg], client)
        for err in errs:
            annotate("error", err)
        if not errs:
            annotate("notice", "Aviso de prueba enviado. Si no te llega, revisa que en ntfy estés suscrito "
                               "exactamente al mismo tema que guardaste en NTFY_TOPIC (al valor, no al nombre). "
                               + topic_fingerprint())
        return 1 if errs else 0

    data_dir = Path(args.data_dir or (ROOT / gen.get("data_dir", "docs/data")))
    prev = _read_status(data_dir)
    if args.min_gap:
        # Las pasadas del programador de GitHub son solo de respaldo: si el reloj externo
        # (o el botón «Revisar») acaba de revisar, no se repite el trabajo.
        last = parse_iso(prev.get("generated"))
        if last and datetime.now(timezone.utc) - last < timedelta(minutes=args.min_gap):
            mins = int((datetime.now(timezone.utc) - last).total_seconds() // 60)
            print(f"Ya se revisó hace {mins} min: esta pasada de respaldo no hace falta.")
            return 0
    state = State(data_dir)
    only = set(args.only.split(",")) if args.only else None
    results: list[dict[str, Any]] = []
    all_events: list[dict[str, Any]] = []

    max_pause = float(gen.get("blocked_pause_hours", 12))
    max_ratelimit = float(gen.get("ratelimit_pause_hours", 3))
    now_dt = datetime.now(timezone.utc)
    prev_status = {r["id"]: r for r in prev.get("stores", [])}

    def fetch_store(store: dict[str, Any]) -> tuple[dict[str, Any], list | None]:
        """Descarga una tienda (en paralelo con las demás). No toca el estado compartido."""
        t0 = time.monotonic()
        res: dict[str, Any] = {"id": store["id"], "name": store["name"], "at": now_iso()}
        items = None
        st = state.store_state.get(store["id"], {})
        retry = parse_iso(st.get("retry_after"))
        if retry and "fails" not in st:
            retry = None   # pausa larga del sistema anterior (12 h fijas): se reintenta ya
        if retry and retry > now_dt:
            # La tienda limitó el acceso hace poco: no insistimos hasta que pase la pausa
            res.update(status="blocked", until=retry.isoformat(),
                       message=f"En pausa hasta las {local_hhmm(retry)}: la tienda limita el acceso automático "
                               f"({st.get('reason', 'bloqueo')}). Se reintenta solo.")
            return res, None
        every = int(store.get("every_minutes", 0) or 0)
        last_ok = parse_iso(st.get("last_ok"))
        if every and last_ok and now_dt - last_ok < timedelta(minutes=every - 2):
            # tienda sensible a muchas peticiones: se consulta con menos frecuencia
            old = prev_status.get(store["id"], {})
            res.update(status="ok", at=old.get("at", st.get("last_ok")), items=old.get("items"),
                       events=0, message=f"Se consulta cada {every} min para no saturarla")
            return res, None
        try:
            fetcher = PLATFORMS[store["platform"]]
            kwargs = {"known": state.known(store["id"])} if "known" in inspect.signature(fetcher).parameters else {}
            items = fetcher(client, store, cfg, **kwargs)
            res.update(status="ok", items=len(items))
        except SourceSkipped as e:
            res.update(status="skipped", message=str(e))
        except RateLimited as e:
            res.update(status="blocked", message=str(e), kind="ratelimit",
                       wait=float(getattr(e, "wait_seconds", 0) or 0) / 3600)
        except Blocked as e:
            res.update(status="blocked", message=str(e), kind="blocked")
        except Exception as e:  # una tienda caída no detiene al resto
            res.update(status="error", message=f"{type(e).__name__}: {e}"[:300])
        res["seconds"] = round(time.monotonic() - t0, 1)
        return res, items

    # Si cambian los filtros, productos que ya existían entran por primera vez y parecerían
    # novedades: esa pasada se guarda en silencio.
    import hashlib
    import json as _json
    # (incluye la versión de los detectores: si mejoran, la primera pasada tampoco avisa)
    fhash = hashlib.sha1((_json.dumps(cfg.get("filters", {}), sort_keys=True) + DETECTORS_VERSION)
                         .encode()).hexdigest()[:12]
    silent = state.filters_hash != fhash
    if silent:
        print("Filtros nuevos o modificados: esta pasada actualiza el catálogo sin enviar avisos.")
    state.filters_hash = fhash

    stores = [s for s in cfg["stores"] if not only or s["id"] in only]
    with ThreadPoolExecutor(max_workers=int(gen.get("parallel_stores", 6))) as pool:
        fetched = list(pool.map(fetch_store, stores))

    quiet_stores: set[str] = set()
    for store, (res, items) in zip(stores, fetched):  # fusión en orden, sin hilos
        st = state.store_state.setdefault(store["id"], {})
        kind, wait = res.pop("kind", None), res.pop("wait", 0)
        if kind:
            # pausa progresiva: 1 h, 2 h, 4 h… hasta el máximo (12 h bloqueo, 3 h exceso de peticiones)
            st["fails"] = int(st.get("fails", 0)) + 1
            cap = max_ratelimit if kind == "ratelimit" else max_pause
            hours = max(min(cap, 2 ** (st["fails"] - 1)), wait)
            until = (now_dt + timedelta(hours=hours)).replace(microsecond=0)
            st["retry_after"] = until.isoformat()
            st["reason"] = "demasiadas peticiones" if kind == "ratelimit" else "bloqueo anti-bots"
            res["until"] = st["retry_after"]
            res["message"] = (f"En pausa hasta las {local_hhmm(until)}: la tienda limita el acceso automático "
                              f"({st['reason']}). Se reintenta solo. Detalle: {res.get('message', '')}")[:300]
        elif res["status"] == "ok" and items is not None:
            for k in ("retry_after", "fails", "reason"):
                st.pop(k, None)
            st["last_ok"] = res["at"]
        if items is not None:
            # tienda nueva o que ahora lee otras páginas/colecciones: lo que aparece por primera vez
            # no son novedades, así que esta pasada se guarda sin avisos
            h = fetch_hash(store, cfg)
            quiet = silent or st.get("cfg") != h
            if quiet and not silent:
                print(f"{store['name']}: configuración nueva; esta pasada actualiza su catálogo sin avisos.")
            st["cfg"] = h
            if quiet:
                quiet_stores.add(store["id"])
            events = state.merge(store["id"], items, cfg, silent=quiet)
            all_events += events
            res["events"] = len(events)
        results.append(res)
        print(f"[{res['status']:>7}] {store['name']:<26} "
              f"{res.get('items', '-'):>4} artículos · {res.get('events', 0)} novedades"
              + (f" · {res['message']}" if res.get("message") else ""), flush=True)

    # Las tiendas que no se han consultado esta vez conservan su último estado
    for s in cfg["stores"]:
        if not any(r["id"] == s["id"] for r in results) and s["id"] in prev_status:
            results.append(prev_status[s["id"]])

    state.prune(int(gen.get("forget_after_days", 21)), {s["id"] for s in cfg["stores"]})
    # lo que ahora está excluido por los filtros sale del catálogo ya (no esperar 21 días)
    excl = cfg.get("filters", {}).get("exclude", [])
    state.items = {k: p for k, p in state.items.items() if p.kind != "product" or not matches_any(p.title, excl)}
    groups = analysis.group_offers(state.products(), analysis.default_langs(cfg["stores"]))
    report = analysis.analyse(state.products(), cfg["stores"], groups)

    # Cartas más caras de cada colección y si compensa abrir el producto (precios de Cardmarket vía TCGdex)
    cv_errors: list[str] = []
    cv = None
    if gen.get("card_values", True):
        cv = CardValue(gen.get("user_agent", "PokeRadar"), data_dir,
                       max_refresh=int(gen.get("card_sets_per_run", 8)))
        eu_lang = {s["id"]: "l_en" for s in cfg["stores"] if s.get("country", "ES") != "ES"}
        for e in all_events:  # primero lo que se va a avisar ahora
            if e["type"] != "news" and e.get("category") == "sellado":
                e["valor"] = cv.evaluate(e["title"], e.get("price"), eu_lang.get(e["store"]))
        demand: dict[str, int] = {}
        # colección de cada producto (para el filtro de la app); en las ediciones asiáticas, que no
        # se valoran, se toma la de la colección vigilada (p. ej. 151 japonés → 151)
        focus_set = {f["id"]: f["tcgdex"] for f in cfg.get("focus", []) if f.get("tcgdex")}
        for p in state.products():
            if p.kind != "product":
                continue
            sid = cv.match_set(p.title) or focus_set.get(p.extra.get("focus"))
            if sid:
                p.extra["set"] = sid
                if p.category == "sellado":   # solo lo sellado pide cartas y valor esperado
                    demand[sid] = demand.get(sid, 0) + 1
            else:
                p.extra.pop("set", None)
        for sid, _ in sorted(demand.items(), key=lambda kv: -kv[1]):  # las más demandadas primero
            cv.set_info(sid)
            cv.set_meta(sid)   # logo y fecha de salida para la página de la colección
        for p in state.products():  # resumen compacto para la app: ¿buen precio? ¿compensa abrirlo?
            if p.category != "sellado":
                p.extra.pop("valor", None)
            elif p.extra.get("set"):
                v = cv.evaluate(p.title, p.price, eu_lang.get(p.store)) or {}
                small = {k2: v[k1] for k1, k2 in (("ev", "ev"), ("packs", "n"), ("verdict", "v"),
                                                  ("market", "m"), ("vs_market", "vm")) if v.get(k1) is not None}
                if small:
                    p.extra["valor"] = small
        cv.save()
        cv_errors = cv.errors
        for err in cv_errors[:3]:
            annotate("warning", err)

    eu_lang = {s["id"]: "l_en" for s in cfg["stores"] if s.get("country", "ES") != "ES"}
    for e in mark_deals(state, groups, all_events, silent, quiet_stores):
        if cv:
            e["valor"] = cv.evaluate(e["title"], e.get("price"), eu_lang.get(e["store"]))
        all_events.append(e)

    messages = notify.build(all_events, cfg, store_names)
    notify_errors: list[str] = []
    if messages:
        if args.dry_run:
            for m in messages:
                print(f"  ✉ {m.title} — {m.body.splitlines()[0]}")
        else:
            notify_errors = notify.send(messages, client)
            for err in notify_errors:
                annotate("warning", err)

    n = cfg.get("notifications", {})
    status = {
        "version": __version__,
        "generated": now_iso(),
        "stores": results,
        "events_this_run": len(all_events),
        "notifications_sent": 0 if args.dry_run else len(messages) - len(notify_errors),
        "notify_errors": notify_errors,
        "watchlist": n.get("watchlist", []),
        "categories": n.get("categories", []),
        "region": gen.get("region", "ES"),
        "repo": os.environ.get("GITHUB_REPOSITORY", ""),   # para el botón «Revisar» de la app
        "focus": [{"id": f["id"], "name": f.get("name", f["id"]), "short": f.get("short") or f.get("name", f["id"]),
                   "set": f.get("tcgdex", "")} for f in cfg.get("focus", [])],
        # últimas revisiones y quién las lanzó (reloj externo, GitHub, botón…): la app las muestra
        "history": ([{"at": now_iso(), "by": os.environ.get("POKERADAR_TRIGGER") or "local"}]
                    + [h for h in prev.get("history", []) if isinstance(h, dict)])[:24],
    }
    changed = state.save({"stores.json": report, "status.json": status})
    print(f"{len(all_events)} novedades · {len(messages)} avisos · archivos actualizados: "
          f"{', '.join(changed) or 'ninguno'}")
    return 0


def mark_deals(state: State, groups: list, events: list[dict[str, Any]], silent: bool,
               quiet_stores: set[str] | None = None) -> list[dict[str, Any]]:
    """Marca los chollos (para la app) y devuelve los avisos de chollos nuevos.

    Un chollo se avisa una vez: vuelve a avisar solo si baja otro 3 % o si se agota y regresa.
    Si el producto ya tiene otro aviso en esta pasada (nuevo, repuesto…), se le añade el chollo.
    """
    found, low = deals.scan(state.products(), groups)
    # la app agrupa las ofertas del mismo producto con esta clave
    for p in state.products():
        p.extra.pop("g", None)
    for gi, g in enumerate(deals.usable_groups(groups)):
        for p in g:
            p.extra["g"] = gi
    by_id = {e["id"]: e for e in events if e.get("id")}
    new_events: list[dict[str, Any]] = []
    now = now_iso()
    for p in state.products():
        if p.id in low:   # por debajo de la media (solo para la app, sin aviso)
            p.extra["bajo"] = low[p.id]
        else:
            p.extra.pop("bajo", None)
        ch = found.get(p.id)
        if not ch:
            p.extra.pop("chollo", None)
            if p.available is not True:
                p.extra.pop("chollo_at", None)
            continue
        p.extra["chollo"] = ch
        mark = p.extra.get("chollo_at")
        if mark and p.price >= mark * deals.RENOTIFY_DROP:
            continue  # ya avisado a este precio
        p.extra["chollo_at"] = p.price
        seeded = state.store_state.get(p.store, {}).get("seeded")
        if silent or not seeded or p.store in (quiet_stores or ()):
            continue
        if p.id in by_id:
            by_id[p.id]["chollo"] = ch
        else:
            e = state._event("chollo", p, now)
            e["chollo"] = ch
            new_events.append(e)
    state.events = new_events + state.events
    return new_events


def _read_status(data_dir: Path) -> dict[str, Any]:
    import json
    try:
        return json.loads((data_dir / "status.json").read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pokeradar", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "config.toml"))
    ap.add_argument("--data-dir", help="carpeta de datos (por defecto, la de config.toml)")
    ap.add_argument("--only", help="ids de tienda separados por comas")
    ap.add_argument("--dry-run", action="store_true", help="no envía avisos")
    ap.add_argument("--test-notify", action="store_true", help="envía un aviso de prueba")
    ap.add_argument("--min-gap", type=float, default=0, metavar="MIN",
                    help="no hace nada si la última revisión fue hace menos de MIN minutos")
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
