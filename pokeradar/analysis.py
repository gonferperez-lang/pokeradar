"""Fiabilidad de cada tienda, índice de precios y comparativas entre tiendas."""
from __future__ import annotations

import math
from collections import defaultdict
from statistics import median
from typing import Any

from .filters import match_tokens, similarity
from .models import Product

TIER_BASE = {"oficial": 95, "gran_retailer": 85}
NEUTRAL_PRIOR = 60  # puntuación de una tienda sin historial conocido
MATCH_THRESHOLD = 0.72
MIN_MATCHES_FOR_SCORE = 8   # comparaciones mínimas para que el precio cuente en la puntuación
MAX_SPREAD = 2.5   # si el mismo "producto" cuesta 2,5× más en otra tienda, casi seguro es un emparejamiento erróneo
RATIO_CAP = 2.0


def reliability(store: dict[str, Any]) -> int | None:
    """0-100. Oficial/gran superficie: base fija. Resto: Trustpilot ponderado por nº de reseñas."""
    tier = store.get("tier", "")
    if tier == "noticias":
        return None
    if tier in TIER_BASE:
        return TIER_BASE[tier]
    tp = store.get("trustpilot") or {}
    score, reviews = float(tp.get("score") or 0), int(tp.get("reviews") or 0)
    if not score or not reviews:
        return NEUTRAL_PRIOR - 10
    confidence = min(1.0, math.log10(reviews + 1) / 3)  # ~1000 reseñas → confianza plena
    return round(score / 5 * 100 * confidence + NEUTRAL_PRIOR * (1 - confidence))


def group_offers(products: list[Product], default_lang: dict[str, str] | None = None) -> list[list[Product]]:
    """Agrupa el mismo producto en distintas tiendas (coincidencia aproximada por título).

    `default_lang`: idioma que se asume cuando el título no lo dice (p. ej. tiendas de la UE → inglés),
    para no comparar una edición en español con una en inglés.
    """
    default_lang = default_lang or {}
    candidates = [p for p in products if p.category == "sellado" and p.price]
    groups: list[tuple[frozenset[str], list[Product], set[str]]] = []
    index: dict[str, list[int]] = defaultdict(list)  # palabra → grupos que la contienen
    for p in sorted(candidates, key=lambda x: x.title):
        tok = match_tokens(p.title)
        langs = {w for w in tok if w.startswith("l_")}
        if not langs and default_lang.get(p.store):
            langs = {default_lang[p.store]}
            tok = tok | langs
        words = [w for w in tok if not w.startswith(("t_", "l_"))]
        seen: set[int] = set()
        best, best_sim = None, MATCH_THRESHOLD
        for w in words:
            for gi in index.get(w, ()):
                if gi in seen:
                    continue
                seen.add(gi)
                g_tok, _, g_langs = groups[gi]
                if langs and g_langs and not (langs & g_langs):
                    continue  # el grupo ya tiene otro idioma
                s = similarity(tok, g_tok)
                if s >= best_sim:
                    best, best_sim = gi, s
        if best is None:
            groups.append((tok, [p], set(langs)))
            for w in words:
                index[w].append(len(groups) - 1)
        else:
            groups[best][1].append(p)
            groups[best][2].update(langs)
    return [g for _, g, _ in groups if len({p.store for p in g}) >= 2]


def default_langs(stores: list[dict[str, Any]]) -> dict[str, str]:
    """Tiendas de fuera de España: si el título no indica idioma, se asume inglés."""
    return {s["id"]: s.get("default_lang", "l_en") for s in stores if s.get("country", "ES") != "ES"}


def analyse(products: list[Product], stores: list[dict[str, Any]],
            groups: list[list[Product]] | None = None) -> dict[str, Any]:
    if groups is None:
        groups = group_offers(products, default_langs(stores))
    ratios: dict[str, list[float]] = defaultdict(list)
    comparisons = []
    for g in groups:
        by_store: dict[str, Product] = {}
        for p in g:
            if p.store not in by_store or (p.price or 0) < (by_store[p.store].price or 0):
                by_store[p.store] = p
        offers = sorted(by_store.values(), key=lambda p: (p.available is False, p.price or 0))
        cheapest = min(p.price or 0 for p in offers)
        if max(p.price or 0 for p in offers) > cheapest * MAX_SPREAD:
            continue
        for p in offers:
            ratios[p.store].append(min(RATIO_CAP, (p.price or 0) / cheapest))
        comparisons.append({
            "title": offers[0].title,
            "saving": round(max(p.price or 0 for p in offers) - cheapest, 2),
            "offers": [{"store": p.store, "id": p.id, "title": p.title, "price": p.price,
                        "available": p.available, "url": p.url, "image": p.image} for p in offers],
        })
    comparisons.sort(key=lambda c: (any(o["available"] for o in c["offers"]),
                                    len(c["offers"]), c["saving"]), reverse=True)

    counts: dict[str, int] = defaultdict(int)
    for p in products:
        counts[p.store] += 1

    meta = []
    for s in stores:
        rel = reliability(s)
        n = len(ratios[s["id"]])
        idx = round(median(ratios[s["id"]]), 3) if n >= 3 else None
        # con pocas comparaciones el precio se muestra, pero no cuenta en la puntuación
        price_score = None if idx is None or n < MIN_MATCHES_FOR_SCORE else max(0.0, min(100.0, 100 - (idx - 1) * 250))
        if rel is None:
            rank = None
        elif price_score is None:
            rank = rel
        else:
            rank = round(rel * 0.6 + price_score * 0.4)
        meta.append({
            "id": s["id"], "name": s["name"], "url": s["url"], "platform": s["platform"],
            "tier": s.get("tier", ""), "note": s.get("note", ""), "trustpilot": s.get("trustpilot", {}),
            "country": s.get("country", "ES"), "city": s.get("city", ""),
            "reliability": rel, "price_index": idx, "matched": len(ratios[s["id"]]),
            "products": counts[s["id"]], "score": rank,
        })
    meta.sort(key=lambda m: (m["score"] is None, -(m["score"] or 0)))
    return {"stores": meta, "comparisons": comparisons[:80]}
