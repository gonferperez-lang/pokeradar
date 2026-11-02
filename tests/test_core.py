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
        self.assertEqual(categorize("PKM- 30th Celebration Sylveon Card Frame Display"), "accesorio")
        self.assertEqual(categorize("Heimdall® Pokémon PET Protector – Booster Bundle"), "accesorio")

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


class MoreStoresTest(unittest.TestCase):
    def test_silent_merge_after_filter_change(self):
        with tempfile.TemporaryDirectory() as d:
            st = State(d)
            st.merge("t", [prod(1)], CFG)
            self.assertEqual(st.merge("t", [prod(1), prod(2, created=iso(1))], CFG, silent=True), [])
            self.assertEqual(len(st.merge("t", [prod(1), prod(2), prod(3, created=iso(1))], CFG)), 1)

    def test_eu_store_defaults_to_english(self):
        es = prod(1, "30th Celebration Sylveon ex Tin (Español)", 32, store="es")
        eu = prod(2, "30th Celebration Sylveon ex Tin", 60, store="eu")
        en = prod(3, "30th Celebration Sylveon ex Tin - EN", 55, store="es2")
        stores = [{"id": "es", "name": "ES", "url": "", "platform": "shopify", "country": "ES"},
                  {"id": "es2", "name": "ES2", "url": "", "platform": "shopify", "country": "ES"},
                  {"id": "eu", "name": "EU", "url": "", "platform": "shopify", "country": "NL"}]
        rep = analysis.analyse([es, eu, en], stores)
        self.assertEqual(len(rep["comparisons"]), 1)
        self.assertEqual({o["store"] for o in rep["comparisons"][0]["offers"]}, {"eu", "es2"})

    def test_volume_numbers_matter(self):
        self.assertLess(similarity(match_tokens("Gem Pack Vol. 6 Booster Box Chino"),
                                   match_tokens("Gem Pack Vol. 2 Booster Box Chino")), 0.72)


class PreorderTest(unittest.TestCase):
    TODAY = datetime(2026, 11, 2).date()

    def test_release_dates(self):
        from pokeradar.preorder import release_date as rd
        t = self.TODAY
        self.assertEqual(rd("Idioma: japonés. Fecha de lanzamiento: 27 de junio de 2026.", t), "2026-06-27")
        self.assertEqual(rd("Language: English · Release date: March 27, 2026 · Condition: new", t), "2026-03-27")
        self.assertEqual(rd("Précommande – Expédition 06/11/2026 – Pack ETB", t), "2026-11-06")
        self.assertEqual(rd("Lanzamiento previsto para noviembre de 2026", t), "2026-11")
        self.assertEqual(rd("Salida: 14 de enero", t), "2027-01-14")      # sin año → el próximo enero
        self.assertIsNone(rd("1 dado para lanzamiento de moneda válido para torneos", t))
        self.assertIsNone(rd("Envío en 24/48 horas a toda la península", t))

    def test_detect(self):
        from pokeradar.preorder import detect
        t = self.TODAY
        self.assertEqual(detect("ETB Destined Rivals Preventa", "", t), {"preventa": True})
        self.assertEqual(detect("Booster Bundle 30th Celebration pre-order-Q42026", "", t), {"preventa": True})
        self.assertEqual(detect("Caja Ascended Heroes", "Fecha de salida: 14/11/2026", t),
                         {"preventa": True, "salida": "2026-11-14"})
        # ya salió (aunque siga con la etiqueta "Preventa") → no es preventa
        self.assertEqual(detect("Blister Preventa", "Fecha de lanzamiento: 27 de junio de 2026", t), {})
        self.assertEqual(detect("ETB 151 Inglés", "1 dado para lanzamiento de moneda", t), {})
        self.assertEqual(detect("Case de ETB Delta Reign Disponible para reserva", "", t), {"preventa": True})

    def test_date_is_not_card_number(self):
        self.assertEqual(categorize("Précommande – Expédition 06/11/2026 – Pack ETB Pokémon ME06 Règne Delta FR"), "sellado")
        self.assertEqual(categorize("Charizard ex 199/165"), "carta suelta")

    def test_preorder_events(self):
        with tempfile.TemporaryDirectory() as d:
            st = State(d)
            st.merge("t", [prod(1)], CFG)
            p2 = prod(2, "ETB Aura Seeker", available=False, created=iso(0))
            p2.extra = {"preventa": True, "salida": "2026-12-05"}
            ev = st.merge("t", [prod(1), p2], CFG)
            self.assertEqual([e["type"] for e in ev], ["preorder"])
            self.assertEqual(ev[0]["salida"], "2026-12-05")
            p2b = prod(2, "ETB Aura Seeker", available=True, created=iso(0))
            p2b.extra = {"preventa": True, "salida": "2026-12-05"}
            self.assertEqual([e["type"] for e in st.merge("t", [prod(1), p2b], CFG)], ["preorder_open"])
            msgs = notify.build(ev, CFG, {"t": "Tienda"})
            self.assertEqual(msgs[0].priority, 5)
            self.assertIn("sale el 5 dic 2026", msgs[0].body)


