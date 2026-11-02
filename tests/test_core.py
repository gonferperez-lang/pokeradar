import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from pokeradar import analysis, notify
from pokeradar.filters import categorize, is_relevant, match_tokens, similarity
from pokeradar.models import Product
from pokeradar.sources import news, shopify, woo_rss, woocommerce
from pokeradar.state import State

FIX = Path(__file__).parent / "fixtures"
CFG = {
    "general": {"currency": "EUR", "new_max_age_days": 30},
    "filters": {"include": ["pokemon", "pikachu"], "exclude": ["peluche", "one piece", "panini"]},
    "notifications": {"notify_new": True, "notify_restock": True, "notify_price_drop_pct": 10,
                      "notify_news": True, "categories": ["sellado"],
                      "watchlist": ["elite trainer", "etb"], "max_per_run": 3},
}


class FakeClient:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.urls = []

    def get_json(self, url, **_):
        self.urls.append(url)
        return self.payloads.pop(0)

    def get(self, url, **_):
        self.urls.append(url)
        return self.payloads.pop(0)


def iso(days_ago=0):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def prod(pid, title="Pokémon ETB Héroes Ascendentes", price=59.9, available=True, created=None, store="t"):
    return Product(id=f"{store}:{pid}", store=store, title=title, url=f"https://x/{pid}", price=price,
                   available=available, created=created, category=categorize(title))


class FiltersTest(unittest.TestCase):
    def test_relevance(self):
        self.assertTrue(is_relevant("Caja Élite Pokémon", ["pokemon"], []))
        self.assertFalse(is_relevant("Peluche Pikachu", ["pikachu"], ["peluche"]))
        self.assertFalse(is_relevant("One Piece OP09 booster", ["pokemon"], []))
        # "pokemon go" no debe excluir "Pokémon Gold"
        self.assertTrue(is_relevant("Pokémon Gold promo", ["pokemon"], ["pokemon go"]))

    def test_categories(self):
        self.assertEqual(categorize("ETB Pitch Black – Pokémon TCG inglés"), "sellado")
        self.assertEqual(categorize("Charizard ex 199/165 NM"), "carta suelta")
        self.assertEqual(categorize("MEGA CHARIZARD X EX M2A 223 MA - JAPONES"), "carta suelta")
        self.assertEqual(categorize("Fundas Ultra Pro Pikachu (65)"), "accesorio")
        self.assertEqual(categorize("Booster Box 151 Japonés"), "sellado")
        self.assertEqual(categorize("TINS - MINI TINS 30TH CELEBRATION [EN]"), "sellado")
        self.assertEqual(categorize("PREMIUM COLLECTION - ÁLBUM CELEBRACIÓN 30º ANIVERSARIO [ES]"), "sellado")
        self.assertEqual(categorize("Álbum 9 bolsillos Pikachu"), "accesorio")

    def test_matching(self):
        a = match_tokens("ETB Heroes Ascendentes – Pokémon TCG español")
        b = match_tokens("ETB POKEMON CAJA DE ENTRENADOR ELITE HEROES ASCENDENTES - ESPAÑOL")
        c = match_tokens("Booster Box Heroes Ascendentes – Pokémon TCG español")
        d = match_tokens("ETB Heroes Ascendentes – Pokémon TCG inglés")
        self.assertGreaterEqual(similarity(a, b), 0.72)
        self.assertEqual(similarity(a, c), 0.0)   # distinto tipo de producto
        self.assertEqual(similarity(a, d), 0.0)   # distinto idioma
        one = match_tokens("BOOSTER PACK - BLACK BOLT [JP]")
        box = match_tokens("Pokemon Black Bolt Caja 20 sobres – Japonés")
        five = match_tokens("Pack 5 Sobres Pokemon Black Bolt - Japones")
        self.assertEqual(similarity(one, box), 0.0)
        self.assertEqual(similarity(one, five), 0.0)


