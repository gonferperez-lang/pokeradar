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

from . import __version__, analysis, notify
from .cardvalue import CardValue, packs_in
from .http import Blocked, PoliteClient, RateLimited, SourceSkipped
from .filters import matches_any
from .models import now_iso, parse_iso
from .sources import PLATFORMS
from .state import State

ROOT = Path(__file__).resolve().parent.parent
DETECTORS_VERSION = "preventas-1"   # cámbialo al mejorar la detección para re-sembrar sin avisos


def topic_fingerprint() -> str:
    """Huella del tema de ntfy para comprobarlo sin publicarlo (los logs de un repo público son visibles)."""
    import hashlib
    topic = (os.environ.get("NTFY_TOPIC") or "").strip()
    if not topic:
        return ""
    digest = hashlib.sha256(topic.encode()).hexdigest()[:8]
    source = os.environ.get("NTFY_TOPIC_SOURCE") or "?"
    return f"Tema configurado en: {source} · {len(topic)} caracteres · huella {digest}."


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
    state = State(data_dir)
    only = set(args.only.split(",")) if args.only else None
    results: list[dict[str, Any]] = []
    all_events: list[dict[str, Any]] = []

    pause_hours = float(gen.get("blocked_pause_hours", 12))
    now_dt = datetime.now(timezone.utc)

    def fetch_store(store: dict[str, Any]) -> tuple[dict[str, Any], list | None]:
        """Descarga una tienda (en paralelo con las demás). No toca el estado compartido."""
        t0 = time.monotonic()
        res: dict[str, Any] = {"id": store["id"], "name": store["name"], "at": now_iso()}
        items = None
        retry = parse_iso(state.store_state.get(store["id"], {}).get("retry_after"))
        if retry and retry > now_dt:
            # La tienda nos bloqueó hace poco: no insistimos hasta que pase la pausa
            res.update(status="blocked", message=f"Bloquea el acceso automático; se reintentará "
                                                   f"después de las {retry.strftime('%H:%M')} UTC")
            return res, None
        try:
            fetcher = PLATFORMS[store["platform"]]
            kwargs = {"known": state.known(store["id"])} if "known" in inspect.signature(fetcher).parameters else {}
            items = fetcher(client, store, cfg, **kwargs)
            res.update(status="ok", items=len(items))
        except SourceSkipped as e:
            res.update(status="skipped", message=str(e))
        except RateLimited as e:
            res.update(status="blocked", message=str(e), pause=float(gen.get("ratelimit_pause_hours", 3)))
        except Blocked as e:
            res.update(status="blocked", message=str(e), pause=pause_hours)
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

    for store, (res, items) in zip(stores, fetched):  # fusión en orden, sin hilos
        st = state.store_state.setdefault(store["id"], {})
        pause = res.pop("pause", 0)
        if pause:
            st["retry_after"] = (now_dt + timedelta(hours=pause)).replace(microsecond=0).isoformat()
        elif res["status"] == "ok":
            st.pop("retry_after", None)
        if items is not None:
            events = state.merge(store["id"], items, cfg, silent=silent)
            all_events += events
            res["events"] = len(events)
        results.append(res)
        print(f"[{res['status']:>7}] {store['name']:<26} "
              f"{res.get('items', '-'):>4} artículos · {res.get('events', 0)} novedades"
              + (f" · {res['message']}" if res.get("message") else ""), flush=True)

    # Las tiendas que no se han consultado esta vez conservan su último estado
    prev_status = {r["id"]: r for r in _read_status(data_dir).get("stores", [])}
    for s in cfg["stores"]:
        if not any(r["id"] == s["id"] for r in results) and s["id"] in prev_status:
            results.append(prev_status[s["id"]])

    state.prune(int(gen.get("forget_after_days", 21)), {s["id"] for s in cfg["stores"]})
    # lo que ahora está excluido por los filtros sale del catálogo ya (no esperar 21 días)
    excl = cfg.get("filters", {}).get("exclude", [])
    state.items = {k: p for k, p in state.items.items() if p.kind != "product" or not matches_any(p.title, excl)}
    report = analysis.analyse(state.products(), cfg["stores"])

    # Cartas más caras de cada colección y si compensa abrir el producto (precios de Cardmarket vía TCGdex)
    cv_errors: list[str] = []
    if gen.get("card_values", True):
        cv = CardValue(gen.get("user_agent", "PokeRadar"), data_dir,
                       max_refresh=int(gen.get("card_sets_per_run", 8)))
        eu_lang = {s["id"]: "l_en" for s in cfg["stores"] if s.get("country", "ES") != "ES"}
        for e in all_events:  # primero lo que se va a avisar ahora
            if e["type"] != "news" and e.get("category") == "sellado":
                e["valor"] = cv.evaluate(e["title"], e.get("price"), eu_lang.get(e["store"]))
        demand: dict[str, int] = {}
        for p in state.products():  # la app: colección y nº de sobres de cada producto sellado
            if p.category != "sellado":
                continue
            sid = cv.match_set(p.title)
            if sid:
                p.extra["set"] = sid
                demand[sid] = demand.get(sid, 0) + 1
        for sid, _ in sorted(demand.items(), key=lambda kv: -kv[1]):  # las más demandadas primero
            cv.set_info(sid)
        for p in state.products():  # resumen compacto para la app: ¿buen precio? ¿compensa abrirlo?
            if p.extra.get("set"):
                v = cv.evaluate(p.title, p.price, eu_lang.get(p.store)) or {}
                small = {k2: v[k1] for k1, k2 in (("ev", "ev"), ("packs", "n"), ("verdict", "v"),
                                                  ("market", "m"), ("vs_market", "vm")) if v.get(k1) is not None}
                if small:
                    p.extra["valor"] = small
        cv.save()
        cv_errors = cv.errors
        for err in cv_errors[:3]:
            annotate("warning", err)

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
    }
    changed = state.save({"stores.json": report, "status.json": status})
    print(f"{len(all_events)} novedades · {len(messages)} avisos · archivos actualizados: "
          f"{', '.join(changed) or 'ninguno'}")
    return 0


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
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