class CardValueTest(unittest.TestCase):
    def fake_client(self):
        sets = [{"id": "me05", "name": "Pitch Black"}, {"id": "sv10", "name": "Destined Rivals"},
                {"id": "me01", "name": "Mega Evolution"}]
        sets_es = [{"id": "me05", "name": "Oscuridad Absoluta"}, {"id": "sv10", "name": "Rivales Predestinados"}]
        cm_pg = {"priceGuides": [{"idProduct": i, "trend": t} for i, t in
                                 [(1, 168.0), (2, 128.0), (3, 47.0), (4, 2.0), (5, 1.0), (10, 68.85), (11, 5.0), (12, 0.31)]]}
        singles = {"products": [{"idProduct": 1, "name": "Mega Darkrai ex [Dusk Raid | Abyss Eye]", "idExpansion": 77},
                                {"idProduct": 2, "name": "Mega Darkrai ex [Dusk Raid | Abyss Eye]", "idExpansion": 77},
                                {"idProduct": 3, "name": "Morpeko ex [Wheely Draw]", "idExpansion": 77},
                                {"idProduct": 4, "name": "Mega Darkrai ex [Dusk Raid | Abyss Eye]", "idExpansion": 77},
                                {"idProduct": 5, "name": "Morpeko ex [Wheely Draw]", "idExpansion": 77}]}
        sealed = {"products": [{"idProduct": 10, "name": "Pitch Black Elite Trainer Box", "idExpansion": 77},
                               {"idProduct": 11, "name": "Pitch Black Booster", "idExpansion": 77},
                               {"idProduct": 12, "name": "Pitch Black: Elite Trainer Box Coin", "idExpansion": 77}]}
        rar = {"Special illustration rare": [{"name": "Mega Darkrai ex"}, {"name": "Morpeko ex"}],
               "Mega Hyper Rare": [{"name": "Mega Darkrai ex"}],
               "Double rare": [{"name": "Mega Darkrai ex"}, {"name": "Morpeko ex"}]}

        def get_json(url, **_):
            if url.endswith("/en/sets"):
                return sets
            if url.endswith("/es/sets"):
                return sets_es
            if url.endswith(("/fr/sets", "/it/sets", "/de/sets")):
                return []
            if "price_guide" in url:
                return cm_pg
            if "products_singles" in url:
                return singles
            if "products_nonsingles" in url:
                return sealed
            if "/en/cards?" in url:
                import urllib.parse
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
                return rar.get(q["rarity"][0].removeprefix("eq:"), [])
            raise AssertionError(url)
        return mock.Mock(get_json=get_json)

    def test_match_and_evaluate(self):
        from pokeradar.cardvalue import CardValue, packs_in, verdict_text
        with tempfile.TemporaryDirectory() as d:
            cv = CardValue("t", d, client=self.fake_client())
            self.assertEqual(cv.match_set("Booster Bundle Oscuridad Absoluta - Español"), "me05")
            self.assertEqual(cv.match_set("Mega Evolution - ETB Rivales Predestinados"), "sv10")  # serie ≠ colección
            self.assertIsNone(cv.match_set("Booster Box Inferno X Japonés"))
            v = cv.evaluate("Elite Trainer Box Pitch Black (Inglés)", 79.0)
            self.assertEqual(v["top"][0]["name"], "Mega Darkrai ex")
            self.assertEqual(v["top"][0]["r"], "SIR")           # la versión más cara = ilustración especial
            self.assertEqual(v["market"], 68.85)                 # la moneda de 0,31 € no cuenta como ETB
            self.assertEqual(v["packs"], 9)
            self.assertEqual(v["verdict"], "no_rentable")
            text = "\n".join(verdict_text(v))
            self.assertIn("💎 Top cartas: Mega Darkrai ex (SIR) 168 €", text)
            self.assertIn("15% más caro", text)
            # en español no se compara con Cardmarket (cotiza distinto que la edición inglesa)
            self.assertNotIn("market", cv.evaluate("Caja de Entrenador Élite Oscuridad Absoluta (Español)", 50.0))
            self.assertEqual(packs_in("Blister 3 sobres Caos Creciente"), 3)
            self.assertIsNone(packs_in("Ultra Premium Collection Charizard"))
            self.assertIsNone(packs_in("Scarlet & Violet 151 Mini Tin Display – 10 Mini Tins"))
            self.assertIsNone(cv.match_set("Pokémon - Pitch Black Booster Display - KOR"))
            self.assertIsNone(cv.match_set("Display Pokémon Japonais – Pitch Black"))
            self.assertIsNone(cv.match_set("BOOSTER BOX - PITCH BLACK [KR]"))
            self.assertIsNone(packs_in("Sobre 3 cartas Oscuridad Absoluta | Fun Pack"))


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

    def test_empty_optional_secrets_use_defaults(self):
        # GitHub Actions define como "" los secrets que no existen
        sent = []
        client = mock.Mock()
        client.post_json.side_effect = lambda url, payload, **kw: sent.append(url)
        env = {"NTFY_TOPIC": " mi-tema_1 \n", "NTFY_SERVER": "", "NTFY_TOKEN": "", "TELEGRAM_BOT_TOKEN": ""}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(notify.send([notify.Message("t", "b")], client), [])
        self.assertEqual(sent, ["https://ntfy.sh/"])

    def test_invalid_topic_is_explained(self):
        with mock.patch.dict(os.environ, {"NTFY_TOPIC": "pokéradar mío", "NTFY_SERVER": ""}):
            errs = notify.send([notify.Message("t", "b")], mock.Mock())
        self.assertEqual(len(errs), 1)
        self.assertIn("no es válido", errs[0])


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


