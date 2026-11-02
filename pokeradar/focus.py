"""Colecciones vigiladas de cerca ([[focus]] en config.toml), p. ej. 151 y Evoluciones Prismáticas.

Sus productos sellados avisan siempre con prioridad alta: novedades (aunque el producto sea
antiguo), reposiciones y bajadas de precio pequeñas (`focus_drop_pct`, por defecto 5 %).
"""
from __future__ import annotations

import re
from typing import Any

from .filters import fold

_cache: dict[int, list[tuple[str, str, re.Pattern[str]]]] = {}


def compiled(cfg: dict[str, Any]) -> list[tuple[str, str, re.Pattern[str]]]:
    """[(id, nombre, regex)] de las colecciones vigiladas."""
    key = id(cfg.get("focus"))
    if key not in _cache:
        _cache[key] = [(f["id"], f.get("name", f["id"]), re.compile("|".join(f"(?:{m})" for m in f["match"])))
                       for f in cfg.get("focus", []) if f.get("match")]
    return _cache[key]


def match(title: str, cfg: dict[str, Any]) -> str | None:
    """Id de la colección vigilada a la que pertenece el título (o None)."""
    t = fold(title)
    for fid, _, rx in compiled(cfg):
        if rx.search(t):
            return fid
    return None


def names(cfg: dict[str, Any]) -> dict[str, str]:
    return {fid: name for fid, name, _ in compiled(cfg)}


def searches(cfg: dict[str, Any]) -> list[str]:
    """Términos de búsqueda para las tiendas que la permiten (WooCommerce)."""
    return [f["search"] for f in cfg.get("focus", []) if f.get("search")]
