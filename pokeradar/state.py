"""Estado persistente (JSON en `docs/data/`) y detección de novedades."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .models import Product, now_iso, parse_iso

MAX_EVENTS = 300


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, data: Any) -> bool:
    """Escribe solo si el contenido cambia (evita commits vacíos)."""
    text = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return True


class State:
    def __init__(self, data_dir: str | Path):
        self.dir = Path(data_dir)
        self.items: dict[str, Product] = {}
        for name in ("products.json", "news.json"):
            for d in _read(self.dir / name, {}).get("items", []):
                p = Product.from_dict(d)
                self.items[p.id] = p
        self.events: list[dict[str, Any]] = _read(self.dir / "events.json", {}).get("items", [])
        self.store_state: dict[str, dict[str, Any]] = _read(self.dir / "state.json", {}).get("stores", {})

    # ── fusión de resultados de una tienda ──────────────────────────────────
    def merge(self, store_id: str, fetched: list[Product], cfg: dict[str, Any]) -> list[dict[str, Any]]:
        gen = cfg["general"]
        notif = cfg.get("notifications", {})
        now = now_iso()
        now_dt = parse_iso(now)
        seeded = self.store_state.get(store_id, {}).get("seeded", False)
        max_age = timedelta(days=int(gen.get("new_max_age_days", 30)))
        drop_pct = float(notif.get("notify_price_drop_pct", 0) or 0)
        events: list[dict[str, Any]] = []

        for p in fetched:
            old = self.items.get(p.id)
            if old:
                p.first_seen = old.first_seen or now
                if p.price != old.price and old.price is not None:
                    p.prev_price = old.price
                else:
                    p.prev_price = old.prev_price
                if p.kind == "product":
                    if old.available is False and p.available is True:
                        events.append(self._event("restock", p, now))
                    elif (drop_pct and old.price and p.price
                          and p.price <= old.price * (1 - drop_pct / 100)):
                        events.append(self._event("price_drop", p, now, old_price=old.price))
            else:
                p.first_seen = now
                created = parse_iso(p.created)
                fresh = created is None or now_dt - created <= max_age
                if seeded and fresh:
                    events.append(self._event("news" if p.kind == "news" else "new", p, now))
            p.last_seen = now
            self.items[p.id] = p

        st = self.store_state.setdefault(store_id, {})
        if not st.get("seeded"):
            st["seeded"] = True
            st["seeded_at"] = now
        self.events = events + self.events
        return events

    @staticmethod
    def _event(kind: str, p: Product, at: str, **extra: Any) -> dict[str, Any]:
        e = {"type": kind, "at": at, "id": p.id, "store": p.store, "title": p.title, "url": p.url,
             "price": p.price, "currency": p.currency, "image": p.image, "category": p.category,
             "available": p.available, "source": p.source}
        e.update(extra)
        return e

    # ── limpieza y guardado ────────────────────────────────────────────────
    def prune(self, forget_after_days: int, active_store_ids: set[str]) -> None:
        limit = datetime.now(timezone.utc) - timedelta(days=forget_after_days)
        self.items = {
            k: p for k, p in self.items.items()
            if p.store in active_store_ids and (parse_iso(p.last_seen) or limit) >= limit
        }
        self.events = [e for e in self.events if e.get("store") in active_store_ids][:MAX_EVENTS]
        self.store_state = {k: v for k, v in self.store_state.items() if k in active_store_ids}

    def products(self) -> list[Product]:
        return [p for p in self.items.values() if p.kind == "product"]

    def news(self) -> list[Product]:
        return [p for p in self.items.values() if p.kind == "news"]

    def save(self, extra_files: dict[str, Any]) -> list[str]:
        def newest(ps: list[Product]) -> list[dict[str, Any]]:
            ps = sorted(ps, key=lambda p: (p.first_seen, p.created or "", p.id), reverse=True)
            return [p.to_dict() for p in ps]

        files: dict[str, Any] = {
            "products.json": {"items": newest(self.products())},
            "news.json": {"items": newest(self.news())},
            "events.json": {"items": self.events},
            "state.json": {"stores": self.store_state},
            **extra_files,
        }
        return [name for name, data in files.items() if _write(self.dir / name, data)]