class SourcesTest(unittest.TestCase):
    def test_shopify(self):
        payload = json.loads((FIX / "shopify.json").read_text())
        client = FakeClient([payload])
        items = shopify.fetch(client, {"id": "s", "url": "https://shop.test", "max_pages": 2}, CFG)
        self.assertEqual([p.title for p in items], ["Caja de Entrenador Élite Pokémon Destinos de Paldea"])
        p = items[0]
        self.assertEqual(p.price, 54.95)
        self.assertTrue(p.available)
        self.assertEqual(p.url, "https://shop.test/products/etb-paldea")
        self.assertEqual(len(client.urls), 1)  # menos de 250 → no pide la página 2

    def test_shopify_pokemon_only_store(self):
        payload = {"products": [
            {"id": 1, "title": "BOOSTER BUNDLE - CELEBRACIÓN 30º ANIVERSARIO [ES]", "handle": "bb", "product_type": "Booster bundles",
             "tags": ["Español"], "variants": [{"price": "59.95", "available": False}], "images": []},
            {"id": 2, "title": "One Piece OP10 Display", "handle": "op", "product_type": "", "tags": [],
             "variants": [{"price": "99", "available": True}], "images": []}]}
        items = shopify.fetch(FakeClient([payload]), {"id": "u", "url": "https://u.test", "pokemon_only": True}, CFG)
        self.assertEqual([p.title for p in items], ["BOOSTER BUNDLE - CELEBRACIÓN 30º ANIVERSARIO [ES]"])

    def test_woo_rss_with_product_pages(self):
        feed = (FIX / "woo_feed.xml").read_bytes()
        page = (FIX / "woo_product.html").read_bytes()
        client = FakeClient([feed, page])
        store = {"id": "f", "url": "https://f.test", "max_pages": 3}
        items = woo_rss.fetch(client, store, CFG, known={})
        self.assertEqual([p.title for p in items], ["White Flare Jumbo Box"])   # One Piece fuera
        self.assertEqual(items[0].price, 67.9)
        self.assertTrue(items[0].available)
        self.assertEqual(items[0].image, "https://f.test/img/3.jpg")
        self.assertEqual(client.urls, ["https://f.test/feed/?post_type=product", "https://f.test/producto/white-flare-jumbo-box/"])
        # en la siguiente pasada no vuelve a pedir la ficha (ya revisada) si refresh_per_run = 0
        client2 = FakeClient([feed])
        again = woo_rss.fetch(client2, {**store, "refresh_per_run": 0}, CFG, known={p.id: p for p in items})
        self.assertEqual(again[0].price, 67.9)
        self.assertEqual(len(client2.urls), 1)

    def test_woocommerce(self):
        payload = json.loads((FIX / "woocommerce.json").read_text())
        items = woocommerce.fetch(FakeClient([payload]), {"id": "w", "url": "https://w.test"}, CFG)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].price, 34.99)
        self.assertEqual(items[0].title, "30th Celebration Mini Tin Pokémon TCG en Inglés")

    def test_news_bing(self):
        body = (FIX / "bing.xml").read_bytes()
        entries = news.parse_feed(body)
        self.assertEqual(entries[0]["link"], "https://www.nintenderos.com/2026/10/pokemon-center/")
        self.assertEqual(entries[0]["source"], "Nintenderos")
        store = {"id": "pc", "feeds": ["https://feed"], "must_include": ["pokemon center"],
                 "must_include_any": ["tcg", "cartas"], "exclude": ["pocket"], "max_age_days": 100000}
        items = news.fetch(FakeClient([body]), store, CFG)
        self.assertEqual([i.title for i in items], ["Pokémon Center abre preventas de cartas TCG"])


class StateTest(unittest.TestCase):
    def test_seed_then_new_restock_drop(self):
        with tempfile.TemporaryDirectory() as d:
            st = State(d)
            self.assertEqual(st.merge("t", [prod(1, available=False, price=60)], CFG), [])  # siembra silenciosa
            ev = st.merge("t", [prod(1, available=True, price=60), prod(2, created=iso(1))], CFG)
            self.assertEqual(sorted(e["type"] for e in ev), ["new", "restock"])
            ev = st.merge("t", [prod(1, price=50), prod(2, created=iso(1))], CFG)
            self.assertEqual([e["type"] for e in ev], ["price_drop"])
            self.assertEqual(ev[0]["old_price"], 60)
            # un producto re-publicado pero creado hace meses no es novedad
            ev = st.merge("t", [prod(3, created=iso(200))], CFG)
            self.assertEqual(ev, [])
            st.save({})
            again = State(d)
            self.assertEqual(len(again.products()), 3)
            self.assertTrue(again.store_state["t"]["seeded"])


class NotifyTest(unittest.TestCase):
    def test_build_limits_and_priority(self):
        evs = [State._event("new", prod(i, title=f"Sobre Pokémon {i}"), iso()) for i in range(4)]
        evs.append(State._event("new", prod(9, title="Pokémon Elite Trainer Box Paldea"), iso()))
        evs.append(State._event("new", prod(8, title="Fundas Pokémon"), iso()))  # accesorio: no avisa
        msgs = notify.build(evs, CFG, {"t": "Tienda"})
        self.assertEqual(len(msgs), 3)                    # 2 avisos + 1 resumen
        self.assertEqual(msgs[0].priority, 5)             # watchlist primero
        self.assertIn("Elite Trainer", msgs[0].body)
        self.assertIn("3 novedades más", msgs[-1].title)

    def test_send_ntfy_payload(self):
        sent = []
        client = mock.Mock()
        client.post_json.side_effect = lambda url, payload, **kw: sent.append((url, payload))
        with mock.patch.dict(os.environ, {"NTFY_TOPIC": "mi-tema-secreto"}, clear=False):
            errs = notify.send([notify.Message("t", "b", url="https://x", image="https://i")], client)
        self.assertEqual(errs, [])
        self.assertEqual(sent[0][0], "https://ntfy.sh/")
        self.assertEqual(sent[0][1]["topic"], "mi-tema-secreto")
        self.assertEqual(sent[0][1]["click"], "https://x")


class AnalysisTest(unittest.TestCase):
    def test_reliability(self):
        self.assertEqual(analysis.reliability({"tier": "oficial"}), 95)
        big = analysis.reliability({"tier": "especializada", "trustpilot": {"score": 4.6, "reviews": 2599}})
        small = analysis.reliability({"tier": "especializada", "trustpilot": {"score": 4.9, "reviews": 7}})
        self.assertGreater(big, small)   # muchas reseñas pesan más que una media alta con pocas

    def test_price_index(self):
        ps = [prod(1, "ETB Heroes Ascendentes español", 50, store="a"),
              prod(2, "Caja de Entrenador Élite Héroes Ascendentes (Español)", 60, store="b")]
        rep = analysis.analyse(ps, [{"id": "a", "name": "A", "url": "", "platform": "shopify", "tier": "especializada"},
                                    {"id": "b", "name": "B", "url": "", "platform": "shopify", "tier": "especializada"}])
        self.assertEqual(len(rep["comparisons"]), 1)
        self.assertEqual(rep["comparisons"][0]["offers"][0]["store"], "a")


if __name__ == "__main__":
    unittest.main()
