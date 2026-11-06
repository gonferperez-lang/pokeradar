"""Cartas más caras de cada colección y si compensa comprar / abrir un producto sellado.

Fuentes (gratuitas y públicas):
- Cardmarket: guía de precios diaria que publica en abierto
  (downloads.s3.cardmarket.com/productCatalog/…): precio de cada carta suelta y de
  cada producto sellado (EUR).
- TCGdex (api.tcgdex.net): nombres de cada colección en 5 idiomas (para reconocerla
  en el título del producto) y rareza de cada carta. Su robots.txt bloquea a
  rastreadores web pero indica expresamente que la API se puede usar desde programas.

"¿Es rentable?" se responde de dos formas:
  1. Precio: lo que pide la tienda frente al precio de ese producto en Cardmarket.
  2. Abrirlo: valor esperado de las cartas que salen (precio medio de cada rareza ×
     probabilidad de que salga en un sobre × nº de sobres) frente a lo que cuesta.
     Es una estimación: las tasas de aparición son medias de la era Escarlata y
     Púrpura / Megaevolución y cada colección varía.
"""
from __future__ import annotations

import json
import re
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .filters import fold, match_tokens
from .http import PoliteClient

TCGDEX = "https://api.tcgdex.net/v2"
CARDMARKET = "https://downloads.s3.cardmarket.com/productCatalog"
LANGS = ("en", "es", "fr", "it", "de")

# Probabilidad media de que salga una carta de cada rareza en un sobre (inglés, 2023-2026).
# El orden es de más rara a menos rara (sirve para emparejar versiones de una misma carta).
PULL_RATES = {
    "mega hyper rare": 1 / 600,
    "hyper rare": 1 / 90,
    "special illustration rare": 1 / 45,
    "shiny ultra rare": 1 / 15,
    "illustration rare": 1 / 12,
    "ultra rare": 1 / 15,
    "ace spec rare": 1 / 20,
    "shiny rare": 1 / 6,
    "double rare": 1 / 5.5,
}
BASE_PACK_VALUE = 0.40   # comunes, infrecuentes, reversos y raras normales de un sobre (≈)
RARITY_SHORT = {"special illustration rare": "SIR", "illustration rare": "IR", "hyper rare": "HR",
                "mega hyper rare": "MHR", "ultra rare": "UR", "double rare": "ex", "ace spec rare": "ACE",
                "shiny rare": "Shiny", "shiny ultra rare": "Shiny UR"}

# Nombres de colección demasiado genéricos (coinciden con el nombre de la serie entera)
GENERIC = {"mega evolution", "megaevolucion", "mega evolution", "megaevoluzione", "mega entwicklung",
           "scarlet & violet", "escarlata y purpura", "ecarlate et violet", "scarlatto e violetto",
           "karmesin & purpur", "sword & shield", "espada y escudo"}
EXTRA_ALIASES = {  # cómo lo escriben las tiendas cuando difiere del nombre oficial
    "30th": ["30th celebration", "celebracion 30", "30 aniversario", "30th anniversary",
             "30e anniversaire", "30 anniversario", "30o aniversario"],
}
ASIAN = {"l_jp", "l_kr", "l_cn"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9& ]+", " ", fold(s))).strip()


def _base_name(cm_name: str) -> str:
    """'Mega Darkrai ex [Dusk Raid | Abyss Eye]' → 'mega darkrai ex'."""
    return _norm(cm_name.split(" [")[0].split(" (")[0])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def packs_in(title: str) -> int | None:
    """Sobres que trae un producto sellado (None si no se puede saber con seguridad)."""
    t = fold(title)
    if re.search(r"\bcase\b|\bpremium\b|\bposter\b|\bbinder\b|\bcolecci|\bcollection\b|checklane"
                 r"|\bevento\b|\btorneo\b|fun pack|\b3 cartas\b|\b3 cards\b|mini sobre", t):
        return None  # contenidos variables: mejor no inventar
    if "display" in t and re.search(r"\btins?\b|\blatas?\b|blister|sticker|frame|\bcoin", t):
        return None  # expositor de otros productos (p. ej. "Mini Tin Display – 10 Mini Tins")
    tok = match_tokens(title)
    for w in tok:
        if w.startswith("t_q") and w[3:].isdigit():
            return int(w[3:])
    if "t_etb" in tok:
        return 9
    if "t_bundle" in tok:
        return 6
    if "t_display" in tok:
        return 18 if re.search(r"\bhalf\b|\b18 sobres\b|\bmedia\b", t) else 36
    if "t_blister3" in tok:
        return 3
    if "t_blister2" in tok:
        return 2
    if "t_tin" in tok:
        return 2 if "mini" in t else 3
    if "t_blister" in tok or "t_sobre" in tok:
        return 1
    return None


