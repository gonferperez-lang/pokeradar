"""Conectores de tiendas. Cada uno devuelve una lista de `Product`."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..http import PoliteClient, SourceSkipped  # noqa: F401  (re-exportado)
from ..models import Product
from . import amazon_creators, news, shopify, woocommerce

Fetcher = Callable[[PoliteClient, dict[str, Any], dict[str, Any]], list[Product]]

PLATFORMS: dict[str, Fetcher] = {
    "shopify": shopify.fetch,
    "woocommerce": woocommerce.fetch,
    "amazon_creators": amazon_creators.fetch,
    "news": news.fetch,
}
