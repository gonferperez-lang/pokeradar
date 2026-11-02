"""Amazon mediante la API oficial *Creators API* (sucesora de PA-API 5, retirada en 2026).

Requisitos: cuenta de Amazon Afiliados (Associates) aprobada en el marketplace
y unas credenciales creadas en Associates Central → Herramientas → Creators API.
Se pasan como variables de entorno / secrets de GitHub:

    AMAZON_CREDENTIAL_ID, AMAZON_CREDENTIAL_SECRET, AMAZON_PARTNER_TAG
    AMAZON_CREDENTIAL_VERSION   (opcional; "3.2" por defecto en la UE)
    AMAZON_TOKEN_URL            (opcional; para forzar otro endpoint de token)

Sin credenciales el conector se omite (no es un error) y la app sigue
ofreciendo los enlaces directos a Amazon ordenados por novedades.
"""
from __future__ import annotations

import os
from typing import Any

from ..filters import categorize, is_relevant
from ..http import FetchError, PoliteClient, SourceSkipped
from ..models import Product

API = "https://creatorsapi.amazon/catalog/v1/searchItems"
TOKEN_V3 = "https://api.amazon.com/auth/o2/token"           # credenciales 3.x (LWA)
TOKEN_V2 = {"2.2": "https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token"}  # 2.x UE
FULL_RESOURCES = [
    "itemInfo.title",
    "images.primary.large",
    "offersV2.listings.price",
    "offersV2.listings.availability",
    "offersV2.listings.merchantInfo",
]
MIN_RESOURCES = ["itemInfo.title", "images.primary.large", "offersV2.listings.price"]


def _token(client: PoliteClient, cid: str, secret: str, version: str) -> tuple[str, str]:
    url = (os.environ.get("AMAZON_TOKEN_URL") or "").strip()
    if version.startswith("3"):
        data = client.post_json(url or TOKEN_V3, {
            "grant_type": "client_credentials", "client_id": cid,
            "client_secret": secret, "scope": "creatorsapi::default",
        }, check_robots=False)
        return data["access_token"], f"Bearer {data['access_token']}"
    url = url or TOKEN_V2.get(version)
    if not url:
        raise SourceSkipped(f"Credenciales {version}: define AMAZON_TOKEN_URL")
    data = client.post_form(url, {
        "grant_type": "client_credentials", "client_id": cid,
        "client_secret": secret, "scope": "creatorsapi/default",
    }, check_robots=False)
    return data["access_token"], f"Bearer {data['access_token']}, Version {version}"


def _dig(d: Any, *path: str | int) -> Any:
    for p in path:
        if isinstance(d, dict):
            d = d.get(p)
        elif isinstance(d, list) and isinstance(p, int) and len(d) > p:
            d = d[p]
        else:
            return None
    return d


def fetch(client: PoliteClient, store: dict[str, Any], cfg: dict[str, Any]) -> list[Product]:
    cid = (os.environ.get("AMAZON_CREDENTIAL_ID") or "").strip()
    secret = (os.environ.get("AMAZON_CREDENTIAL_SECRET") or "").strip()
    tag = (os.environ.get("AMAZON_PARTNER_TAG") or "").strip()
    if not (cid and secret and tag):
        raise SourceSkipped("sin credenciales de Amazon Creators API (opcional)")
    version = (os.environ.get("AMAZON_CREDENTIAL_VERSION") or "3.2").strip()
    marketplace = store.get("marketplace", "www.amazon.es")
    _, auth = _token(client, cid, secret, version)
    headers = {"Authorization": auth, "x-marketplace": marketplace}
    flt = cfg.get("filters", {})
    out: dict[str, Product] = {}
    resources = FULL_RESOURCES
    for kw in store.get("keywords", ["Pokémon TCG"]):
        body = {"keywords": kw, "partnerTag": tag, "marketplace": marketplace,
                "sortBy": "NewestArrivals", "itemCount": 10, "resources": resources}
        try:
            data = client.post_json(API, body, headers=headers, check_robots=False)
        except FetchError:
            if resources is MIN_RESOURCES:
                raise
            resources = body["resources"] = MIN_RESOURCES  # algún recurso no admitido → mínimo
            data = client.post_json(API, body, headers=headers, check_robots=False)
        for it in _dig(data, "searchResult", "items") or []:
            title = _dig(it, "itemInfo", "title", "displayValue") or ""
            if not is_relevant(title, flt.get("include", []), flt.get("exclude", [])):
                continue
            listing = _dig(it, "offersV2", "listings", 0) or {}
            money = _dig(listing, "price", "money") or {}
            avail_type = str(_dig(listing, "availability", "type") or "").upper()
            merchant = _dig(listing, "merchantInfo", "name") or ""
            asin = it.get("asin")
            if not asin:
                continue
            out[asin] = Product(
                id=f"{store['id']}:{asin}",
                store=store["id"],
                title=title,
                url=it.get("detailPageURL") or f"https://{marketplace}/dp/{asin}",
                price=float(money["amount"]) if money.get("amount") else None,
                currency=money.get("currency", "EUR"),
                available=(avail_type == "IN_STOCK") if avail_type else (True if listing else None),
                image=_dig(it, "images", "primary", "large", "url")
                or _dig(it, "images", "primary", "medium", "url"),
                category=categorize(title),
                extra={"vendedor": merchant} if merchant else {},
            )
    return list(out.values())
