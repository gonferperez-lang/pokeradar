"""Historial de precio y stock de cada producto sellado (gráfica de la ficha, bajadas, reposiciones).

`docs/data/history.json` guarda, por producto, puntos `[fecha, precio, en_stock]` solo cuando algo
cambia (el valor se mantiene hasta el siguiente punto). Si cambia varias veces en un día, se queda
el precio más bajo del día y si hubo stock en algún momento. Se conservan 90 días.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .models import Product

KEEP_DAYS = 90
DROP_DAYS = 7          # «bajadas de la semana»
DROP_MIN = 0.05        # desde un 5 % menos que el precio más alto de esos días


class History:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "history.json"
        try:
            self.items: dict[str, list[list[Any]]] = json.loads(self.path.read_text(encoding="utf-8")).get("items", {})
        except (FileNotFoundError, ValueError):
            self.items = {}

    def record(self, products: list[Product], today: str) -> None:
        for p in products:
            if p.kind != "product" or p.category != "sellado" or not p.price or (p.extra or {}).get("unseen"):
                continue
            pts = self.items.setdefault(p.id, [])
            av = 1 if p.available else 0
            price = round(p.price, 2)
            if pts and pts[-1][0] == today:
                last = pts[-1]
                pts[-1] = [today, min(last[1], price), max(last[2], av)]
                if len(pts) > 1 and pts[-1][1:] == pts[-2][1:]:
                    pts.pop()   # vuelve a ser igual que antes: no hace falta el punto
            elif not pts or pts[-1][1:] != [price, av]:
                pts.append([today, price, av])

    def prune(self, keep_ids: set[str], today: str) -> None:
        """Quita productos que ya no existen y puntos de hace más de 90 días (salvo el último anterior,
        que marca el valor al empezar la ventana)."""
        cutoff = (date.fromisoformat(today) - timedelta(days=KEEP_DAYS)).isoformat()
        for pid in list(self.items):
            if pid not in keep_ids:
                del self.items[pid]
                continue
            pts = self.items[pid]
            old = [x for x in pts if x[0] < cutoff]
            self.items[pid] = old[-1:] + [x for x in pts if x[0] >= cutoff]

    def drop(self, pid: str, price: float, today: str) -> dict[str, Any] | None:
        """¿Ha bajado en la última semana? {"pct": 0.12, "de": 59.9} si el precio actual es al menos
        un 5 % menor que el más alto de los últimos 7 días."""
        pts = self.items.get(pid) or []
        start = (date.fromisoformat(today) - timedelta(days=DROP_DAYS)).isoformat()
        window = [x[1] for x in pts if x[0] >= start]
        before = [x[1] for x in pts if x[0] < start]
        if before:
            window.append(before[-1])   # el precio que tenía al empezar la semana
        if not window or not price:
            return None
        top = max(window)
        if price <= top * (1 - DROP_MIN):
            return {"pct": round(1 - price / top, 3), "de": top}
        return None

    def save(self) -> bool:
        lines = [f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, separators=(',', ':'))}"
                 for k, v in sorted(self.items.items())]
        text = '{"items": {\n' + ",\n".join(lines) + "\n}}\n"
        try:
            if self.path.read_text(encoding="utf-8") == text:
                return False
        except FileNotFoundError:
            pass
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(text, encoding="utf-8")
        return True