class ScheduleTest(unittest.TestCase):
    """Las pasadas de respaldo de GitHub no repiten el trabajo si el reloj acaba de revisar."""

    def _run(self, data_dir, *extra):
        from pokeradar import __main__ as main_mod
        cfg = Path(data_dir) / "config.toml"
        cfg.write_text('stores = []\n[general]\nuser_agent = "test"\ncard_values = false\n'
                       '[filters]\ninclude = ["pokemon"]\nexclude = []\n', encoding="utf-8")
        with mock.patch.dict(os.environ, {"POKERADAR_TRIGGER": "reloj"}):
            return main_mod.main(["--config", str(cfg), "--data-dir", str(data_dir), "--dry-run", *extra])

    def test_backup_run_skips_when_recent(self):
        with tempfile.TemporaryDirectory() as tmp:
            status = Path(tmp) / "status.json"
            status.write_text(json.dumps({"generated": iso(0)}), encoding="utf-8")
            before = status.read_text(encoding="utf-8")
            self.assertEqual(self._run(tmp, "--min-gap", "12"), 0)
            self.assertEqual(status.read_text(encoding="utf-8"), before)   # no ha tocado nada
            self.assertFalse((Path(tmp) / "products.json").exists())

    def test_backup_run_works_when_clock_failed_and_keeps_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = (datetime.now(timezone.utc) - timedelta(minutes=40)).isoformat()
            status = Path(tmp) / "status.json"
            status.write_text(json.dumps({"generated": old, "history": [{"at": old, "by": "schedule"}]}),
                              encoding="utf-8")
            self.assertEqual(self._run(tmp, "--min-gap", "12"), 0)
            st = json.loads(status.read_text(encoding="utf-8"))
            self.assertGreater(st["generated"], old)
            self.assertEqual([h["by"] for h in st["history"]], ["reloj", "schedule"])



