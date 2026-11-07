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
OUTLIER = 3.0         # en grupos dispares: fuera lo que esté a más del triple (o un tercio) de la mediana
RENOTIFY_DROP = 0.97  # un chollo ya avisado vuelve a avisar solo si baja otro 3 % o más
# «Por debajo de la media» (sin llegar a chollo; no envía avisos)
LOW_STORES_MIN = 0.03     # ≥3 % por debajo del precio medio de las demás tiendas
LOW_MARKET_MIN = 0.05     # ≥5 % por debajo de Cardmarket
LOW_MIN_SAVING_EUR = 1.0


def usable_groups(groups: list[list[Product]]) -> list[list[Product]]:
    """Grupos fiables del mismo producto en varias tiendas.

    Si los precios son muy dispares, en vez de descartar todo el grupo se quitan los extremos
    (más del triple o menos de un tercio de la mediana: casi siempre otro producto o un error)
    y se usa si siguen quedando al menos dos tiendas con precios coherentes.
    """
    out = []
    for g in groups:
        prices = [p.price for p in g if p.price]
        if not prices:
            continue
        if max(prices) <= min(prices) * MAX_SPREAD:
            out.append(g)
            continue
        mid = median(prices)
        kept = [p for p in g if p.price and mid / OUTLIER <= p.price <= mid * OUTLIER]
        kp = [p.price for p in kept]
        if len({p.store for p in kept}) >= 2 and max(kp) <= min(kp) * MAX_SPREAD * 1.2:
            out.append(kept)
    return out


def find(products: list[Product], groups: list[list[Product]]) -> dict[str, dict[str, Any]]:
    """Chollos: {id: {"pct": 0.23, "ref": 77.0, "vs": "cm" | "tiendas", "n": nº de tiendas}}."""
    return scan(products, groups)[0]


def scan(products: list[Product], groups: list[list[Product]]
         ) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """(chollos, por debajo de la media) de los productos sellados con stock confirmado.

    «Por debajo de la media»: más barato que el precio medio de las demás tiendas (≥3 %) o que
    Cardmarket (≥5 %), sin llegar a chollo.
    """
    group_of = {p.id: g for g in usable_groups(groups) for p in g}
    deals: dict[str, dict[str, Any]] = {}
    low: dict[str, dict[str, Any]] = {}
    for p in products:
        if (p.kind != "product" or p.category != "sellado" or p.available is not True or not p.price
                or (p.extra or {}).get("unseen")):   # sin confirmar en la última revisión
            continue
        v = (p.extra or {}).get("valor") or {}
        market = None
        if v.get("m") and v.get("vm") is not None:
            market = {"pct": round(-v["vm"], 3), "ref": v["m"], "vs": "cm"}
        # más barato que otras tiendas pero claramente más caro que Cardmarket: ni chollo ni rebaja
        pricier_than_market = bool(v.get("m")) and (v.get("vm") or 0) > MARKET_TOLERANCE
        stores_median = stores_mean = None
        g = group_of.get(p.id)
        if g and not pricier_than_market:
            per_store: dict[str, float] = {}
            for q in g:
                if q.store != p.store and q.price:
                    per_store[q.store] = min(per_store.get(q.store, q.price), q.price)
            if len(per_store) >= 2:
                ref = median(per_store.values())
                stores_median = {"pct": round(1 - p.price / ref, 3), "ref": round(ref, 2), "vs": "tiendas",
                                 "n": len(per_store)}
                avg = sum(per_store.values()) / len(per_store)
                stores_mean = {"pct": round(1 - p.price / avg, 3), "ref": round(avg, 2), "vs": "media",
                               "n": len(per_store)}
        # 1) chollo
        cands = [c for c in (market and market["pct"] >= MARKET_MIN and market,
                             stores_median and stores_median["pct"] >= STORES_MIN and stores_median) if c]
        best = max(cands, key=lambda c: c["pct"]) if cands else None
        if best and best["pct"] <= MAX_PCT and best["ref"] - p.price >= MIN_SAVING_EUR:
            deals[p.id] = best
            continue
        # 2) por debajo de la media (sin llegar a chollo)
        cands = [c for c in (market and market["pct"] >= LOW_MARKET_MIN and market,
                             stores_mean and stores_mean["pct"] >= LOW_STORES_MIN and stores_mean) if c]
        best = max(cands, key=lambda c: c["pct"]) if cands else None
        if best and best["pct"] <= MAX_PCT and best["ref"] - p.price >= LOW_MIN_SAVING_EUR:
            low[p.id] = best
    return deals, low


def describe(ch: dict[str, Any] | None) -> str:
    """Texto corto para el aviso: «🔥 18 % más barato que en otras 5 tiendas (suelen pedir 64,99 €)»."""
    if not ch:
        return ""
    pct = round(ch["pct"] * 100)
    ref = f"{ch['ref']:.2f} €".replace(".", ",")
    if ch["vs"] == "cm":
        return f"🔥 {pct} % más barato que en Cardmarket ({ref})"
    return f"🔥 {pct} % más barato que en otras {ch.get('n', 2)} tiendas (suelen pedir {ref})"
