"""Tiendas WooCommerce: API pública de la tienda `/wp-json/wc/store/v1/products`."""
from __future__ import annotations

import html
from typing import Any

from ..filters import categorize, is_relevant
from ..http import PoliteClient
from ..models import Product


def fetch(client: PoliteClient, store: dict[str, Any], cfg: dict[str, Any]) -> list[Product]:
    base = store["url"].rstrip("/")
    flt = cfg.get("filters", {})
    out: list[Product] = []
    per_page = int(store.get("per_page", 100))
    for page in range(1, int(store.get("max_pages", 2)) + 1):
        items = client.get_json(
            f"{base}/wp-json/wc/store/v1/products?per_page={per_page}&page={page}&orderby=date&order=desc")
        if not isinstance(items, list):
            break
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
            ))
        if len(items) < per_page:
            break
    return out
