from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader

from tests.conftest import ApiContext, auth_headers, login
from tests.test_reports import _seed_sales_analytics_data


async def test_pdf_uses_the_same_decimal_summary_and_renders_turkish(api: ApiContext) -> None:
    start, end = await _seed_sales_analytics_data(api)
    headers = auth_headers(await login(api))
    query = {"date_from": start.isoformat(), "date_to": end.isoformat()}
    summary = await api.client.get(
        "/api/v1/reports/financial-summary", headers=headers, params=query
    )
    assert summary.status_code == 200, summary.text
    legacy = await api.client.get("/api/v1/reports/sales-summary", headers=headers, params=query)
    assert summary.json()["gross_sales"] == legacy.json()["gross_sales"]
    assert summary.json()["paid_orders"] == legacy.json()["paid_orders"]
    pdf = await api.client.get("/api/v1/reports/export.pdf", headers=headers, params=query)
    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF-")
    assert pdf.headers["content-type"] == "application/pdf"
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf.content)).pages)
    assert "Satış ve mutabakat raporu" in text
    assert "320,00 TL" in text
    assert "İşletme içi rapor" in text
    assert "Sayfa 1" in text


async def test_report_pdf_enforces_permissions_and_range(api: ApiContext) -> None:
    waiter = auth_headers(await login(api, username="waiter@dixora.test"))
    query = {"date_from": "2026-11-01", "date_to": "2026-11-04"}
    assert (
        await api.client.get("/api/v1/reports/export.pdf", headers=waiter, params=query)
    ).status_code == 403
    owner = auth_headers(await login(api))
    query = {"date_from": "2026-11-04", "date_to": "2026-11-01"}
    assert (
        await api.client.get("/api/v1/reports/export.pdf", headers=owner, params=query)
    ).status_code == 422
    empty = await api.client.get(
        "/api/v1/reports/export.pdf",
        headers=owner,
        params={"date_from": "2020-01-01", "date_to": "2020-01-01"},
    )
    assert empty.status_code == 200, empty.text
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(empty.content)).pages)
    assert "Veri yok" in text