def _sealed_kind(name: str, set_name: str) -> str | None:
    """Tipo de un producto sellado de Cardmarket (solo los productos estándar, por su nombre exacto:
    «<colección> Elite Trainer Box», «<colección> Booster»… — no cajas de Pokémon Center, monedas, cases…)."""
    n, s = _norm(name), _norm(set_name)
    n = n[len("pokemon "):] if n.startswith("pokemon ") and not s.startswith("pokemon") else n
    exact = {f"{s} elite trainer box": "etb", f"{s} booster bundle": "bundle",
             f"{s} booster box": "display", f"{s} booster": "sobre"}
    if n in exact:
        return exact[n]
    if n.startswith(s) and "3 pack blister" in n:
        return "blister3"
    return None


def _product_kind(title: str) -> str | None:
    if packs_in(title) is None:
        return None  # mismo criterio: si no está claro qué es, no se compara
    tok = match_tokens(title)
    if "t_etb" in tok:
        return "etb"
    if "t_bundle" in tok:
        return "bundle"
    if "t_display" in tok:
        return "display"
    if "t_blister3" in tok:
        return "blister3"
    if "t_sobre" in tok and "t_blister" not in tok and not any(w.startswith("t_q") for w in tok):
        return "sobre"
    return None


class CardValue:
    def __init__(self, user_agent: str, data_dir: str | Path, max_refresh: int = 8,
                 ttl_hours: float = 24, client: PoliteClient | None = None):
        # TCGdex y los archivos de Cardmarket son para descargar desde programas (ver docstring)
        self.client = client or PoliteClient(user_agent, delay=0.25, timeout=90, respect_robots=False)
        self.path = Path(data_dir) / "sets.json"
        self.ttl = timedelta(hours=ttl_hours)
        self.budget = max_refresh            # colecciones cuyas rarezas se piden a TCGdex por pasada
        try:
            self.cache: dict[str, Any] = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            self.cache = {}
        self.cache.setdefault("sets", {})
        self.errors: list[str] = []
        self._rx: re.Pattern[str] | None = None
        self._memo: dict[str, str | None] = {}
        self._cm: dict[str, Any] | None = None   # datos de Cardmarket (solo en memoria)

    # ── nombres de colección → id ──────────────────────────────────────────
    def _aliases(self) -> dict[str, str]:
        upd = self.cache.get("aliases_updated")
        if not upd or _now() - datetime.fromisoformat(upd) > timedelta(days=7) or "names_es" not in self.cache:
            aliases: dict[str, str] = {}
            names_en: dict[str, str] = {}
            names_es: dict[str, str] = {}   # para mostrar las colecciones en español en la app
            try:
                for lang in LANGS:
                    for s in self.client.get_json(f"{TCGDEX}/{lang}/sets", check_robots=False):
                        a = _norm(s.get("name", ""))
                        if lang == "en":
                            names_en[s["id"]] = s.get("name", "")
                        elif lang == "es" and s.get("name"):
                            names_es[s["id"]] = s["name"]
                        if a and (len(a) >= 5 or a.isdigit()) and "promo" not in a:
                            aliases.setdefault(a, s["id"])
                for sid, names in EXTRA_ALIASES.items():
                    for n in names:
                        aliases[_norm(n)] = sid
                self.cache.update(aliases=aliases, names_en=names_en, names_es=names_es,
                                  aliases_updated=_now().replace(microsecond=0).isoformat())
            except Exception as e:  # sin conexión: se usa lo guardado
                self.errors.append(f"TCGdex (colecciones): {e}")
        return self.cache.get("aliases", {})

    def match_set(self, title: str) -> str | None:
        if title in self._memo:
            return self._memo[title]
        result = None
        aliases = self._aliases()
        if aliases and not (match_tokens(title) & ASIAN):  # ediciones asiáticas: sin datos fiables
            if self._rx is None:  # una sola expresión con todos los nombres (los largos primero)
                alts = "|".join(re.escape(a) for a in sorted(aliases, key=len, reverse=True))
                self._rx = re.compile(rf"(?<![a-z0-9])(?:{alts})(?![a-z0-9])")
            found = [m.group(0) for m in self._rx.finditer(_norm(title))]
            specific = [a for a in found if a not in GENERIC] or found
            if specific:
                result = aliases[max(specific, key=len)]
        self._memo[title] = result
        return result

    # ── datos de Cardmarket (una descarga para todas las colecciones) ─────
    def _cardmarket(self) -> dict[str, Any] | None:
        if self._cm is None:
            try:
                pg = self.client.get_json(f"{CARDMARKET}/priceGuide/price_guide_6.json", check_robots=False)
                singles = self.client.get_json(f"{CARDMARKET}/productList/products_singles_6.json", check_robots=False)
                sealed = self.client.get_json(f"{CARDMARKET}/productList/products_nonsingles_6.json", check_robots=False)
                price = {g["idProduct"]: (g.get("trend") or g.get("avg7") or g.get("avg") or 0)
                         for g in pg.get("priceGuides", [])}
                by_exp: dict[int, list[tuple[str, float]]] = {}
                for p in singles.get("products", []):
                    if price.get(p["idProduct"]):
                        by_exp.setdefault(p["idExpansion"], []).append((p["name"], float(price[p["idProduct"]])))
                sealed_l = [(p["name"], p["idExpansion"], float(price.get(p["idProduct"]) or 0))
                            for p in sealed.get("products", [])]
                self._cm = {"singles": by_exp, "sealed": sealed_l}
            except Exception as e:
                self.errors.append(f"Cardmarket (guía de precios): {e}")
                self._cm = {}
        return self._cm or None

    def _expansion_id(self, set_name: str, cm: dict[str, Any]) -> int | None:
        """La expansión de Cardmarket es la de los sellados que llevan el nombre de la colección."""
        n = _norm(set_name)
        if not n:
            return None
        rx = re.compile(rf"^(?:pokemon )?{re.escape(n)}(?![a-z0-9])")
        counts: dict[int, int] = {}
        for name, exp, _ in cm["sealed"]:
            if rx.search(_norm(name)):
                counts[exp] = counts.get(exp, 0) + 1
        return max(counts, key=counts.get) if counts else None

    def _rarities(self, set_id: str) -> dict[str, list[str]] | None:
        """{rareza: [nombres]} de TCGdex (no cambia: se guarda y se reutiliza).
        None = todavía sin consultar (se ha agotado el presupuesto de esta pasada)."""
        info = self.cache["sets"].get(set_id) or {}
        if info.get("rarities") is not None:
            return info["rarities"]
        if self.budget <= 0:
            return None
        self.budget -= 1
        out: dict[str, list[str]] = {}
        try:
            for r in PULL_RATES:
                label = r.capitalize() if r not in ("ace spec rare", "mega hyper rare", "ultra rare", "shiny ultra rare") \
                    else {"ace spec rare": "ACE SPEC Rare", "mega hyper rare": "Mega Hyper Rare",
                          "ultra rare": "Ultra Rare", "shiny ultra rare": "Shiny Ultra Rare"}[r]
                cards = self.client.get_json(
                    f"{TCGDEX}/en/cards?set.id=eq:{quote(set_id)}&rarity=eq:{quote(label)}", check_robots=False)
                if isinstance(cards, list) and cards:
                    out[r] = [c.get("name", "") for c in cards]
        except Exception as e:
            self.errors.append(f"TCGdex (rarezas de {set_id}): {e}")
            return None
        return out

    def set_info(self, set_id: str) -> dict[str, Any] | None:
        info = self.cache["sets"].get(set_id)
        if info and _now() - datetime.fromisoformat(info["updated"]) <= self.ttl and info.get("rarities") is not None:
            return info
        cm = self._cardmarket()
        if not cm:
            return info
        self._aliases()
        name = self.cache.get("names_en", {}).get(set_id, "")
        exp = self._expansion_id(name, cm)
        fetched = self._rarities(set_id)
        rarities = fetched or {}
        new: dict[str, Any] = {"name": name, "updated": _now().replace(microsecond=0).isoformat(),
                               "cm_expansion": exp, "top": [], "ev_pack": None, "sealed": {}}
        if fetched is not None:
            new["rarities"] = fetched
        if exp is not None:
            singles = sorted(cm["singles"].get(exp, []), key=lambda x: -x[1])
            # emparejar cada versión de una carta con su rareza: la más cara ↔ la más rara
            by_name: dict[str, list[float]] = {}
            for n, p in singles:
                by_name.setdefault(_base_name(n), []).append(p)
            # varias versiones de una misma carta: la más cara suele ser la ilustración especial,
            # después la Mega Hyper / dorada, etc. (orden según los precios reales de 2025-2026)
            order = ["special illustration rare", "mega hyper rare", "hyper rare", "illustration rare",
                     "shiny ultra rare", "ultra rare", "ace spec rare", "shiny rare", "double rare"]
            rank = {r: i for i, r in enumerate(order)}
            wanted: dict[str, list[str]] = {}
            for r, names in rarities.items():
                for n in names:
                    wanted.setdefault(_norm(n), []).append(r)
            tier_prices: dict[str, list[float]] = {}
            label: dict[tuple[str, float], str] = {}
            for n, rs in wanted.items():
                prices = by_name.get(n, [])
                for r, p in zip(sorted(rs, key=lambda x: rank[x]), prices):
                    tier_prices.setdefault(r, []).append(p)
                    label[(n, p)] = r
            if tier_prices:
                new["ev_pack"] = round(BASE_PACK_VALUE + sum(
                    PULL_RATES[r] * statistics.mean(v) for r, v in tier_prices.items()), 2)
            seen: set[str] = set()
            for n, p in singles:  # top de cartas (una por nombre)
                b = _base_name(n)
                if b in seen:
                    continue
                seen.add(b)
                r = label.get((b, p), "")
                new["top"].append({"name": n.split(" [")[0], "price": round(p, 2), "r": RARITY_SHORT.get(r, "")})
                if len(new["top"]) == 6:
                    break
            kinds: dict[str, list[float]] = {}
            for sname, sexp, sp in cm["sealed"]:
                k = _sealed_kind(sname, name) if sexp == exp and sp else None
                if k:
                    kinds.setdefault(k, []).append(sp)
            new["sealed"] = {k: round(statistics.median(v), 2) for k, v in kinds.items()}
        self.cache["sets"][set_id] = new
        return new

    # ── evaluación de un producto ──────────────────────────────────────────
    def evaluate(self, title: str, price: float | None, default_lang: str | None = None) -> dict[str, Any] | None:
        set_id = self.match_set(title)
        if not set_id:
            return None
        info = self.set_info(set_id)
        out: dict[str, Any] = {"set": set_id}
        if not info:
            return out
        out.update(set_name=info.get("name"), top=info.get("top", [])[:3])
        packs = packs_in(title)
        if packs and price and info.get("ev_pack"):
            ev = round(info["ev_pack"] * packs, 2)
            ratio = ev / price
            out.update(packs=packs, ev=ev, ratio=round(ratio, 2),
                       verdict="rentable" if ratio >= 1 else "a_la_par" if ratio >= 0.8 else "no_rentable")
        # el precio de los sellados en Cardmarket es sobre todo de la edición en inglés:
        # solo se compara con productos en inglés (los de otros idiomas cotizan distinto)
        langs = {w for w in match_tokens(title) if w.startswith("l_")} or ({default_lang} if default_lang else set())
        kind = _product_kind(title) if langs == {"l_en"} else None
        market = (info.get("sealed") or {}).get(kind) if kind else None
        if market and price:
            out.update(market=market, vs_market=round((price - market) / market, 3))
        return out

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _eur(v: float) -> str:
    return f"{v:,.0f} €".replace(",", ".")


