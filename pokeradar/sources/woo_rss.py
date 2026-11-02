"""Tiendas WordPress/WooCommerce que solo publican su feed RSS de productos
(`/feed/?post_type=product`). El feed trae título, enlace y fecha; el precio,
el stock y la imagen se leen de los datos estructurados (schema.org) de la
ficha de cada producto, con un número limitado de fichas por pasada.
"""
from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from typing import Any

from ..filters import categorize, is_relevant, matches_any
from ..http import PoliteClient
from ..models import Product, now_iso, parse_iso
from .news import parse_feed

_LD = re.compile(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', re.S | re.I)
_OG_IMAGE = re.compile(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', re.I)
_TAGS = re.compile(r"<[^>]+>")


def _walk_products(obj: Any):
    if isinstance(obj, dict):
        t = obj.get("@type")
        if t == "Product" or (isinstance(t, list) and "Product" in t):
            yield obj
        for v in obj.values():
            yield from _walk_products(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_products(v)


def parse_product_page(page: str) -> dict[str, Any]:
    """Precio, disponibilidad e imagen desde el JSON-LD schema.org de la ficha."""
    out: dict[str, Any] = {}
    for block in _LD.findall(page):
        try:
            data = json.loads(html.unescape(block.strip()))
        except json.JSONDecodeError:
            continue
        for p in _walk_products(data):
            offers = p.get("offers") or []
            offers = offers if isinstance(offers, list) else [offers]
            for o in offers:
                price = o.get("price") or o.get("lowPrice")
                specs = o.get("priceSpecification") or []
                specs = specs if isinstance(specs, list) else [specs]
                if price is None and specs:
                    price = specs[0].get("price")
                if price not in (None, ""):
                    out["price"] = float(price)
                    out["currency"] = o.get("priceCurrency") or (specs[0].get("priceCurrency") if specs else None)
                avail = str(o.get("availability", ""))
                if avail:
                    out["available"] = avail.endswith(("InStock", "LimitedAvailability", "OnlineOnly"))
                    out["preorder"] = avail.endswith(("PreOrder", "PreSale"))
                if "price" in out:
                    break
            img = p.get("image")
            if isinstance(img, list):
                img = img[0] if img else None
            if isinstance(img, dict):
                img = img.get("url")
            if img and "image" not in out:
                out["image"] = img
        if "price" in out:
            break
    if "image" not in out:
        m = _OG_IMAGE.search(page)
        if m:
            out["image"] = html.unescape(m.group(1))
    return out


def fetch(client: PoliteClient, store: dict[str, Any], cfg: dict[str, Any],
          known: dict[str, Product] | None = None) -> list[Product]:
    base = store["url"].rstrip("/")
    flt = cfg.get("filters", {})
    known = known or {}
    out: list[Product] = []
    for page in range(1, int(store.get("max_pages", 3)) + 1):
        url = f"{base}/feed/?post_type=product" + (f"&paged={page}" if page > 1 else "")
        try:
            body = client.get(url)
        except Exception:
            if page == 1:
                raise
            break  # páginas extra inexistentes → 404
        entries = parse_feed(body) if body.strip() else []
        for e in entries:
            title = e["title"]
            desc = _TAGS.sub(" ", html.unescape(e.get("description") or ""))
            # incluir mirando título + descripción, pero excluir solo por el título
            # (las descripciones de colecciones mencionan "figura", "álbum"…)
            if not store.get("pokemon_only") and not is_relevant(f"{title} {desc}", flt.get("include", []), []):
                continue
            if matches_any(title, flt.get("exclude", [])):
                continue
            pid = f"{store['id']}:{e['link'].rstrip('/').rsplit('/', 1)[-1]}"
            out.append(Product(
                id=pid, store=store["id"], title=title, url=e["link"],
                currency=cfg["general"].get("currency", "EUR"),
                created=e["date"].isoformat() if e["date"] else None,
                category=categorize(title),
            ))
        if len(entries) < 10:
            break

    # Fichas: siempre las nuevas (hasta `details_per_run`) y, en rotación, unas pocas ya conocidas
    budget = int(store.get("details_per_run", 12))
    refresh = int(store.get("refresh_per_run", 3))
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)

    def last_checked(p: Product) -> datetime:
        old = known.get(p.id)
        return (parse_iso(old.extra.get("checked")) if old and old.extra else None) or epoch

    for p in out:  # copia lo ya sabido
        old = known.get(p.id)
        if old:
            p.price, p.available, p.image, p.currency = old.price, old.available, old.image, old.currency
            p.extra = dict(old.extra or {})
    new = [p for p in out if p.id not in known or "checked" not in (known[p.id].extra or {})]
    stale = sorted((p for p in out if p not in new), key=last_checked)[:refresh]
    for p in (new[:budget] + stale):
        try:
            info = parse_product_page(client.get(p.url).decode("utf-8", "replace"))
        except Exception:
            continue  # sin ficha: el producto se avisa igualmente, sin precio
        p.price = info.get("price", p.price)
        p.currency = info.get("currency") or p.currency
        if "available" in info:
            p.available = info["available"]
        p.image = info.get("image") or p.image
        p.extra["checked"] = now_iso()
        if info.get("preorder"):
            p.extra["preventa"] = True
    return out