class DealsTest(unittest.TestCase):
    """🔥 Chollos: referencias, umbrales y avisos sin repeticiones."""

    def _p(self, pid, store, price, available=True, valor=None, title="ETB Destined Rivals Inglés"):
        return Product(id=pid, store=store, title=title, url=f"https://{store}.test/{pid}", price=price,
                       available=available, category="sellado", extra={"valor": valor} if valor else {})

    def test_find(self):
        from pokeradar import deals
        cheap = self._p("a", "s1", 50.0)
        group = [cheap, self._p("b", "s2", 60.0), self._p("c", "s3", 62.0, available=False)]
        cm = self._p("d", "s4", 80.0, valor={"m": 100.0, "vm": -0.2})
        pricey_cm = self._p("e", "s5", 50.0, valor={"m": 40.0, "vm": 0.25})
        group2 = [pricey_cm, self._p("f", "s6", 60.0), self._p("g", "s7", 61.0)]
        crazy = self._p("h", "s8", 5.0, valor={"m": 100.0, "vm": -0.95})
        soldout = self._p("i", "s9", 70.0, available=False, valor={"m": 100.0, "vm": -0.3})
        found = deals.find([*group, cm, *group2, crazy, soldout], [group, group2])
        self.assertEqual(found["a"]["vs"], "tiendas")
        self.assertEqual(found["a"]["n"], 2)
        self.assertAlmostEqual(found["a"]["ref"], 61.0)
        self.assertEqual(found["d"], {"pct": 0.2, "ref": 100.0, "vs": "cm"})
        self.assertNotIn("e", found)      # más barato que otras tiendas, pero más caro que Cardmarket
        self.assertNotIn("h", found)      # demasiado bueno para ser verdad
        self.assertNotIn("i", found)      # sin stock
        self.assertIn("otras 2 tiendas", deals.describe(found["a"]))

    def test_notified_once_unless_cheaper(self):
        from pokeradar.__main__ import mark_deals
        with tempfile.TemporaryDirectory() as tmp:
            state = State(Path(tmp))
            state.store_state = {s: {"seeded": True} for s in ("s1", "s2", "s3")}
            a, b, c = self._p("a", "s1", 50.0), self._p("b", "s2", 60.0), self._p("c", "s3", 62.0)
            state.items = {p.id: p for p in (a, b, c)}
            groups = [[a, b, c]]
            first = mark_deals(state, groups, [], silent=False)
            self.assertEqual([e["type"] for e in first], ["chollo"])
            self.assertIsNotNone(a.extra.get("g"))
            self.assertEqual(mark_deals(state, groups, [], silent=False), [])   # mismo precio: no repite
            # la siguiente pasada vuelve a descargar el producto: no debe olvidar que ya se avisó
            state.merge("s1", [self._p("a", "s1", 50.0)], CFG)
            a = state.items["a"]
            groups = [[a, b, c]]
            self.assertEqual(mark_deals(state, groups, [], silent=False), [])
            a.price = 47.0
            self.assertEqual(len(mark_deals(state, groups, [], silent=False)), 1)  # ha bajado más
            a.available = False
            mark_deals(state, groups, [], silent=False)
            self.assertNotIn("chollo", a.extra)
            a.available = True
            restock = {"type": "restock", "id": "a", "title": a.title, "store": "s1"}
            self.assertEqual(mark_deals(state, groups, [restock], silent=False), [])
            self.assertIn("chollo", restock)                  # se añade al aviso de reposición
            # el aviso sale como chollo y prioritario
            msg = notify.build([restock], CFG, {"s1": "Tienda 1"})[0]
            self.assertTrue(msg.title.startswith("🔥 Chollo · Vuelve a stock"))
            self.assertEqual(msg.priority, 5)
            self.assertIn("más barato que en otras 2 tiendas", msg.body)


class ShopifyCollectionsTest(unittest.TestCase):
    def test_reads_collections_once_each(self):
        prod = lambda i, title: {"id": i, "title": title, "handle": f"h{i}", "variants": [{"price": "10.00", "available": True}]}
        client = FakeClient([
            {"products": [prod(1, "Pokémon ETB Destined Rivals"), prod(2, "Funda Dragon Shield")]},  # /products.json
            {"products": [prod(1, "Pokémon ETB Destined Rivals"), prod(3, "Pokémon Booster Bundle 151")]},
        ])
        store = {"id": "sun", "url": "https://sun.test", "max_pages": 1, "collections": ["pokemon"]}
        items = shopify.fetch(client, store, CFG)
        self.assertEqual([p.id for p in items], ["sun:1", "sun:3"])   # sin repetidos ni lo que no es Pokémon
        self.assertEqual(client.urls, ["https://sun.test/products.json?limit=250&page=1",
                                       "https://sun.test/collections/pokemon/products.json?limit=250&page=1"])

    def test_store_config_change_is_detected(self):
        from pokeradar.__main__ import fetch_hash
        a = {"id": "x", "url": "https://x.test", "max_pages": 1, "trustpilot": {"score": 4}}
        b = {**a, "trustpilot": {"score": 5}}             # cambiar la nota no cambia lo que se lee
        c = {**a, "collections": ["pokemon"]}
        self.assertEqual(fetch_hash(a), fetch_hash(b))
        self.assertNotEqual(fetch_hash(a), fetch_hash(c))