def verdict_text(v: dict[str, Any] | None) -> list[str]:
    """Líneas para el aviso: cartas más caras + si es buen precio + si compensa abrirlo."""
    if not v:
        return []
    lines = []
    if v.get("top"):
        tops = " · ".join(f"{c['name']}{' (' + c['r'] + ')' if c.get('r') and c['r'] != 'ex' else ''} {_eur(c['price'])}"
                          for c in v["top"][:3])
        lines.append(f"💎 Top cartas: {tops}")
    elif v.get("set"):
        lines.append("💎 Aún no hay precios de sus cartas")
    if v.get("market"):
        d = v["vs_market"]
        if d <= -0.05:
            lines.append(f"🏷️ Cardmarket ~{_eur(v['market'])} → aquí {abs(d):.0%} más barato ✅")
        elif d >= 0.05:
            lines.append(f"🏷️ Cardmarket ~{_eur(v['market'])} → aquí {d:.0%} más caro ⚠️")
        else:
            lines.append(f"🏷️ Cardmarket ~{_eur(v['market'])} → precio de mercado")
    if v.get("verdict"):
        n = v["packs"]
        sob = f"{n} sobre" + ("" if n == 1 else "s")
        ev = _eur(v["ev"])
        lines.append({"rentable": f"🎲 Abrirlo: ~{ev} de valor esperado en {sob} → ✅ compensa",
                      "a_la_par": f"🎲 Abrirlo: ~{ev} de valor esperado en {sob} → ⚖️ a la par",
                      "no_rentable": f"🎲 Abrirlo: ~{ev} de valor esperado en {sob} → ❌ no compensa"}[v["verdict"]])
    return lines
