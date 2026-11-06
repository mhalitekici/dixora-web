from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from reportlab.lib import colors  # type: ignore[import-untyped]
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.styles import ParagraphStyle  # type: ignore[import-untyped]
from reportlab.pdfbase import pdfmetrics  # type: ignore[import-untyped]
from reportlab.pdfbase.ttfonts import TTFont  # type: ignore[import-untyped]
from reportlab.platypus import (  # type: ignore[import-untyped]
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import Identity, require_branch, require_tenant
from app.errors import DomainError
from app.models import Branch, BusinessDayClose, CashierShift, Payment, Tenant
from app.models.enums import PaymentStatus
from app.security import as_utc, utcnow
from app.services.cashier_reconciliation import money, shift_totals

ASSETS = Path(__file__).resolve().parent.parent / "assets"


async def report_bounds(
    db: AsyncSession,
    identity: Identity,
    start: date | datetime,
    end: date | datetime,
) -> tuple[datetime, datetime, Branch]:
    branch = await db.get(Branch, require_branch(identity))
    if branch is None or branch.tenant_id != require_tenant(identity):
        raise DomainError("branch_not_found", "Şube bulunamadı.", status_code=404)
    zone = ZoneInfo(branch.timezone)
    first = (
        as_utc(start)
        if isinstance(start, datetime)
        else datetime.combine(start, time.min, zone).astimezone(UTC)
    )
    last = (
        as_utc(end)
        if isinstance(end, datetime)
        else datetime.combine(end + timedelta(days=1), time.min, zone).astimezone(UTC)
    )
    days = (
        (end - start).days + 1
        if not isinstance(start, datetime) and not isinstance(end, datetime)
        else None
    )
    if last <= first or (days is not None and days > 366) or last - first > timedelta(days=367):
        raise DomainError(
            "invalid_report_range",
            "Geçerli, en fazla 366 günlük tarih aralığı seçin.",
            status_code=422,
        )
    return first, last, branch


async def reconciliation_report(
    db: AsyncSession,
    identity: Identity,
    branch: Branch,
    start: datetime,
    end: datetime,
    sales: dict[str, Any],
) -> dict[str, Any]:
    tenant_id = require_tenant(identity)
    tenant = await db.get(Tenant, tenant_id)
    first, last = start.replace(tzinfo=None), end.replace(tzinfo=None)
    payments = (
        (
            await db.execute(
                select(Payment).where(
                    Payment.tenant_id == tenant_id,
                    Payment.branch_id == branch.id,
                    Payment.status.in_([PaymentStatus.COMPLETED, PaymentStatus.REFUNDED]),
                    (
                        ((Payment.created_at >= first) & (Payment.created_at < last))
                        | ((Payment.refunded_at >= first) & (Payment.refunded_at < last))
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    collections: dict[str, Decimal] = {}
    refunds: dict[str, Decimal] = {}
    for payment in payments:
        if start <= as_utc(payment.created_at) < end:
            collections[payment.method] = (
                collections.get(payment.method, Decimal()) + payment.amount
            )
        if payment.refunded_at and start <= as_utc(payment.refunded_at) < end:
            refunds[payment.method] = refunds.get(payment.method, Decimal()) + payment.amount
    zone = ZoneInfo(branch.timezone)
    first_day = start.astimezone(zone).date()
    last_day = (end - timedelta(microseconds=1)).astimezone(zone).date()
    shifts = (
        (
            await db.execute(
                select(CashierShift)
                .where(
                    CashierShift.tenant_id == tenant_id,
                    CashierShift.branch_id == branch.id,
                    CashierShift.business_date >= first_day,
                    CashierShift.business_date <= last_day,
                )
                .order_by(CashierShift.business_date, CashierShift.opened_at)
            )
        )
        .scalars()
        .all()
    )
    shift_rows = []
    for shift in shifts:
        totals = await shift_totals(db, shift) if shift.status == "OPEN" else None
        shift_rows.append(
            {
                "employee": shift.cashier_name or "Çalışan",
                "date": str(shift.business_date),
                "status": {"OPEN": "Açık", "CLOSED": "Kapalı", "HANDED_OVER": "Devredildi"}.get(
                    shift.status, shift.status
                ),
                "opening_cash": shift.opening_cash,
                "closing_cash": shift.closing_cash,
                "expected_cash": totals.expected_cash if totals else shift.expected_cash,
                "reported_card_total": shift.reported_card_total,
                "cash_variance": shift.cash_variance,
                "card_variance": shift.card_variance,
            }
        )
    days = (
        (
            await db.execute(
                select(BusinessDayClose)
                .where(
                    BusinessDayClose.tenant_id == tenant_id,
                    BusinessDayClose.branch_id == branch.id,
                    BusinessDayClose.business_date >= first_day,
                    BusinessDayClose.business_date <= last_day,
                )
                .order_by(BusinessDayClose.business_date)
            )
        )
        .scalars()
        .all()
    )
    return {
        **sales,
        "business": tenant.name if tenant else "İşletme",
        "branch": branch.name,
        "timezone": branch.timezone,
        "date_from": str(first_day),
        "date_to": str(last_day),
        "generated_at": utcnow().astimezone(zone).isoformat(),
        "actor": identity.display_name,
        "collections": {key: money(value) for key, value in collections.items()},
        "refunds": {key: money(value) for key, value in refunds.items()},
        "net_collections": money(
            sum(collections.values(), Decimal()) - sum(refunds.values(), Decimal())
        ),
        "shifts": shift_rows,
        "days": [
            {
                "date": str(day.business_date),
                "cash_difference": day.cash_difference,
                "card_difference": day.card_difference,
                "sales_total": day.sales_total,
            }
            for day in days
        ],
    }


def render_report_pdf(report: dict[str, Any]) -> bytes:
    for name, filename in (("Dixora", "NotoSans-Regular.ttf"), ("DixoraBold", "NotoSans-Bold.ttf")):
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, str(ASSETS / filename)))
    body = ParagraphStyle("body", fontName="Dixora", fontSize=8, leading=12, wordWrap="CJK")
    title = ParagraphStyle(
        "title", parent=body, fontName="DixoraBold", fontSize=16, leading=21, spaceAfter=12
    )
    heading = ParagraphStyle(
        "heading",
        parent=body,
        fontName="DixoraBold",
        fontSize=11,
        leading=16,
        spaceBefore=14,
        spaceAfter=7,
    )

    def p(value: object) -> Any:
        return Paragraph(escape(str(value)), body)

    def amount(value: object) -> str:
        if value is None:
            return "Veri yok"
        return (
            f"{Decimal(str(value)):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
            + " TL"
        )

    def table(rows: list[list[object]], widths: list[int]) -> Any:
        result = Table(
            [[p(cell) for cell in row] for row in rows],
            colWidths=widths,
            repeatRows=1,
            hAlign="LEFT",
        )
        result.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fff0e6")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#e06526")),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                ]
            )
        )
        return result

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=36,
        leftMargin=36,
        topMargin=35,
        bottomMargin=44,
        title="Dixora satış ve mutabakat raporu",
        author=str(report["actor"]),
    )
    logo = Image(
        str(ASSETS / "dixora-logo.png"), width=110, height=38, kind="proportional", hAlign="LEFT"
    )
    story = [
        logo,
        Spacer(1, 12),
        Paragraph("Satış ve mutabakat raporu", title),
        p(f"{report['business']} · {report['branch']}"),
        p(f"Dönem: {report['date_from']} – {report['date_to']} ({report['timezone']})"),
        p(f"Oluşturan: {report['actor']} · {report['generated_at']}"),
        p(
            "Satışlar ödeme tamamlanma, tahsilatlar ödeme, iadeler iade tarihiyle döneme alınır. "
            "Vardiya ve gün sonu işletme tarihine göre listelenir."
        ),
    ]
    metrics: list[list[object]] = [
        ["Gösterge", "Tutar / adet"],
        ["Toplam satış", amount(report["gross_sales"])],
        ["Ödenmiş sipariş", report["paid_orders"]],
        ["Ortalama sipariş", amount(report["average_order_value"])],
    ]
    for method, label in (("CASH", "Nakit"), ("CARD", "Kart")):
        metrics.extend(
            [
                [f"{label} tahsilat", amount(report["collections"].get(method, 0))],
                [f"{label} iade", amount(report["refunds"].get(method, 0))],
            ]
        )
    metrics.append(["Net tahsilat", amount(report["net_collections"])])
    story.extend(
        [
            Paragraph("Dönem özeti", heading),
            table(metrics, [300, 220]),
            Paragraph("Ödeme yöntemi dağılımı", heading),
            table(
                [["Yöntem", "Tahsilat", "İade"]]
                + [
                    [
                        {"CASH": "Nakit", "CARD": "Kart"}.get(method, method),
                        amount(report["collections"].get(method, 0)),
                        amount(report["refunds"].get(method, 0)),
                    ]
                    for method in sorted(set(report["collections"]) | set(report["refunds"]))
                ],
                [180, 170, 170],
            ),
        ]
    )
    story.append(Paragraph("Vardiya özeti", heading))
    if not report["shifts"]:
        story.append(p("Veri yok"))
    for shift in report["shifts"]:
        story.extend(
            [
                p(f"{shift['employee']} · {shift['date']} · {shift['status']}"),
                table(
                    [
                        ["Açılış / beklenen / sayılan", "POS/Z bildirimi", "Kasa / POS farkı"],
                        [
                            " / ".join(
                                amount(shift[key])
                                for key in ("opening_cash", "expected_cash", "closing_cash")
                            ),
                            amount(shift["reported_card_total"]),
                            " / ".join(
                                amount(shift[key]) for key in ("cash_variance", "card_variance")
                            ),
                        ],
                    ],
                    [220, 130, 170],
                ),
            ]
        )
    story.append(Paragraph("Gün sonu kayıtları", heading))
    story.append(
        table(
            [["İşletme tarihi", "Satış", "Kasa farkı", "POS farkı"]]
            + [
                [
                    day["date"],
                    amount(day["sales_total"]),
                    amount(day["cash_difference"]),
                    amount(day["card_difference"]),
                ]
                for day in report["days"]
            ],
            [130, 130, 130, 130],
        )
        if report["days"]
        else p("Veri yok")
    )

    def footer(canvas: Any, doc: Any) -> None:
        canvas.setFont("Dixora", 7)
        canvas.drawString(36, 24, "İşletme içi rapor · Resmi mali fiş veya ÖKC belgesi değildir.")
        canvas.drawRightString(A4[0] - 36, 24, f"Sayfa {doc.page}")

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