class FocusTest(unittest.TestCase):
    """Colecciones vigiladas de cerca (151, Evoluciones Prismáticas)."""
    FCFG = {**CFG, "notifications": {**CFG["notifications"], "notify_price_drop_pct": 0, "focus_drop_pct": 5},
            "focus": [
                {"id": "151", "name": "151", "match": [r"(?<![\d/.,#])151(?![\d/])", r"\bsv ?0?3[.,]5\b", r"\bsv2a\b"], "search": "151"},
                {"id": "prismaticas", "name": "Evoluciones Prismáticas",
                 "match": ["prismati", r"\bev ?0?8[.,]5\b", "terastal fest"], "search": "prism"},
            ]}

    def test_match(self):
        from pokeradar.focus import match
        cases = {
            "ETB Pokémon 151 (Inglés)": "151", "Booster Bundle Escarlata y Púrpura 151": "151",
            "Pokemon Card 151 SV2a Booster Box - Japonés": "151",
            "Caja de Entrenador Élite Evoluciones Prismáticas": "prismaticas",
            "Coffret Dresseur d'Élite EV08.5 Évolutions Prismatiques": "prismaticas",
            "Terastal Festival ex Booster Box (Japonés)": "prismaticas",
            "Pikachu 025/151 Promo": None, "Mew #151": None, "ETB Destined Rivals": None,
        }
        for title, fid in cases.items():
            self.assertEqual(match(title, self.FCFG), fid, title)

    def test_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            st = State(Path(tmp))
            old = iso(400)
            mk = lambda pid, title, price, cat="sellado": Product(
                id=pid, store="s", title=title, url="u", price=price, available=True, category=cat, created=old)
            st.merge("s", [mk("a", "ETB 151 Inglés", 100.0), mk("b", "ETB Destined Rivals", 100.0)], self.FCFG)
            ev = st.merge("s", [mk("a", "ETB 151 Inglés", 94.0), mk("b", "ETB Destined Rivals", 94.0),
                                mk("c", "Booster Bundle Evoluciones Prismáticas", 60.0),   # antiguo, pero vigilado
                                mk("d", "Charizard ex 199/165 151", 300.0, "carta suelta")], self.FCFG)
            got = {(e["id"], e["type"], e.get("focus")) for e in ev}
            self.assertEqual(got, {("a", "price_drop", "151"), ("c", "new", "prismaticas")})
            self.assertEqual(st.items["a"].extra.get("focus"), "151")
            msgs = notify.build(ev, self.FCFG, {"s": "Tienda"})
            heads = sorted(m.title for m in msgs)
            self.assertIn("⭐ 151 · 💸 Baja de precio · Tienda", heads)
            self.assertTrue(all(m.priority == 5 for m in msgs))

    def test_woocommerce_searches_watched_sets(self):
        item = lambda i, name: {"id": i, "name": name, "permalink": f"https://w.test/{i}",
                                "prices": {"price": "1000", "currency_minor_unit": 2}, "is_in_stock": True}
        client = FakeClient([[item(1, "Pokémon ETB Destined Rivals")],
                             [item(2, "Pokémon ETB 151"), item(1, "Pokémon ETB Destined Rivals")],
                             [item(3, "Pokémon Booster Bundle Evoluciones Prismáticas")]])
        items = woocommerce.fetch(client, {"id": "w", "url": "https://w.test", "max_pages": 1}, self.FCFG)
        self.assertEqual([p.id for p in items], ["w:1", "w:2", "w:3"])
        self.assertTrue(client.urls[1].endswith("search=151&per_page=50"))
