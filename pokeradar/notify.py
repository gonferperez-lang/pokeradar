"""Avisos push al iPhone: ntfy (app gratuita) y, opcionalmente, Telegram."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

from .filters import matches_any
from .http import PoliteClient

ICON = {"new": "🆕", "restock": "🔁", "price_drop": "💸", "news": "📰"}
LABEL = {"new": "Nuevo", "restock": "Vuelve a stock", "price_drop": "Baja de precio", "news": "Noticia"}


@dataclass
class Message:
    title: str
    body: str
    url: str = ""
    image: str | None = None
    priority: int = 3
    tags: list[str] = field(default_factory=list)


def _price(e: dict[str, Any]) -> str:
    if e.get("price") is None:
        return ""
    txt = f"{e['price']:.2f} €".replace(".", ",")
    if e.get("old_price"):
        txt += f" (antes {e['old_price']:.2f} €)".replace(".", ",")
    return txt


def select(events: list[dict[str, Any]], cfg: dict[str, Any]) -> list[tuple[dict[str, Any], bool]]:
    """Devuelve [(evento, es_prioritario)] según la configuración de avisos."""
    n = cfg.get("notifications", {})
    enabled = {"new": n.get("notify_new", True), "restock": n.get("notify_restock", True),
               "price_drop": bool(n.get("notify_price_drop_pct")), "news": n.get("notify_news", True)}
    cats = set(n.get("categories", ["sellado"]))
    watch = n.get("watchlist", [])
    chosen = []
    for e in events:
        if not enabled.get(e["type"]):
            continue
        hot = matches_any(e["title"], watch) if watch else False
        if e["type"] == "news" or hot or e.get("category") in cats:
            chosen.append((e, hot))
    chosen.sort(key=lambda t: not t[1])  # prioritarios primero
    return chosen


def build(events: list[dict[str, Any]], cfg: dict[str, Any], store_names: dict[str, str]) -> list[Message]:
    chosen = select(events, cfg)
    limit = max(1, int(cfg.get("notifications", {}).get("max_per_run", 8)))
    msgs: list[Message] = []
    show = chosen if len(chosen) <= limit else chosen[: limit - 1]
    for e, hot in show:
        store = store_names.get(e["store"], e["store"])
        head = f"{ICON[e['type']]} {LABEL[e['type']]} · {store}"
        if e["type"] == "news" and e.get("source"):
            head += f" ({e['source']})"
        body = e["title"]
        extra = " · ".join(x for x in [_price(e), "sin stock" if e.get("available") is False else ""] if x)
        if extra:
            body += f"\n{extra}"
        msgs.append(Message(title=head, body=body, url=e.get("url", ""), image=e.get("image"),
                            priority=5 if hot else (4 if e["type"] != "news" else 3),
                            tags=["fire"] if hot else []))
    rest = chosen[len(show):]
    if rest:
        stores = sorted({store_names.get(e["store"], e["store"]) for e, _ in rest})
        msgs.append(Message(
            title=f"📦 {len(rest)} novedades más",
            body="En: " + ", ".join(stores) + "\nÁbrelas en PokéRadar.",
            url=(os.environ.get("APP_URL") or "").strip(), priority=3, tags=["package"]))
    return msgs


def send(messages: list[Message], client: PoliteClient) -> list[str]:
    """Envía por los canales configurados. Devuelve la lista de errores (vacía si todo ok)."""
    errors: list[str] = []
    # GitHub pasa los secrets inexistentes como texto vacío: se tratan como "no definido"
    env = lambda k: (os.environ.get(k) or "").strip()  # noqa: E731
    topic = env("NTFY_TOPIC")
    server = (env("NTFY_SERVER") or "https://ntfy.sh").rstrip("/")
    tg_token, tg_chat = env("TELEGRAM_BOT_TOKEN"), env("TELEGRAM_CHAT_ID")
    if not topic and not (tg_token and tg_chat):
        return ["No hay canal de avisos: crea el secret NTFY_TOPIC en GitHub "
                "(Settings → Secrets and variables → Actions → pestaña Secrets)."]
    if topic and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", topic):
        return [f"El tema de ntfy («{topic[:3]}…», {len(topic)} caracteres) no es válido: usa solo letras sin "
                "acentos ni ñ, números, guiones (-) y guiones bajos (_), sin espacios y con 64 caracteres como máximo."]
    if not server.startswith(("http://", "https://")):
        return ["NTFY_SERVER debe empezar por https:// (o bórralo para usar https://ntfy.sh)."]
    headers = {}
    if env("NTFY_TOKEN"):
        headers["Authorization"] = f"Bearer {env('NTFY_TOKEN')}"
    for m in messages:
        if topic:
            payload: dict[str, Any] = {"topic": topic, "title": m.title, "message": m.body,
                                       "priority": m.priority, "tags": m.tags}
            if m.url:
                payload["click"] = m.url
                payload["actions"] = [{"action": "view", "label": "Abrir", "url": m.url}]
            if m.image:
                payload["attach"] = m.image
            try:
                client.post_json(server + "/", payload, headers=headers, check_robots=False)
            except Exception as e:
                errors.append(f"ntfy: {e}")
        if tg_token and tg_chat:
            text = f"<b>{_esc(m.title)}</b>\n{_esc(m.body)}"
            if m.url:
                text += f'\n<a href="{_esc(m.url)}">Abrir</a>'
            try:
                client.post_json(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                                 {"chat_id": tg_chat, "text": text, "parse_mode": "HTML"},
                                 check_robots=False)
            except Exception as e:
                errors.append(f"telegram: {type(e).__name__}")  # sin token en el mensaje
    return errors


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
