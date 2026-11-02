from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@dataclass
class Product:
    id: str                       # "<tienda>:<id nativo>"
    store: str
    title: str
    url: str
    price: float | None = None
    currency: str = "EUR"
    available: bool | None = None
    image: str | None = None
    created: str | None = None    # fecha de alta en la tienda (si la publica)
    kind: str = "product"         # product · news
    category: str = ""            # sellado · accesorio · carta suelta · noticia
    source: str = ""              # medio de la noticia
    first_seen: str = ""
    last_seen: str = ""
    prev_price: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Sin los campos vacíos o por defecto (el catálogo puede tener miles de productos)."""
        d = asdict(self)
        defaults = {"currency": "EUR", "kind": "product"}
        return {k: v for k, v in d.items()
                if v not in (None, "", {}, []) and defaults.get(k) != v}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Product":
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        return cls(**known)
