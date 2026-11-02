"""Tiendas Shopify: catálogo público `/products.json` (ordenado por publicación).

Opciones de la tienda en config.toml:
- `max_pages`: páginas de 250 productos de `/products.json` (las novedades salen en la primera).
- `collection`: leer solo esa colección en vez de todo el catálogo.
- `collections`: colecciones que se leen ENTERAS además de `/products.json` (p. ej. la colección
  «Pokémon» de una tienda grande, para no perder productos antiguos sin descargar toda la tienda).
"""
from __future__ import annotations

import re
from typing import Any

from ..filters import categorize, is_relevant, matches_any
from ..http import PoliteClient
from ..models import Product
from ..preorder import detect as detect_preorder


def fetch(client: PoliteClient, store: dict[str, Any], cfg: dict[str, Any]) -> list[Product]:
    base = store["url"].rstrip("/")
    main = f"/collections/{store['collection']}/products.json" if store.get("collection") else "/products.json"
    sources = [(main, int(store.get("max_pages", 2)))]
    sources += [(f"/collections/{c}/products.json", int(store.get("collection_pages", 4)))
                for c in store.get("collections", [])]
    out: list[Product] = []
    seen: set[str] = set()
    for n, (path, max_pages) in enumerate(sources):
        for page in range(1, max_pages + 1):
            data = client.get_json(f"{base}{path}?limit=250&page={page}")
            items = data.get("products", []) if isinstance(data, dict) else []
            for prod in _parse(items, store, cfg, base):
                # de las colecciones extra solo interesa lo sellado (no cientos de cartas sueltas o gradeadas)
                if n and prod.category == "carta suelta":
                    continue
                if prod.id not in seen:
                    seen.add(prod.id)
                    out.append(prod)
            if len(items) < 250:
                break
    return out


def _parse(items: list[dict[str, Any]], store: dict[str, Any], cfg: dict[str, Any], base: str) -> list[Product]:
    flt = cfg.get("filters", {})
    currency = store.get("currency") or cfg["general"].get("currency", "EUR")
    out: list[Product] = []
    for p in items:
        tags = p.get("tags") or []
        tags = tags if isinstance(tags, list) else str(tags).split(",")
        ptype = p.get("product_type") or ""
        # (el "vendor" no se usa: algunas tiendas ponen su propio nombre, p. ej. "La Tienda Pokémon")
        text = " ".join([p.get("title", ""), ptype, " ".join(tags)])
        # pokemon_only: tienda dedicada a Pokémon cuyos títulos no siempre dicen "Pokémon"
        if store.get("pokemon_only"):
            if matches_any(text, flt.get("exclude", [])):
                continue
        elif not is_relevant(text, flt.get("include", []), flt.get("exclude", [])):
            continue
        variants = p.get("variants") or []
        images = p.get("images") or []
        image = images[0].get("src") if images else None
        title = p.get("title", "").strip()
        base_url = f"{base}/products/{p.get('handle', '')}"
        category = categorize(title, ptype)
        common = dict(store=store["id"], currency=currency, created=p.get("created_at") or p.get("published_at"))
        preorder = detect_preorder(text, re.sub(r"<[^>]+>", " ", p.get("body_html") or "")[:4000])
        named = [v for v in variants if (v.get("title") or "Default Title").strip() != "Default Title"]
        if category == "sellado" and len(named) > 1:
            # Varias versiones (idioma, estado de la caja…) con stock y precio distintos: cada una es una
            # oferta propia y el enlace abre la ficha con esa versión ya elegida. Si no, la app diría
            # «En stock» porque hay inglés aunque la ficha se abra en español agotado.
            for v in named:
                vimg = (v.get("featured_image") or {}).get("src") if isinstance(v.get("featured_image"), dict) else None
                price = float(v["price"]) if v.get("price") not in (None, "") else None
                out.append(Product(
                    id=f"{store['id']}:{p['id']}:{v['id']}",
                    title=f"{title} – {v['title'].strip()}",
                    url=f"{base_url}?variant={v['id']}",
                    price=price or None,
                    available=bool(v["available"]) if "available" in v else None,
                    image=vimg or image,
                    category=category,
                    extra=dict(preorder),
                    **common,
                ))
            continue
        prices = [float(v["price"]) for v in variants if v.get("price") not in (None, "")]
        avail = [bool(v.get("available")) for v in variants if "available" in v]
        price = min(prices) if prices else None
        out.append(Product(
            id=f"{store['id']}:{p['id']}",
            title=title,
            url=base_url,
            price=price if price else None,   # 0,00 € = "sin precio" (p. ej. preventa sin fijar)
            available=any(avail) if avail else None,
            image=image,
            category=category,
            # preventa: título/etiquetas/tipo ("Preventa", "pre-order-Q42026"…) o fecha de salida futura
            extra=preorder,
            **common,
        ))
    return out
