"""Preventas: detecta productos que aún no han salido y su fecha de salida.

Las tiendas lo indican de muchas formas: en el título ("RESERVA", "Précommande"),
en las etiquetas ("Preventa", "pre-order-Q42026"), en el estado de stock
("Disponible para reserva") o en la descripción ("Fecha de lanzamiento: 27 de
junio de 2026", "Release date: March 27, 2026", "Expédition 06/11/2026").
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from .filters import fold

# Palabras que marcan explícitamente una preventa (título, etiquetas, tipo, estado de stock)
PREORDER_RE = re.compile(
    r"\bpre-?ventas?\b|\breservas?\b|\ben reserva\b|puede reservarse|disponible para reserva"
    r"|\bpre-?orders?\b|\bpre-?order-|\bprecompra\b|\bproximamente\b|\bcoming soon\b"
    r"|\bpre-?commandes?\b|\bprevendita\b|\bvorbestell|\bavailable on backorder\b"
)

MONTHS = {
    # español
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
    "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
    # inglés
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9,
    "oct": 10, "nov": 11, "dec": 12,
    # francés
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7,
    "aout": 8, "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
    # italiano
    "gennaio": 1, "febbraio": 2, "aprile": 4, "maggio": 5, "giugno": 6, "luglio": 7,
    "settembre": 9, "ottobre": 10, "dicembre": 12,
    # alemán
    "januar": 1, "februar": 2, "marz": 3, "juni": 6, "juli": 7, "oktober": 10, "dezember": 12,
}

# Frases que anuncian una fecha de salida
_KEY = re.compile(
    r"fecha (?:de )?(?:lanzamiento|salida|publicacion|venta|llegada)|lanzamiento|salida|"
    r"release(?:s| date)?|released on|disponible|a la venta|se enviara|envio|envios|expedition|"
    r"date de sortie|sortie|uscita|data di uscita|erscheint|erscheinungsdatum|llegada|"
    r"pre-?venta|reserva|pre-?order|precommande"
)
_NUM = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b")
_DAY_MONTH = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th|er)?\s+(?:de\s+)?([a-z]{3,10})\.?(?:,?\s+(?:de\s+|del\s+)?(\d{4}))?")
_MONTH_DAY = re.compile(r"\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b")
_MONTH_YEAR = re.compile(r"\b([a-z]{3,10})\s+(?:de\s+|del\s+)?(\d{4})\b")


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _valid(y: int, m: int, d: int | None) -> bool:
    if not (2020 <= y <= 2035 and 1 <= m <= 12):
        return False
    if d is None:
        return True
    try:
        date(y, m, d)
        return True
    except ValueError:
        return False


def _first_date(window: str, today: date) -> str | None:
    """Primera fecha reconocible en un trozo de texto → 'AAAA-MM-DD' o 'AAAA-MM'."""
    found: list[tuple[int, str]] = []
    for m in _NUM.finditer(window):
        if m.group(1):
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        else:
            d, mo, y = int(m.group(4)), int(m.group(5)), int(m.group(6))
            y += 2000 if y < 100 else 0
        if _valid(y, mo, d):
            found.append((m.start(), f"{y:04d}-{mo:02d}-{d:02d}"))
    for m in _DAY_MONTH.finditer(window):
        mo = MONTHS.get(m.group(2))
        if not mo:
            continue
        d = int(m.group(1))
        y = int(m.group(3)) if m.group(3) else today.year
        if not m.group(3) and date(y, mo, min(d, 28)) < today - timedelta(days=60):
            y += 1  # "14 de enero" dicho en noviembre → el año que viene
        if _valid(y, mo, d):
            found.append((m.start(), f"{y:04d}-{mo:02d}-{d:02d}"))
    for m in _MONTH_DAY.finditer(window):
        mo = MONTHS.get(m.group(1))
        if mo and _valid(int(m.group(3)), mo, int(m.group(2))):
            found.append((m.start(), f"{int(m.group(3)):04d}-{mo:02d}-{int(m.group(2)):02d}"))
    for m in _MONTH_YEAR.finditer(window):
        mo = MONTHS.get(m.group(1))
        if mo and _valid(int(m.group(2)), mo, None):
            found.append((m.start() + 1, f"{int(m.group(2)):04d}-{mo:02d}"))  # menos preciso: va después
    return min(found)[1] if found else None


def release_date(text: str, today: date | None = None) -> str | None:
    """Busca una fecha de salida anunciada ("fecha de lanzamiento: 27 de junio de 2026")."""
    today = today or _today()
    t = fold(text)
    for k in _KEY.finditer(t):
        window = t[k.end(): k.end() + 50]
        found = _first_date(window, today)
        if found:
            return found
    return None


def is_future(salida: str, today: date | None = None, grace_days: int = 0) -> bool:
    today = today or _today()
    parts = [int(x) for x in salida.split("-")]
    if len(parts) == 2:  # solo mes: cuenta como futuro hasta que acabe ese mes
        return (parts[0], parts[1]) >= (today.year, today.month)
    return date(*parts) >= today - timedelta(days=grace_days)


def detect(flags_text: str, body: str = "", today: date | None = None) -> dict[str, object]:
    """`flags_text`: título, etiquetas, tipo y estado de stock. `body`: descripción.

    Devuelve {"preventa": True, "salida": "AAAA-MM-DD"} (o {} si no es preventa).
    """
    today = today or _today()
    explicit = bool(PREORDER_RE.search(fold(flags_text)))
    salida = release_date(f"{flags_text} . {body}", today)
    if salida and not is_future(salida, today, grace_days=7):
        return {}  # ya salió (aunque la tienda olvidara quitar la etiqueta "preventa")
    if explicit or salida:
        return {"preventa": True, **({"salida": salida} if salida else {})}
    return {}
