from __future__ import annotations

from tests.conftest import ApiContext, auth_headers, login, seeded_resources

MENU_URL = "/api/v1/qr/public/dixora-lab/merkez"


async def _burger(api: ApiContext) -> tuple[dict[str, str], dict]:
    tokens = await login(api)
    headers = auth_headers(tokens)
    resources = await seeded_resources(api, headers)
    return headers, resources["burger"]


async def test_public_menu_exposes_calories(api: ApiContext) -> None:
    response = await api.client.get(MENU_URL)
    assert response.status_code == 200, response.text
    assert all("calories" in product for product in response.json()["products"])


async def test_business_can_save_and_serve_its_own_translation(api: ApiContext) -> None:
    headers, burger = await _burger(api)

    saved = await api.client.put(
        f"/api/v1/catalog/products/{burger['id']}/translations",
        headers=headers,
        json={
            "translations": {
                "en": {"name": "Classic Burger", "description": "Juicy beef burger"}
            }
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["translations"]["en"]["name"] == "Classic Burger"

    english = await api.client.get(MENU_URL, params={"lang": "en"})
    assert english.status_code == 200, english.text
    names = [product["name"] for product in english.json()["products"]]
    assert "Classic Burger" in names


async def test_untranslated_fields_fall_back_to_the_source_language(
    api: ApiContext,
) -> None:
    """A half-translated menu stays readable instead of showing gaps."""
    headers, burger = await _burger(api)
    await api.client.put(
        f"/api/v1/catalog/products/{burger['id']}/translations",
        headers=headers,
        json={"translations": {"en": {"name": "Classic Burger"}}},
    )

    english = await api.client.get(MENU_URL, params={"lang": "en"})
    translated = next(
        product
        for product in english.json()["products"]
        if product["name"] == "Classic Burger"
    )
    turkish = await api.client.get(MENU_URL)
    original = next(
        product for product in turkish.json()["products"] if product["id"] == translated["id"]
    )
    # Description was never translated, so it is served as authored.
    assert translated["description"] == original["description"]


async def test_editing_the_source_marks_the_translation_stale(api: ApiContext) -> None:
    headers, burger = await _burger(api)
    await api.client.put(
        f"/api/v1/catalog/products/{burger['id']}/translations",
        headers=headers,
        json={"translations": {"en": {"name": "Classic Burger"}}},
    )
    fresh = await api.client.get(
        f"/api/v1/catalog/products/{burger['id']}/translations", headers=headers
    )
    assert fresh.json()["translations"]["en"]["stale"] is False

    await api.client.patch(
        f"/api/v1/catalog/products/{burger['id']}",
        headers=headers,
        json={"name": "Efsane Burger"},
    )
    after = await api.client.get(
        f"/api/v1/catalog/products/{burger['id']}/translations", headers=headers
    )
    assert after.json()["translations"]["en"]["stale"] is True, (
        "editing the Turkish source must flag the translation for review"
    )


async def test_blank_translation_clears_the_override(api: ApiContext) -> None:
    headers, burger = await _burger(api)
    await api.client.put(
        f"/api/v1/catalog/products/{burger['id']}/translations",
        headers=headers,
        json={"translations": {"en": {"name": "Classic Burger"}}},
    )
    cleared = await api.client.put(
        f"/api/v1/catalog/products/{burger['id']}/translations",
        headers=headers,
        json={"translations": {"en": {"name": ""}}},
    )
    assert cleared.status_code == 200, cleared.text
    assert "en" not in cleared.json()["translations"]


async def test_unsupported_locale_is_rejected_on_write(api: ApiContext) -> None:
    headers, burger = await _burger(api)
    response = await api.client.put(
        f"/api/v1/catalog/products/{burger['id']}/translations",
        headers=headers,
        json={"translations": {"klingon": {"name": "tlhIngan"}}},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unsupported_locale"


async def test_unknown_menu_language_falls_back_to_source(api: ApiContext) -> None:
    response = await api.client.get(MENU_URL, params={"lang": "klingon"})
    assert response.status_code == 200, response.text
    turkish = await api.client.get(MENU_URL)
    assert [p["name"] for p in response.json()["products"]] == [
        p["name"] for p in turkish.json()["products"]
    ]


async def test_translations_are_not_writable_across_tenants(api: ApiContext) -> None:
    """A product id from another business must not be translatable under this one."""
    headers, _ = await _burger(api)
    response = await api.client.put(
        "/api/v1/catalog/products/00000000-0000-0000-0000-0000000000aa/translations",
        headers=headers,
        json={"translations": {"en": {"name": "Stolen"}}},
    )
    assert response.status_code == 404
