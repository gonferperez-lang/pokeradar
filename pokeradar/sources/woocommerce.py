"""Tiendas WooCommerce: API pública de la tienda `/wp-json/wc/store/v1/products`.

Además de las novedades (`max_pages`), busca las colecciones vigiladas ([[focus]] → `search`)
para no perder productos antiguos de esas colecciones.
"""
from __future__ import annotations

import html
import re
from typing import Any

from ..filters import categorize, is_relevant
from ..focus import searches
from ..http import PoliteClient
from ..models import Product
from ..preorder import detect as detect_preorder


def fetch(client: PoliteClient, store: dict[str, Any], cfg: dict[str, Any]) -> list[Product]:
    from urllib.parse import quote
    base = store["url"].rstrip("/")
    per_page = int(store.get("per_page", 100))
    out: list[Product] = []
    seen: set[str] = set()
    for page in range(1, int(store.get("max_pages", 2)) + 1):
        items = client.get_json(
            f"{base}/wp-json/wc/store/v1/products?per_page={per_page}&page={page}&orderby=date&order=desc")
        if not isinstance(items, list):
            break
        for prod in _parse(items, store, cfg, base):
            seen.add(prod.id)
            out.append(prod)
        if len(items) < per_page:
            break
    if store.get("focus_search", True):
        for term in searches(cfg):
            items = client.get_json(f"{base}/wp-json/wc/store/v1/products?search={quote(term)}&per_page=50")
            for prod in _parse(items if isinstance(items, list) else [], store, cfg, base):
                if prod.id not in seen and prod.category != "carta suelta":
                    seen.add(prod.id)
                    out.append(prod)
    return out


def _parse(items: list[dict[str, Any]], store: dict[str, Any], cfg: dict[str, Any], base: str) -> list[Product]:
    flt = cfg.get("filters", {})
    out: list[Product] = []
    for p in items:
        name = html.unescape(p.get("name", "")).strip()
        cats = " ".join(c.get("name", "") for c in p.get("categories", []))
        tags = " ".join(t.get("name", "") for t in p.get("tags", []))
        if not is_relevant(f"{name} {cats} {tags}", flt.get("include", []), flt.get("exclude", [])):
            continue
        prices = p.get("prices") or {}
        price = None
        if prices.get("price") not in (None, ""):
            minor = int(prices.get("currency_minor_unit", 2))
            price = int(prices["price"]) / (10 ** minor) or None
        imgs = p.get("images") or []
        stock = p.get("stock_availability") or {}
        flags = " ".join([name, cats, tags, html.unescape(str(stock.get("text", ""))),
                          "available on backorder" if p.get("is_on_backorder")
                          or "backorder" in str(stock.get("class", "")) else ""])
        body = re.sub(r"<[^>]+>", " ", f"{p.get('short_description') or ''} {p.get('description') or ''}")
        out.append(Product(
            id=f"{store['id']}:{p['id']}",
            store=store["id"],
            title=name,
            url=p.get("permalink", base),
            price=price,
            currency=prices.get("currency_code") or cfg["general"].get("currency", "EUR"),
            available=p.get("is_in_stock"),
            image=imgs[0].get("src") if imgs else None,
            created=None,  # la Store API no expone la fecha de alta
            category=categorize(name, cats),
            extra=detect_preorder(flags, html.unescape(body)[:4000]),
        ))
    return out
