"""Filtros de relevancia, categorías y comparación aproximada de productos."""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable


def fold(text: str) -> str:
    """minúsculas + sin acentos + espacios normalizados."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", text.lower()).strip()


def _contains(haystack: str, needle: str) -> bool:
    needle = fold(needle)
    return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", haystack) is not None


def is_relevant(text: str, include: Iterable[str], exclude: Iterable[str]) -> bool:
    t = fold(text)
    if not any(_contains(t, w) for w in include):
        return False
    return not any(_contains(t, w) for w in exclude)


def matches_any(text: str, words: Iterable[str]) -> bool:
    t = fold(text)
    return any(_contains(t, w) for w in words)


# ── categorías ──────────────────────────────────────────────────────────────
_SINGLE = re.compile(
    r"(?<![\d/])\d{1,3}/\d{2,3}(?![\d/])|\bpsa ?\d|\bbgs\b|\bcgc\b|\bnear mint\b|\bnm\b|carta suelta|\bsingles?\b"
    r"|\bfull art\b|\bgradead[ao]\b"
)
# código de expansión + número de carta: "SV2A 177", "M2A 223", "S-P 124", "CS6.1C 004"
_CARD_CODE = re.compile(r"\b[a-z]{1,4}\d{0,2}(\.\d)?[a-z]?(-p)? \d{3}\b")
_ACCESSORY = re.compile(
    r"\bfundas?\b|\bsleeves?\b|\bprotector(es)?\b|\balbum\b|\bcarpeta\b|\bbinder\b|\btapete\b"
    r"|\bplaymat\b|deck ?box|caja de mazo|toploader|portacartas|\bdados?\b|\bmarcadores?\b|bolsillos"
    r"|\bexpositor\b|\bvitrina\b|\bmagnetic\b|\bmagnetico\b"
)
_SEALED = re.compile(
    r"\bsobres?\b|\bbooster\b|\betb\b|\belite\b|\bcaja\b|\bbox\b|\btins?\b|\blatas?\b|\bblister\b"
    r"|\bdisplay\b|coleccion|collection|\bbundle\b|\bmazo\b|\bdeck\b|\bpremium\b|\bkit\b"
    r"|\bcalendario\b|\bpack\b|\bpreventa\b|\breserva\b|\bset\b|build (and|&) battle|\bstarter\b"
    r"|\bpromo\b|\bcoin\b|\bcase\b|\bprecommande\b|\bpre-?order\b"
)


# productos sellados inequívocos aunque mencionen un accesorio ("Premium Collection - Álbum…")
_SEALED_STRONG = re.compile(
    r"premium collection|coleccion premium|elite trainer|entrenador elite|\betb\b|booster (box|bundle)"
    r"|\bdisplay\b|\bsobres?\b|\btins?\b|\blatas?\b"
)


# accesorios que llevan en el nombre el producto para el que sirven ("PET Protector – Booster Bundle",
# "Card Frame Display"): se comprueban antes que los sellados
_ACCESSORY_STRONG = re.compile(
    r"\bframe\b|\bmarco\b|\bprotector(es)?\b|\bacryli|\bacrili|\bmagnetic|\bmagnetico|\bheimdall\b"
    r"|\bdeck ?box\b|\bsleeves?\b|\bfundas?\b|\bplaymat\b|\btapete\b|\btoploader|\bstorage\b"
)


def categorize(title: str, product_type: str = "") -> str:
    t = fold(f"{title} {product_type}")
    if _SINGLE.search(t):
        return "carta suelta"
    if _ACCESSORY_STRONG.search(t):
        return "accesorio"
    if _SEALED_STRONG.search(t):
        return "sellado"
    if _ACCESSORY.search(t):
        return "accesorio"
    if _CARD_CODE.search(t) and not re.search(r"\bsobres?\b|\bbooster\b|\bbox\b|\bcaja\b|\bset\b", t):
        return "carta suelta"
    if _SEALED.search(t):
        return "sellado"
    return "otro"


# ── comparación entre tiendas ──────────────────────────────────────────────
_SYNONYMS: list[tuple[re.Pattern[str], str]] = [(re.compile(p), r) for p, r in [
    (r"caja de entrenador (de )?elite|elite trainer box|caja elite( de entrenador)?|entrenador elite|\betb\b", " t_etb "),
    (r"booster bundle|lote de sobres|paquete de sobres", " t_bundle "),
    (r"booster box|\bdisplay\b|caja (de )?(\d{2} )?sobres|\b(18|20|24|30|36) sobres\b", " t_display "),
    (r"\b3 ?pack\b|\b3 sobres\b", " t_blister3 "),
    (r"\b2 ?pack\b|\b2 sobres\b", " t_blister2 "),
    (r"\b([2-9]|1[0-6]) (sobres|boosters|packs)\b", r" t_q\1 "),   # "Pack 5 sobres" ≠ 1 sobre
    (r"booster pack|\bsobres?\b|\bbooster\b", " t_sobre "),
    (r"\blatas?\b|\btins?\b|mini tin", " t_tin "),
    (r"coleccion premium|premium collection", " t_premium "),
    (r"\bblister\b", " t_blister "),
    (r"\bcoleccion\b|\bcollection\b", " collection "),
    (r"\bespanol\b|\bspanish\b|\bcastellano\b|[(\[]esp?[)\]]|[-–]\s*esp?\s*$", " l_es "),
    (r"\bingles\b|\benglish\b|\beng\b|[(\[]en[)\]]|[-–]\s*en\s*$", " l_en "),
    (r"\bjapones(a)?\b|\bjapanese\b|\bjaponais\b|\bgiapponese\b|\bjapanisch\b|\bjpn?\b|[(\[]jp[)\]]", " l_jp "),
    (r"\bcoreano\b|\bkorean\b|\bcoreen\b|\bcoreano\b|\bkoreanisch\b|\bkor\b|[(\[]kr[)\]]", " l_kr "),
    (r"\bchino\b|\bchinese\b|\bchinois\b|\bcinese\b|\bchinesisch\b|\bsimplified\b|\bchn\b|\bschn\b|[(\[](cn|sc|tc|chi)[)\]]", " l_cn "),
]]
_STOP = set("""
pokemon tcg juego juegos cartas carta coleccionables coleccionable trading card cards game de del la el los las
en the of y and con with a para version edicion edition escarlata purpura scarlet violet sv
caja nuevo nueva new oficial original originales sellado sellada precintado precintada unidad ud
""".split())
TYPE_PREFIX, LANG_PREFIX = "t_", "l_"


def match_tokens(title: str) -> frozenset[str]:
    t = fold(title)
    for pat, rep in _SYNONYMS:
        t = pat.sub(rep, t)
    t = re.sub(r"[^a-z0-9_ ]+", " ", t)
    # los números sueltos cuentan ("Gem Pack Vol. 6" ≠ "Vol. 2")
    return frozenset(w for w in t.split() if w not in _STOP and (len(w) > 1 or w.isdigit()))


def similarity(a: frozenset[str], b: frozenset[str]) -> float:
    """Jaccard sobre tokens, exigiendo mismo tipo de producto e idioma."""
    if not a or not b:
        return 0.0
    for prefix in (TYPE_PREFIX, LANG_PREFIX):
        pa = {w for w in a if w.startswith(prefix)}
        pb = {w for w in b if w.startswith(prefix)}
        if pa != pb and (prefix == TYPE_PREFIX or (pa and pb)):
            return 0.0
    return len(a & b) / len(a | b)
