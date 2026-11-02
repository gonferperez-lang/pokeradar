"""Chollos: productos sellados con stock claramente por debajo de su precio habitual.

Dos referencias:
- Cardmarket (solo ediciones en inglés, ver cardvalue.py): ≥15 % por debajo de su precio.
- Las demás tiendas vigiladas que venden el mismo producto: ≥10 % por debajo de la mediana
  de sus precios (hacen falta al menos 2 tiendas más para que la referencia sea fiable),
  siempre que no sea claramente más caro que en Cardmarket.

Un descuento enorme suele ser un emparejamiento erróneo (o una web dudosa): por encima del
70 % no se considera chollo.
"""
from __future__ import annotations

from statistics import median
from typing import Any

from .models import Product

MARKET_MIN = 0.15
STORES_MIN = 0.10
MIN_SAVING_EUR = 3.0
MAX_PCT = 0.70
MARKET_TOLERANCE = 0.05  # margen sobre Cardmarket (gastos de envío de sus vendedores)
MAX_SPREAD = 2.5      # mismo criterio que las comparativas (analysis.py)
RENOTIFY_DROP = 0.97  # un chollo ya avisado vuelve a avisar solo si baja otro 3 % o más


def usable_groups(groups: list[list[Product]]) -> list[list[Product]]:
    """Descarta los grupos con precios tan dispares que casi seguro mezclan productos distintos."""
    out = []
    for g in groups:
        prices = [p.price for p in g if p.price]
        if prices and max(prices) <= min(prices) * MAX_SPREAD:
            out.append(g)
    return out


def find(products: list[Product], groups: list[list[Product]]) -> dict[str, dict[str, Any]]:
    """{id: {"pct": 0.23, "ref": 77.0, "vs": "cm" | "tiendas", "n": nº de tiendas}}."""
    group_of = {p.id: g for g in usable_groups(groups) for p in g}
    out: dict[str, dict[str, Any]] = {}
    for p in products:
        if (p.kind != "product" or p.category != "sellado" or p.available is not True or not p.price
                or (p.extra or {}).get("unseen")):   # sin confirmar en la última revisión
            continue
        best: dict[str, Any] | None = None
        v = (p.extra or {}).get("valor") or {}
        if v.get("m") and v.get("vm") is not None and -v["vm"] >= MARKET_MIN:
            best = {"pct": round(-v["vm"], 3), "ref": v["m"], "vs": "cm"}
        g = group_of.get(p.id)
        # más barato que otras tiendas pero claramente más caro que Cardmarket: no es un chollo
        pricier_than_market = bool(v.get("m")) and (v.get("vm") or 0) > MARKET_TOLERANCE
        if g and not pricier_than_market:
            per_store: dict[str, float] = {}
            for q in g:
                if q.store != p.store and q.price:
                    per_store[q.store] = min(per_store.get(q.store, q.price), q.price)
            if len(per_store) >= 2:
                ref = median(per_store.values())
                pct = 1 - p.price / ref
                if pct >= STORES_MIN and (best is None or pct > best["pct"]):
                    best = {"pct": round(pct, 3), "ref": round(ref, 2), "vs": "tiendas", "n": len(per_store)}
        if best and best["pct"] <= MAX_PCT and best["ref"] - p.price >= MIN_SAVING_EUR:
            out[p.id] = best
    return out


def describe(ch: dict[str, Any] | None) -> str:
    """Texto corto para el aviso: «🔥 18 % más barato que en otras 5 tiendas (suelen pedir 64,99 €)»."""
    if not ch:
        return ""
    pct = round(ch["pct"] * 100)
    ref = f"{ch['ref']:.2f} €".replace(".", ",")
    if ch["vs"] == "cm":
        return f"🔥 {pct} % más barato que en Cardmarket ({ref})"
    return f"🔥 {pct} % más barato que en otras {ch.get('n', 2)} tiendas (suelen pedir {ref})"
