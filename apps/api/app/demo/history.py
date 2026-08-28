"""Runs trade through the demo business.

Ninety days of orders, payments, kitchen tickets, loyalty accruals, stock
movements and till handovers — written with bulk inserts rather than the order
service, because the service is built to take one order at a time from a human
and this needs to write roughly a hundred thousand rows.

The arithmetic still follows the service's rules: line totals are unit price
times quantity, an order is PAID only once its payments cover the total, a
cancelled line leaves the subtotal, and a loyalty reward is issued on the tenth
qualifying visit. What is skipped is only the machinery that has no meaning for
data that is already in the past — websocket broadcasts, idempotency replay,
optimistic locking.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from random import Random
from typing import Any, TypeVar
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import insert, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.demo import data as D
from app.demo.context import BranchContext, DemoContext, MembershipContext, ProductContext
from app.models import (
    ApprovalRequest,
    Cancellation,
    CashierShift,
    DeliveryOrder,
    DiningTable,
    Discount,
    KitchenTicket,
    KitchenTicketItem,
    LoyaltyLedgerEntry,
    LoyaltyRedemption,
    LoyaltyReward,
    Order,
    OrderItem,
    OrderItemModifier,
    Payment,
    PrintJob,
    QrOrderRequest,
    StockBalance,
    StockMovement,
    TableSession,
)
from app.models.enums import (
    ApprovalStatus,
    ApprovalType,
    DeliveryChannel,
    DeliveryPaymentMethod,
    DeliveryPaymentStatus,
    DeliveryStatus,
    DiscountKind,
    KitchenTicketStatus,
    LoyaltyLedgerEntryType,
    LoyaltyRedemptionStatus,
    LoyaltyRewardStatus,
    MarketplaceProvider,
    OrderItemStatus,
    OrderSource,
    OrderStatus,
    PaymentStatus,
    PrintJobKind,
    PrintJobStatus,
    ProviderSyncStatus,
    QrRequestStatus,
    TableSessionStatus,
    TableState,
)

IST = ZoneInfo("Europe/Istanbul")
CENT = Decimal("0.01")
ZERO = Decimal("0.00")

MAIN_CATEGORIES = (
    "Izgara & Ana Yemekler",
    "Deniz Ürünleri",
    "Makarna & Risotto",
    "Burger & Sandviç",
    "Pizzalar",
)
STARTER_CATEGORIES = ("Başlangıçlar", "Çorbalar", "Salatalar")
DRINK_CATEGORIES = ("Sıcak İçecekler", "Soğuk İçecekler")
HOT_DRINK_CATEGORY = "Sıcak İçecekler"
DESSERT_CATEGORY = "Tatlılar"
BREAKFAST_CATEGORY = "Kahvaltı"

# Monday=0 … Sunday=6. Friday and Saturday carry the week.
WEEKDAY_FACTOR = (0.80, 0.84, 0.90, 1.00, 1.35, 1.50, 1.18)

# (hour, weight) across a trading day that opens at 09:00 and closes at 23:30.
HOUR_WEIGHTS: tuple[tuple[int, int], ...] = (
    (9, 5), (10, 7), (11, 8),
    (12, 14), (13, 16), (14, 10),
    (15, 6), (16, 5), (17, 6),
    (18, 9), (19, 15), (20, 17),
    (21, 13), (22, 8), (23, 4),
)

SOURCE_WEIGHTS: tuple[tuple[OrderSource, int], ...] = (
    (OrderSource.WAITER, 52),
    (OrderSource.CASHIER, 17),
    (OrderSource.QR, 12),
    (OrderSource.TAKEAWAY, 10),
    (OrderSource.DELIVERY, 9),
)

ITEM_NOTES = (
    "Az acılı olsun",
    "Soğansız",
    "Sos ayrı gelsin",
    "Servisi biraz geciktirin",
    "Glutensiz ekmekle",
    "Çok pişmiş istiyoruz",
)

DINE_IN_SOURCES = {OrderSource.WAITER, OrderSource.QR, OrderSource.CASHIER}

Row = dict[str, Any]
T = TypeVar("T")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _utc(local: datetime) -> datetime:
    return local.replace(tzinfo=IST).astimezone(UTC)


def _pick(rng: Random, weighted: Sequence[tuple[T, int]]) -> T:
    total = sum(weight for _, weight in weighted)
    roll = rng.randrange(total)
    for value, weight in weighted:
        roll -= weight
        if roll < 0:
            return value
    return weighted[-1][0]


class Pool:
    """A weighted draw over a set of products, precomputed once."""

    def __init__(self, products: list[ProductContext]) -> None:
        self.products = products
        self.cumulative: list[int] = []
        running = 0
        for product in products:
            running += max(product.spec.popularity, 1)
            self.cumulative.append(running)
        self.total = running

    def pick(self, rng: Random) -> ProductContext:
        roll = rng.randrange(self.total)
        low, high = 0, len(self.cumulative) - 1
        while low < high:
            mid = (low + high) // 2
            if self.cumulative[mid] <= roll:
                low = mid + 1
            else:
                high = mid
        return self.products[low]


@dataclass
class Line:
    product: ProductContext
    quantity: Decimal
    unit_price: Decimal
    modifiers: tuple[tuple[UUID, str, Decimal], ...]
    note: str | None = None
    status: OrderItemStatus = OrderItemStatus.SERVED
    # Set when the line is given away by a loyalty reward or a campaign.
    free: bool = False

    @property
    def line_total(self) -> Decimal:
        return money(self.unit_price * self.quantity)


@dataclass
class Rows:
    """Every table this module writes, kept as plain dicts until the bulk flush."""

    table_sessions: list[Row] = field(default_factory=list)
    orders: list[Row] = field(default_factory=list)
    order_items: list[Row] = field(default_factory=list)
    order_item_modifiers: list[Row] = field(default_factory=list)
    payments: list[Row] = field(default_factory=list)
    discounts: list[Row] = field(default_factory=list)
    cancellations: list[Row] = field(default_factory=list)
    approvals: list[Row] = field(default_factory=list)
    kitchen_tickets: list[Row] = field(default_factory=list)
    kitchen_ticket_items: list[Row] = field(default_factory=list)
    ledger_entries: list[Row] = field(default_factory=list)
    rewards: list[Row] = field(default_factory=list)
    redemptions: list[Row] = field(default_factory=list)
    delivery_orders: list[Row] = field(default_factory=list)
    shifts: list[Row] = field(default_factory=list)
    stock_movements: list[Row] = field(default_factory=list)
    print_jobs: list[Row] = field(default_factory=list)
    qr_requests: list[Row] = field(default_factory=list)


@dataclass
class Totals:
    orders: int = 0
    paid_orders: int = 0
    gross: Decimal = ZERO
    items: int = 0
    live_orders: int = 0


@dataclass
class _Pools:
    mains: Pool
    starters: Pool
    drinks: Pool
    hot_drinks: Pool
    desserts: Pool
    breakfast: Pool
    all_day: Pool


def _build_pools(context: DemoContext) -> _Pools:
    def of(*categories: str) -> Pool:
        products: list[ProductContext] = []
        for category in categories:
            products.extend(context.products_by_category.get(category, []))
        return Pool(products)

    return _Pools(
        mains=of(*MAIN_CATEGORIES),
        starters=of(*STARTER_CATEGORIES),
        drinks=of(*DRINK_CATEGORIES),
        hot_drinks=of(HOT_DRINK_CATEGORY),
        desserts=of(DESSERT_CATEGORY),
        breakfast=of(BREAKFAST_CATEGORY),
        all_day=of(*context.products_by_category.keys()),
    )


def _choose_modifiers(
    rng: Random, context: DemoContext, product: ProductContext
) -> tuple[tuple[UUID, str, Decimal], ...]:
    groups = context.modifier_groups_by_product.get(product.id)
    if not groups:
        return ()
    chosen: list[tuple[UUID, str, Decimal]] = []
    for group in groups:
        if group.is_required:
            chosen.append(rng.choice(list(group.options)))
            continue
        if rng.random() < 0.3:
            limit = min(group.maximum or 1, 2)
            for option in rng.sample(list(group.options), rng.randint(1, limit)):
                chosen.append(option)
    return tuple(chosen)


def _make_line(
    rng: Random,
    context: DemoContext,
    product: ProductContext,
    *,
    quantity: int = 1,
) -> Line:
    modifiers = _choose_modifiers(rng, context, product)
    unit_price = money(product.price + sum((delta for _, _, delta in modifiers), ZERO))
    return Line(
        product=product,
        quantity=Decimal(quantity),
        unit_price=unit_price,
        modifiers=modifiers,
        note=rng.choice(ITEM_NOTES) if rng.random() < 0.08 else None,
    )


def _merge(lines: list[Line]) -> list[Line]:
    """Two identical picks become one line with quantity 2, as a waiter would key it."""
    merged: dict[tuple[Any, ...], Line] = {}
    for line in lines:
        key = (
            line.product.id,
            tuple(sorted(str(mid) for mid, _, _ in line.modifiers)),
            line.note,
            line.free,
        )
        existing = merged.get(key)
        if existing is None:
            merged[key] = line
        else:
            existing.quantity += line.quantity
    return list(merged.values())


def _compose_basket(
    rng: Random,
    context: DemoContext,
    pools: _Pools,
    *,
    hour: int,
    source: OrderSource,
) -> list[Line]:
    lines: list[Line] = []
    dine_in = source in DINE_IN_SOURCES

    if hour <= 11 and rng.random() < 0.55:
        guests = rng.choice((1, 2, 2, 2, 3, 4))
        for _ in range(guests):
            lines.append(_make_line(rng, context, pools.breakfast.pick(rng)))
        for _ in range(guests):
            lines.append(_make_line(rng, context, pools.hot_drinks.pick(rng)))
        return _merge(lines)

    guests = (
        rng.choice((1, 2, 2, 2, 3, 3, 4, 4, 5, 6)) if dine_in else rng.choice((1, 1, 2, 2, 3))
    )
    for _ in range(guests):
        if rng.random() < 0.9:
            lines.append(_make_line(rng, context, pools.mains.pick(rng)))
    if dine_in:
        for _ in range(rng.choice((0, 1, 1, 2, 2, 3) if guests >= 3 else (0, 0, 1, 1, 2))):
            lines.append(_make_line(rng, context, pools.starters.pick(rng)))
    for _ in range(guests if dine_in else rng.choice((0, 1, 1, 2))):
        lines.append(_make_line(rng, context, pools.drinks.pick(rng)))
    if rng.random() < (0.32 if dine_in else 0.12):
        for _ in range(rng.choice((1, 1, 2))):
            lines.append(_make_line(rng, context, pools.desserts.pick(rng)))

    if not lines:
        lines.append(_make_line(rng, context, pools.mains.pick(rng)))
    return _merge(lines)


def _delivery_address(rng: Random) -> tuple[str, str, str]:
    district, neighbourhood = rng.choice(D.DELIVERY_DISTRICTS)
    line = (
        f"{neighbourhood} Mah. {rng.choice(D.STREET_NAMES)} "
        f"No:{rng.randint(1, 90)} D:{rng.randint(1, 18)}"
    )
    return line, district, neighbourhood


class HistoryBuilder:
    def __init__(
        self,
        context: DemoContext,
        *,
        rng: Random,
        history_days: int,
        now: datetime,
    ) -> None:
        self.context = context
        self.rng = rng
        self.history_days = history_days
        self.now = now
        self.local_now = now.astimezone(IST)
        self.today = self.local_now.date()
        self.pools = _build_pools(context)
        self.rows = Rows()
        self.totals = Totals()
        self.sequence = 0
        self.memberships_by_branch: dict[UUID, list[MembershipContext]] = {}
        for membership in context.memberships:
            self.memberships_by_branch.setdefault(membership.branch_id, []).append(membership)
        # (branch id, day) -> {"CASH": Decimal, "CARD": Decimal, "total": Decimal}
        self.day_takings: dict[tuple[UUID, date], dict[str, Decimal]] = {}
        # (branch id, inventory item id) -> [(when, movement type, delta, order_item_id)]
        self.stock_deltas: dict[
            tuple[UUID, UUID], list[tuple[datetime, str, Decimal, UUID | None]]
        ] = {}
        self.table_states: dict[UUID, tuple[TableState, str | None]] = {}
        self.reward_codes: set[str] = set()

    # -- helpers ---------------------------------------------------------

    def _key(self, prefix: str) -> str:
        self.sequence += 1
        return f"demo-{prefix}-{self.sequence:08d}"

    def _reward_code(self) -> str:
        while True:
            body = "".join(
                self.rng.choice("ACDEFGHJKMNPQRTUVWXY2346789") for _ in range(10)
            )
            code = f"RW-{body}"
            if code not in self.reward_codes:
                self.reward_codes.add(code)
                return code

    def _record_takings(
        self, branch_id: UUID, day: date, method: str, amount: Decimal
    ) -> None:
        bucket = self.day_takings.setdefault(
            (branch_id, day), {"CASH": ZERO, "CARD": ZERO, "total": ZERO}
        )
        if method == "CASH":
            bucket["CASH"] += amount
        else:
            bucket["CARD"] += amount
        bucket["total"] += amount

    # -- main entry ------------------------------------------------------

    def run(self) -> None:
        start = self.today - timedelta(days=self.history_days)
        day = start
        while day < self.today:
            for branch in self.context.branches:
                self._build_day(branch, day, closed=True)
            day += timedelta(days=1)
        for branch in self.context.branches:
            self._build_day(branch, self.today, closed=False)
            self._build_live_state(branch)
        self._build_shifts()
        self._build_stock_movements()

    # -- one trading day -------------------------------------------------

    def _order_count(self, branch: BranchContext, day: date) -> int:
        factor = WEEKDAY_FACTOR[day.weekday()]
        age = (self.today - day).days
        # The business grew over the window: the oldest day runs at ~82% of
        # today's volume, which is what gives reports an upward trend.
        growth = 1.0 - (age / max(self.history_days, 1)) * 0.18
        noise = self.rng.uniform(0.88, 1.12)
        return max(1, round(branch.spec.weekday_orders * factor * growth * noise))

    def _build_day(self, branch: BranchContext, day: date, *, closed: bool) -> None:
        count = self._order_count(branch, day)
        hours = HOUR_WEIGHTS
        if not closed:
            # Today is still running, so only the hours already behind us have
            # takings — and the day's volume is scaled by their share of a full
            # day rather than by elapsed clock time, which would overstate a
            # morning and understate an evening.
            hours = tuple((hour, weight) for hour, weight in HOUR_WEIGHTS
                          if hour < self.local_now.hour)
            if not hours:
                return
            share = sum(weight for _, weight in hours) / sum(
                weight for _, weight in HOUR_WEIGHTS
            )
            count = max(1, round(count * share))
        for _ in range(count):
            self._build_order(branch, day, _pick(self.rng, hours))

    def _build_order(self, branch: BranchContext, day: date, hour: int) -> None:
        rng = self.rng
        source = _pick(rng, SOURCE_WEIGHTS)
        created_local = datetime.combine(day, datetime.min.time()) + timedelta(
            hours=hour, minutes=rng.randrange(60), seconds=rng.randrange(60)
        )
        created = _utc(created_local)

        lines = _compose_basket(rng, self.context, self.pools, hour=hour, source=source)
        order_cancelled = rng.random() < 0.012

        # --- loyalty: who is this, and do they have a reward waiting? -----
        membership: MembershipContext | None = None
        candidates = self.memberships_by_branch.get(branch.id, [])
        if (
            not order_cancelled
            and candidates
            and source in DINE_IN_SOURCES
            and rng.random() < 0.34
        ):
            membership = rng.choice(candidates)

        redeemed_line: Line | None = None
        if (
            membership is not None
            and membership.available_rewards
            and rng.random() < 0.45
        ):
            redeemed_line = _make_line(rng, self.context, self.pools.desserts.pick(rng))
            redeemed_line.free = True
            lines = _merge([*lines, redeemed_line])

        # --- cancellations ------------------------------------------------
        cancelled_line: Line | None = None
        if not order_cancelled and len(lines) > 1 and rng.random() < 0.025:
            cancelled_line = rng.choice([line for line in lines if not line.free])
            cancelled_line.status = OrderItemStatus.CANCELLED

        # --- timeline ---------------------------------------------------
        submitted = created + timedelta(minutes=rng.randint(0, 2))
        accepted = submitted + timedelta(minutes=rng.randint(1, 3))
        prep_minutes = max((line.product.spec.prep_minutes for line in lines), default=10)
        ready = accepted + timedelta(minutes=max(3, int(prep_minutes * rng.uniform(0.7, 1.4))))
        paid = ready + timedelta(
            minutes=rng.randint(12, 55) if source in DINE_IN_SOURCES else rng.randint(2, 12)
        )
        ceiling = self.now - timedelta(seconds=30)
        if paid > ceiling:
            # A table seated in the last hour would otherwise settle in the
            # future. Slide the whole visit back so the order of events holds.
            slide = paid - ceiling
            created -= slide
            submitted -= slide
            accepted -= slide
            ready -= slide
            paid = ceiling

        order_id = uuid4()

        subtotal = ZERO
        for line in lines:
            if line.status is not OrderItemStatus.CANCELLED:
                subtotal += line.line_total
        subtotal = money(subtotal)
        if order_cancelled:
            # Cancelling every line zeroes the check, which is what the order
            # service does once the last item is cancelled.
            subtotal = ZERO

        # --- discounts ----------------------------------------------------
        discount_total = ZERO
        discount_rows: list[Row] = []
        waiter_id = (
            rng.choice(branch.waiters)
            if branch.waiters and source is OrderSource.WAITER
            else (rng.choice(branch.cashiers) if branch.cashiers else branch.manager_id)
        )
        actor_id = waiter_id or branch.manager_id

        if redeemed_line is not None and membership is not None:
            reward_amount = redeemed_line.line_total
            discount_id = uuid4()
            discount_total += reward_amount
            discount_rows.append(
                self._discount_row(
                    discount_id,
                    branch=branch,
                    order_id=order_id,
                    order_item_id=None,
                    kind=DiscountKind.FIXED,
                    value=reward_amount,
                    amount=reward_amount,
                    reason=f"Sadakat ödülü · {redeemed_line.product.name}",
                    requested_by=actor_id,
                    approved_by=branch.manager_id,
                    when=created,
                )
            )
            self._redeem_reward(
                membership,
                branch=branch,
                order_id=order_id,
                line=redeemed_line,
                discount_id=discount_id,
                amount=reward_amount,
                actor_id=actor_id or branch.manager_id,
                when=created,
            )

        if not order_cancelled and rng.random() < 0.07:
            percent = Decimal(rng.choice((10, 15, 20)))
            amount = money((subtotal - discount_total) * percent / Decimal(100))
            if amount > ZERO:
                discount_total += amount
                discount_rows.append(
                    self._discount_row(
                        uuid4(),
                        branch=branch,
                        order_id=order_id,
                        order_item_id=None,
                        kind=DiscountKind.PERCENTAGE,
                        value=percent,
                        amount=amount,
                        reason=rng.choice(D.DISCOUNT_REASONS),
                        requested_by=actor_id,
                        approved_by=branch.manager_id,
                        when=created,
                    )
                )
                self.rows.approvals.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "branch_id": branch.id,
                        "order_id": order_id,
                        "order_item_id": None,
                        "requested_by_user_id": actor_id,
                        "resolved_by_user_id": branch.manager_id,
                        "approval_type": ApprovalType.DISCOUNT,
                        "status": ApprovalStatus.APPROVED,
                        "payload": {"percent": str(percent), "amount": str(amount)},
                        "reason": discount_rows[-1]["reason"],
                        "resolved_at": created + timedelta(minutes=2),
                        "created_at": created,
                        "updated_at": created,
                    }
                )

        total = money(max(subtotal - discount_total, ZERO))

        # --- table session -------------------------------------------------
        table_session_id: UUID | None = None
        if source in DINE_IN_SOURCES and branch.tables:
            table_id, _table_name, _area_id = rng.choice(branch.tables)
            table_session_id = uuid4()
            closed_at = created + timedelta(minutes=rng.randint(45, 150))
            self.rows.table_sessions.append(
                {
                    "id": table_session_id,
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "table_id": table_id,
                    "opened_by_user_id": actor_id,
                    "status": TableSessionStatus.CLOSED,
                    "customer_name": (
                        membership.display_name
                        if membership
                        else (rng.choice(D.GUEST_NAMES) if rng.random() < 0.3 else None)
                    ),
                    "opened_at": created,
                    "closed_at": closed_at,
                    "created_at": created,
                    "updated_at": closed_at,
                }
            )

        status = OrderStatus.CANCELLED if order_cancelled else OrderStatus.PAID
        self.totals.orders += 1
        self.rows.orders.append(
            {
                "id": order_id,
                "tenant_id": self.context.tenant_id,
                "branch_id": branch.id,
                "table_session_id": table_session_id,
                "created_by_user_id": actor_id,
                "loyalty_membership_id": membership.id if membership else None,
                "source": source,
                "status": status,
                "customer_name": (
                    membership.display_name
                    if membership
                    else (
                        rng.choice(D.GUEST_NAMES)
                        if source not in DINE_IN_SOURCES
                        else None
                    )
                ),
                "currency": self.context.currency,
                "subtotal": subtotal,
                "discount_total": money(discount_total),
                "tax_total": ZERO,
                "total": total,
                "idempotency_key": self._key("order"),
                "version": 3,
                "submitted_at": submitted,
                "accepted_at": accepted,
                "paid_at": None if order_cancelled else paid,
                "created_at": created,
                "updated_at": paid,
            }
        )

        # --- lines, modifiers, tickets ---------------------------------------
        by_station: dict[str, list[tuple[UUID, Line]]] = {}
        for line in lines:
            item_id = uuid4()
            station_code = line.product.spec.station
            item_status = (
                OrderItemStatus.CANCELLED
                if line.status is OrderItemStatus.CANCELLED or order_cancelled
                else OrderItemStatus.SERVED
            )
            self.totals.items += 1
            self.rows.order_items.append(
                {
                    "id": item_id,
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "order_id": order_id,
                    "product_id": line.product.id,
                    "preparation_station_id": branch.stations[station_code],
                    "product_name_snapshot": line.product.name,
                    "unit_price": line.unit_price,
                    "quantity": line.quantity,
                    "tax_rate_snapshot": Decimal(line.product.spec.tax_rate),
                    "discount_snapshot": ZERO,
                    "line_total": line.line_total,
                    "status": item_status,
                    "note": line.note,
                    "submitted_at": submitted,
                    "created_at": created,
                    "updated_at": ready,
                }
            )
            for modifier_id, name, delta in line.modifiers:
                self.rows.order_item_modifiers.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "order_item_id": item_id,
                        "modifier_id": modifier_id,
                        "name_snapshot": name,
                        "price_delta_snapshot": delta,
                        "quantity": 1,
                        "created_at": created,
                        "updated_at": created,
                    }
                )
            if line is cancelled_line or order_cancelled:
                self.rows.cancellations.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "branch_id": branch.id,
                        "order_id": order_id,
                        "order_item_id": item_id,
                        "actor_user_id": actor_id,
                        "reason": rng.choice(D.CANCELLATION_REASONS),
                        "reversal_completed": True,
                        "created_at": accepted,
                        "updated_at": accepted,
                    }
                )
            if item_status is not OrderItemStatus.CANCELLED:
                by_station.setdefault(station_code, []).append((item_id, line))
                self._consume_stock(branch, line, item_id, ready)

        for station_code, station_items in by_station.items():
            ticket_id = uuid4()
            started = accepted + timedelta(minutes=rng.randint(0, 4))
            self.rows.kitchen_tickets.append(
                {
                    "id": ticket_id,
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "order_id": order_id,
                    "preparation_station_id": branch.stations[station_code],
                    "batch_number": 1,
                    "status": (
                        KitchenTicketStatus.CANCELLED
                        if order_cancelled
                        else KitchenTicketStatus.COMPLETED
                    ),
                    "accepted_at": accepted,
                    "started_at": started,
                    "ready_at": ready,
                    "completed_at": ready + timedelta(minutes=rng.randint(1, 6)),
                    "created_at": submitted,
                    "updated_at": ready,
                }
            )
            for item_id, _line in station_items:
                self.rows.kitchen_ticket_items.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "branch_id": branch.id,
                        "ticket_id": ticket_id,
                        "order_item_id": item_id,
                        "status": OrderItemStatus.SERVED,
                        "created_at": submitted,
                        "updated_at": ready,
                    }
                )
            if (self.today - day).days <= 2:
                self.rows.print_jobs.append(
                    self._print_job_row(
                        branch=branch,
                        station_code=station_code,
                        order_id=order_id,
                        ticket_id=ticket_id,
                        items=[line for _, line in station_items],
                        when=submitted,
                        status=PrintJobStatus.PRINTED,
                    )
                )

        self.rows.discounts.extend(discount_rows)

        if order_cancelled:
            return

        # --- payments ---------------------------------------------------------
        self.totals.paid_orders += 1
        self.totals.gross += total
        self._add_payments(branch, order_id, total, paid, actor_id, day)

        # --- loyalty accrual --------------------------------------------------
        if membership is not None and total >= Decimal("250.00"):
            self._accrue(membership, branch=branch, order_id=order_id, when=paid)

        # --- delivery companion row --------------------------------------------
        if source in (OrderSource.TAKEAWAY, OrderSource.DELIVERY):
            self._add_delivery(branch, order_id, source, total, created, ready, paid)

    # -- pieces ------------------------------------------------------------

    def _discount_row(
        self,
        discount_id: UUID,
        *,
        branch: BranchContext,
        order_id: UUID,
        order_item_id: UUID | None,
        kind: DiscountKind,
        value: Decimal,
        amount: Decimal,
        reason: str,
        requested_by: UUID | None,
        approved_by: UUID | None,
        when: datetime,
    ) -> Row:
        return {
            "id": discount_id,
            "tenant_id": self.context.tenant_id,
            "branch_id": branch.id,
            "order_id": order_id,
            "order_item_id": order_item_id,
            "requested_by_user_id": requested_by,
            "approved_by_user_id": approved_by,
            "kind": kind,
            "value": value,
            "amount": amount,
            "reason": reason,
            "created_at": when,
            "updated_at": when,
        }

    def _add_payments(
        self,
        branch: BranchContext,
        order_id: UUID,
        total: Decimal,
        paid: datetime,
        actor_id: UUID | None,
        day: date,
    ) -> None:
        if total <= ZERO:
            return
        cashier = (
            self.rng.choice(branch.cashiers) if branch.cashiers else actor_id
        )
        split = self.rng.random() < 0.07 and total > Decimal("400.00")
        if split:
            first = money(total / 2)
            parts = [("CARD", first), ("CASH", money(total - first))]
        else:
            method = _pick(self.rng, D.PAYMENT_METHODS)
            parts = [(method, total)]
        for method, amount in parts:
            self.rows.payments.append(
                {
                    "id": uuid4(),
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "order_id": order_id,
                    "recorded_by_user_id": cashier,
                    "method": method,
                    "amount": amount,
                    "status": PaymentStatus.COMPLETED,
                    "idempotency_key": self._key("payment"),
                    "reference": None,
                    "created_at": paid,
                    "updated_at": paid,
                }
            )
            self._record_takings(branch.id, day, method, amount)

    def _accrue(
        self,
        membership: MembershipContext,
        *,
        branch: BranchContext,
        order_id: UUID,
        when: datetime,
    ) -> None:
        entry_id = uuid4()
        self.rows.ledger_entries.append(
            {
                "id": entry_id,
                "tenant_id": self.context.tenant_id,
                "branch_id": branch.id,
                "program_id": self.context.program_id,
                "membership_id": membership.id,
                "order_id": order_id,
                "entry_type": LoyaltyLedgerEntryType.ACCRUAL,
                "progress_delta": Decimal("1.000000"),
                "source_entry_id": None,
                "actor_user_id": branch.manager_id,
                "idempotency_key": self._key("ledger"),
                "reason": "Ödenen adisyon",
                "entry_metadata": {"source": "demo"},
                "created_at": when,
                "updated_at": when,
            }
        )
        membership.accruals += 1
        while membership.accruals >= (membership.rewards_issued + 1) * D.LOYALTY_VISIT_THRESHOLD:
            membership.rewards_issued += 1
            reward_id = uuid4()
            self.rows.rewards.append(
                {
                    "id": reward_id,
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "program_id": self.context.program_id,
                    "membership_id": membership.id,
                    "source_ledger_entry_id": entry_id,
                    "reward_product_id": None,
                    "reward_category_id": self.context.reward_category_id,
                    "ordinal": membership.rewards_issued,
                    "redemption_code": self._reward_code(),
                    "status": LoyaltyRewardStatus.AVAILABLE,
                    "issued_at": when,
                    "expires_at": when + timedelta(days=180),
                    "redeemed_at": None,
                    "created_at": when,
                    "updated_at": when,
                }
            )
            membership.available_rewards.append(reward_id)

    def _redeem_reward(
        self,
        membership: MembershipContext,
        *,
        branch: BranchContext,
        order_id: UUID,
        line: Line,
        discount_id: UUID,
        amount: Decimal,
        actor_id: UUID | None,
        when: datetime,
    ) -> None:
        reward_id = membership.available_rewards.pop(0)
        for row in self.rows.rewards:
            if row["id"] == reward_id:
                row["status"] = LoyaltyRewardStatus.REDEEMED
                row["redeemed_at"] = when
                row["updated_at"] = when
                break
        # The redeemed line's order item id is assigned while writing lines, so
        # remember what to point at and patch it once the id exists.
        self.rows.redemptions.append(
            {
                "id": uuid4(),
                "tenant_id": self.context.tenant_id,
                "branch_id": branch.id,
                "membership_id": membership.id,
                "reward_id": reward_id,
                "order_id": order_id,
                "order_item_id": None,
                "discount_id": discount_id,
                "actor_user_id": actor_id,
                "idempotency_key": self._key("redemption"),
                "status": LoyaltyRedemptionStatus.APPLIED,
                "amount": amount,
                "reason": f"Sadakat ödülü · {line.product.name}",
                "reward_snapshot": {
                    "product": line.product.name,
                    "category": line.product.category_name,
                },
                "created_at": when,
                "updated_at": when,
                "_pending_product_id": line.product.id,
            }
        )

    def _add_delivery(
        self,
        branch: BranchContext,
        order_id: UUID,
        source: OrderSource,
        total: Decimal,
        created: datetime,
        ready: datetime,
        paid: datetime,
    ) -> None:
        rng = self.rng
        if source is OrderSource.TAKEAWAY:
            channel = DeliveryChannel.TAKEAWAY
            provider = None
        else:
            roll = rng.random()
            if roll < 0.7 and branch.spec.marketplaces:
                channel = DeliveryChannel.MARKETPLACE
                provider = MarketplaceProvider(rng.choice(branch.spec.marketplaces))
            elif roll < 0.9:
                channel = DeliveryChannel.OWN_DELIVERY
                provider = None
            else:
                channel = DeliveryChannel.PHONE
                provider = None

        if provider is not None:
            method = DeliveryPaymentMethod.ONLINE
            payment_status = DeliveryPaymentStatus.PROVIDER_COLLECTED
            commission = money(total * Decimal("0.14"))
        else:
            method = rng.choice(
                (
                    DeliveryPaymentMethod.CASH_ON_DELIVERY,
                    DeliveryPaymentMethod.CARD_ON_DELIVERY,
                    DeliveryPaymentMethod.MEAL_CARD,
                )
            )
            payment_status = DeliveryPaymentStatus.PAID
            commission = None

        address_line, district, neighbourhood = _delivery_address(rng)
        delivery_fee = (
            None if channel is DeliveryChannel.TAKEAWAY else money(Decimal(rng.choice((0, 49, 69))))
        )
        self.rows.delivery_orders.append(
            {
                "id": uuid4(),
                "tenant_id": self.context.tenant_id,
                "branch_id": branch.id,
                "order_id": order_id,
                "channel": channel,
                "provider": provider,
                "delivery_status": DeliveryStatus.DELIVERED,
                "external_order_id": (
                    f"{provider.value[:3]}-{rng.randrange(10**8):08d}" if provider else None
                ),
                "external_display_id": (
                    f"#{rng.randrange(10**5):05d}" if provider else None
                ),
                "external_status": "DELIVERED" if provider else None,
                "external_created_at": created if provider else None,
                "sync_status": (
                    ProviderSyncStatus.SYNCED if provider else ProviderSyncStatus.NOT_APPLICABLE
                ),
                "sync_error": None,
                "last_synced_at": paid if provider else None,
                "customer_name": rng.choice(D.GUEST_NAMES),
                "customer_phone": f"05{rng.randrange(10**9):09d}",
                "address_line": None if channel is DeliveryChannel.TAKEAWAY else address_line,
                "district": None if channel is DeliveryChannel.TAKEAWAY else district,
                "neighbourhood": (
                    None if channel is DeliveryChannel.TAKEAWAY else neighbourhood
                ),
                "address_note": None,
                "customer_note": None,
                "payment_method": method,
                "payment_status": payment_status,
                "delivery_fee": delivery_fee,
                "provider_discount": None,
                "restaurant_discount": None,
                "provider_commission": commission,
                "net_expected_amount": (
                    money(total - commission) if commission is not None else total
                ),
                "courier_user_id": None,
                "courier_name": (
                    None
                    if channel is DeliveryChannel.TAKEAWAY
                    else rng.choice(("Serkan K.", "Mert A.", "Hakan T.", "Emin B."))
                ),
                "promised_minutes": None if channel is DeliveryChannel.TAKEAWAY else 35,
                "accepted_at": created + timedelta(minutes=2),
                "ready_at": ready,
                "dispatched_at": None if channel is DeliveryChannel.TAKEAWAY else ready,
                "delivered_at": paid,
                "cancelled_at": None,
                "rejection_reason": None,
                "created_at": created,
                "updated_at": paid,
            }
        )

    def _consume_stock(
        self, branch: BranchContext, line: Line, order_item_id: UUID, when: datetime
    ) -> None:
        # Only the recent window gets a movement trail; older sales are folded
        # into the opening balance so the table stays a readable size.
        if (self.now - when).days > 14:
            return
        recipe = self.context.recipes.get(line.product.id)
        if not recipe:
            return
        for item_name, per_portion in recipe:
            inventory_item_id = branch.inventory.get(item_name)
            if inventory_item_id is None:
                continue
            delta = -(per_portion * line.quantity)
            self.stock_deltas.setdefault((branch.id, inventory_item_id), []).append(
                (when, "SALE", delta, order_item_id)
            )

    def _print_job_row(
        self,
        *,
        branch: BranchContext,
        station_code: str,
        order_id: UUID,
        ticket_id: UUID,
        items: list[Line],
        when: datetime,
        status: PrintJobStatus,
        error: str | None = None,
    ) -> Row:
        return {
            "id": uuid4(),
            "tenant_id": self.context.tenant_id,
            "branch_id": branch.id,
            "preparation_station_id": branch.stations[station_code],
            "printer_device_id": branch.printers.get(station_code),
            "claimed_by_bridge_id": None,
            "order_id": order_id,
            "kitchen_ticket_id": ticket_id,
            "payload": {
                "order_id": str(order_id),
                "ticket_id": str(ticket_id),
                "items": [
                    {
                        "name": line.product.name,
                        "quantity": str(line.quantity),
                        "note": line.note,
                    }
                    for line in items
                ],
            },
            "status": status,
            "kind": PrintJobKind.ORIGINAL,
            "idempotency_key": self._key("print"),
            "attempt_count": 1 if status is PrintJobStatus.PRINTED else 3,
            "last_error": error,
            "claimed_at": when + timedelta(seconds=2),
            "sent_at": when + timedelta(seconds=3),
            "printed_at": when + timedelta(seconds=5)
            if status is PrintJobStatus.PRINTED
            else None,
            "created_at": when,
            "updated_at": when + timedelta(seconds=5),
        }

    # -- live state --------------------------------------------------------

    ITEM_STATUS_FOR_ORDER = {
        OrderStatus.SUBMITTED: OrderItemStatus.SUBMITTED,
        OrderStatus.PREPARING: OrderItemStatus.PREPARING,
        OrderStatus.READY: OrderItemStatus.READY,
        OrderStatus.SERVED: OrderItemStatus.SERVED,
        OrderStatus.BILL_REQUESTED: OrderItemStatus.SERVED,
    }

    def _build_live_state(self, branch: BranchContext) -> None:
        """Open tables, tickets on the pass, and requests waiting for a decision."""
        self._build_live_tables(branch)
        self._build_live_delivery(branch)
        self._build_pending_qr(branch)

    def _write_live_order(
        self,
        branch: BranchContext,
        *,
        source: OrderSource,
        order_status: OrderStatus,
        ticket_status: KitchenTicketStatus,
        created: datetime,
        lines: list[Line],
        actor_id: UUID | None,
        session_id: UUID | None,
        customer_name: str | None,
    ) -> tuple[UUID, Decimal]:
        """Write one order that is still in progress, with its kitchen tickets."""
        rng = self.rng
        order_id = uuid4()
        subtotal = money(sum((line.line_total for line in lines), ZERO))
        item_status = self.ITEM_STATUS_FOR_ORDER[order_status]
        submitted = created + timedelta(minutes=1)

        self.totals.orders += 1
        self.totals.live_orders += 1
        self.rows.orders.append(
            {
                "id": order_id,
                "tenant_id": self.context.tenant_id,
                "branch_id": branch.id,
                "table_session_id": session_id,
                "created_by_user_id": actor_id,
                "loyalty_membership_id": None,
                "source": source,
                "status": order_status,
                "customer_name": customer_name,
                "currency": self.context.currency,
                "subtotal": subtotal,
                "discount_total": ZERO,
                "tax_total": ZERO,
                "total": subtotal,
                "idempotency_key": self._key("order"),
                "version": 2,
                "submitted_at": submitted,
                "accepted_at": (
                    None
                    if order_status is OrderStatus.SUBMITTED
                    else created + timedelta(minutes=2)
                ),
                "paid_at": None,
                "created_at": created,
                "updated_at": self.now,
            }
        )

        by_station: dict[str, list[tuple[UUID, Line]]] = {}
        for line in lines:
            item_id = uuid4()
            self.totals.items += 1
            self.rows.order_items.append(
                {
                    "id": item_id,
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "order_id": order_id,
                    "product_id": line.product.id,
                    "preparation_station_id": branch.stations[line.product.spec.station],
                    "product_name_snapshot": line.product.name,
                    "unit_price": line.unit_price,
                    "quantity": line.quantity,
                    "tax_rate_snapshot": Decimal(line.product.spec.tax_rate),
                    "discount_snapshot": ZERO,
                    "line_total": line.line_total,
                    "status": item_status,
                    "note": line.note,
                    "submitted_at": submitted,
                    "created_at": created,
                    "updated_at": self.now,
                }
            )
            for modifier_id, name, delta in line.modifiers:
                self.rows.order_item_modifiers.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "order_item_id": item_id,
                        "modifier_id": modifier_id,
                        "name_snapshot": name,
                        "price_delta_snapshot": delta,
                        "quantity": 1,
                        "created_at": created,
                        "updated_at": created,
                    }
                )
            by_station.setdefault(line.product.spec.station, []).append((item_id, line))

        started_states = (
            KitchenTicketStatus.PREPARING,
            KitchenTicketStatus.READY,
            KitchenTicketStatus.COMPLETED,
        )
        for station_code, station_items in by_station.items():
            ticket_id = uuid4()
            self.rows.kitchen_tickets.append(
                {
                    "id": ticket_id,
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "order_id": order_id,
                    "preparation_station_id": branch.stations[station_code],
                    "batch_number": 1,
                    "status": ticket_status,
                    "accepted_at": (
                        None
                        if ticket_status is KitchenTicketStatus.NEW
                        else created + timedelta(minutes=2)
                    ),
                    "started_at": (
                        created + timedelta(minutes=3)
                        if ticket_status in started_states
                        else None
                    ),
                    "ready_at": (
                        created + timedelta(minutes=14)
                        if ticket_status
                        in (KitchenTicketStatus.READY, KitchenTicketStatus.COMPLETED)
                        else None
                    ),
                    "completed_at": (
                        created + timedelta(minutes=18)
                        if ticket_status is KitchenTicketStatus.COMPLETED
                        else None
                    ),
                    "created_at": submitted,
                    "updated_at": self.now,
                }
            )
            for item_id, _line in station_items:
                self.rows.kitchen_ticket_items.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "branch_id": branch.id,
                        "ticket_id": ticket_id,
                        "order_item_id": item_id,
                        "status": item_status,
                        "created_at": submitted,
                        "updated_at": self.now,
                    }
                )
            if ticket_status in (KitchenTicketStatus.NEW, KitchenTicketStatus.PREPARING):
                # One branch is left with a printer that did not answer, so the
                # dashboard's failed-print warning has something real to show.
                failed = branch.slug == "besiktas" and rng.random() < 0.2
                self.rows.print_jobs.append(
                    self._print_job_row(
                        branch=branch,
                        station_code=station_code,
                        order_id=order_id,
                        ticket_id=ticket_id,
                        items=[line for _, line in station_items],
                        when=submitted,
                        status=PrintJobStatus.FAILED if failed else PrintJobStatus.PRINTED,
                        error="Yazıcı yanıt vermedi (timeout)" if failed else None,
                    )
                )
        return order_id, subtotal

    def _build_live_tables(self, branch: BranchContext) -> None:
        rng = self.rng
        occupied_count = max(2, round(len(branch.tables) * rng.uniform(0.3, 0.45)))
        tables = rng.sample(branch.tables, min(occupied_count, len(branch.tables)))

        # How long a table has plausibly been at each stage. A ticket still
        # marked NEW after an hour would be a genuine service failure, and the
        # dashboard would rightly raise a delayed-station warning for it, so the
        # age of each order follows the stage it is in.
        live_statuses = (
            (OrderStatus.SUBMITTED, TableState.ORDER_PENDING, KitchenTicketStatus.NEW, 2, 8),
            (OrderStatus.PREPARING, TableState.PREPARING, KitchenTicketStatus.ACCEPTED, 4, 10),
            (OrderStatus.PREPARING, TableState.PREPARING, KitchenTicketStatus.PREPARING, 6, 14),
            (OrderStatus.READY, TableState.READY, KitchenTicketStatus.READY, 14, 24),
            (OrderStatus.SERVED, TableState.OCCUPIED, KitchenTicketStatus.COMPLETED, 25, 70),
            (OrderStatus.SERVED, TableState.OCCUPIED, KitchenTicketStatus.COMPLETED, 25, 70),
            (
                OrderStatus.BILL_REQUESTED,
                TableState.BILL_REQUESTED,
                KitchenTicketStatus.COMPLETED,
                45,
                95,
            ),
        )

        for table_id, _table_name, _area_id in tables:
            order_status, table_state, ticket_status, youngest, oldest = rng.choice(
                live_statuses
            )
            created = self.now - timedelta(minutes=rng.randint(youngest, oldest))
            source = OrderSource.QR if rng.random() < 0.18 else OrderSource.WAITER
            lines = _compose_basket(
                rng, self.context, self.pools, hour=self.local_now.hour, source=source
            )
            actor_id = rng.choice(branch.waiters) if branch.waiters else branch.manager_id
            guest = rng.choice(D.GUEST_NAMES)

            session_id = uuid4()
            self.rows.table_sessions.append(
                {
                    "id": session_id,
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "table_id": table_id,
                    "opened_by_user_id": actor_id,
                    "status": TableSessionStatus.OPEN,
                    "customer_name": guest,
                    "opened_at": created,
                    "closed_at": None,
                    "created_at": created,
                    "updated_at": created,
                }
            )
            self.table_states[table_id] = (table_state, guest)

            order_id, _subtotal = self._write_live_order(
                branch,
                source=source,
                order_status=order_status,
                ticket_status=ticket_status,
                created=created,
                lines=lines,
                actor_id=actor_id,
                session_id=session_id,
                customer_name=guest,
            )

            if order_status is OrderStatus.BILL_REQUESTED and rng.random() < 0.4:
                self.rows.approvals.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "branch_id": branch.id,
                        "order_id": order_id,
                        "order_item_id": None,
                        "requested_by_user_id": actor_id,
                        "resolved_by_user_id": None,
                        "approval_type": ApprovalType.DISCOUNT,
                        "status": ApprovalStatus.PENDING,
                        "payload": {"percent": "10"},
                        "reason": "Müdavim müşteri indirimi",
                        "resolved_at": None,
                        "created_at": self.now - timedelta(minutes=rng.randint(1, 8)),
                        "updated_at": self.now,
                    }
                )

    def _build_live_delivery(self, branch: BranchContext) -> None:
        """Courier and takeaway tickets still moving through the delivery inbox."""
        rng = self.rng
        # (delivery status, order status, ticket status, youngest, oldest)
        stages = (
            (DeliveryStatus.NEW, OrderStatus.SUBMITTED, KitchenTicketStatus.NEW, 1, 5),
            (DeliveryStatus.ACCEPTED, OrderStatus.PREPARING, KitchenTicketStatus.ACCEPTED, 3, 8),
            (
                DeliveryStatus.PREPARING,
                OrderStatus.PREPARING,
                KitchenTicketStatus.PREPARING,
                6,
                14,
            ),
            (DeliveryStatus.READY, OrderStatus.READY, KitchenTicketStatus.READY, 14, 22),
            (
                DeliveryStatus.DISPATCHED,
                OrderStatus.SERVED,
                KitchenTicketStatus.COMPLETED,
                20,
                40,
            ),
        )
        for delivery_status, order_status, ticket_status, youngest, oldest in stages:
            for _ in range(rng.randint(1, 2)):
                created = self.now - timedelta(minutes=rng.randint(youngest, oldest))
                takeaway = rng.random() < 0.3
                source = OrderSource.TAKEAWAY if takeaway else OrderSource.DELIVERY
                if takeaway:
                    channel = DeliveryChannel.TAKEAWAY
                    provider = None
                elif branch.spec.marketplaces and rng.random() < 0.65:
                    channel = DeliveryChannel.MARKETPLACE
                    provider = MarketplaceProvider(rng.choice(branch.spec.marketplaces))
                else:
                    channel = rng.choice((DeliveryChannel.OWN_DELIVERY, DeliveryChannel.PHONE))
                    provider = None

                lines = _compose_basket(
                    rng, self.context, self.pools, hour=self.local_now.hour, source=source
                )
                actor_id = rng.choice(branch.cashiers) if branch.cashiers else branch.manager_id
                customer = rng.choice(D.GUEST_NAMES)
                order_id, subtotal = self._write_live_order(
                    branch,
                    source=source,
                    order_status=order_status,
                    ticket_status=ticket_status,
                    created=created,
                    lines=lines,
                    actor_id=actor_id,
                    session_id=None,
                    customer_name=customer,
                )

                address_line, district, neighbourhood = _delivery_address(rng)
                dispatched = delivery_status is DeliveryStatus.DISPATCHED
                ready_reached = delivery_status in (
                    DeliveryStatus.READY,
                    DeliveryStatus.DISPATCHED,
                )
                self.rows.delivery_orders.append(
                    {
                        "id": uuid4(),
                        "tenant_id": self.context.tenant_id,
                        "branch_id": branch.id,
                        "order_id": order_id,
                        "channel": channel,
                        "provider": provider,
                        "delivery_status": delivery_status,
                        "external_order_id": (
                            f"{provider.value[:3]}-{rng.randrange(10**8):08d}"
                            if provider
                            else None
                        ),
                        "external_display_id": (
                            f"#{rng.randrange(10**5):05d}" if provider else None
                        ),
                        "external_status": delivery_status.value if provider else None,
                        "external_created_at": created if provider else None,
                        "sync_status": (
                            ProviderSyncStatus.SYNCED
                            if provider
                            else ProviderSyncStatus.NOT_APPLICABLE
                        ),
                        "sync_error": None,
                        "last_synced_at": self.now if provider else None,
                        "customer_name": customer,
                        "customer_phone": f"05{rng.randrange(10**9):09d}",
                        "address_line": None if takeaway else address_line,
                        "district": None if takeaway else district,
                        "neighbourhood": None if takeaway else neighbourhood,
                        "address_note": None,
                        "customer_note": (
                            rng.choice(ITEM_NOTES) if rng.random() < 0.3 else None
                        ),
                        "payment_method": (
                            DeliveryPaymentMethod.ONLINE
                            if provider
                            else rng.choice(
                                (
                                    DeliveryPaymentMethod.CASH_ON_DELIVERY,
                                    DeliveryPaymentMethod.CARD_ON_DELIVERY,
                                )
                            )
                        ),
                        "payment_status": (
                            DeliveryPaymentStatus.PROVIDER_COLLECTED
                            if provider
                            else DeliveryPaymentStatus.UNPAID
                        ),
                        "delivery_fee": None if takeaway else money(Decimal("49")),
                        "provider_discount": None,
                        "restaurant_discount": None,
                        "provider_commission": (
                            money(subtotal * Decimal("0.14")) if provider else None
                        ),
                        "net_expected_amount": (
                            money(subtotal * Decimal("0.86")) if provider else subtotal
                        ),
                        "courier_user_id": None,
                        "courier_name": (
                            rng.choice(("Serkan K.", "Mert A.", "Hakan T.", "Emin B."))
                            if dispatched
                            else None
                        ),
                        "promised_minutes": None if takeaway else 35,
                        "accepted_at": (
                            None
                            if delivery_status is DeliveryStatus.NEW
                            else created + timedelta(minutes=2)
                        ),
                        "ready_at": (
                            created + timedelta(minutes=14) if ready_reached else None
                        ),
                        "dispatched_at": (
                            created + timedelta(minutes=17) if dispatched else None
                        ),
                        "delivered_at": None,
                        "cancelled_at": None,
                        "rejection_reason": None,
                        "created_at": created,
                        "updated_at": self.now,
                    }
                )

    def _build_pending_qr(self, branch: BranchContext) -> None:
        """A couple of QR baskets waiting for a waiter to approve them."""
        if branch.spec.qr_order_mode != "WAITER_APPROVAL":
            return
        rng = self.rng
        free_tables = [entry for entry in branch.tables if entry[0] not in self.table_states]
        for table_id, _name, _area in rng.sample(free_tables, min(3, len(free_tables))):
            lines = _compose_basket(
                rng,
                self.context,
                self.pools,
                hour=self.local_now.hour,
                source=OrderSource.QR,
            )
            requested = self.now - timedelta(minutes=rng.randint(1, 6))
            self.rows.qr_requests.append(
                {
                    "id": uuid4(),
                    "tenant_id": self.context.tenant_id,
                    "branch_id": branch.id,
                    "table_id": table_id,
                    "table_session_id": None,
                    "order_id": None,
                    "loyalty_membership_id": None,
                    "status": QrRequestStatus.PENDING,
                    "idempotency_key": self._key("qr"),
                    "session_nonce_hash": None,
                    "items_payload": [
                        {
                            "product_id": str(line.product.id),
                            "name": line.product.name,
                            "quantity": str(line.quantity),
                            "unit_price": str(line.unit_price),
                        }
                        for line in lines
                    ],
                    "customer_note": rng.choice(ITEM_NOTES) if rng.random() < 0.4 else None,
                    "request_metadata": {"channel": "qr", "locale": "tr"},
                    "expires_at": requested + timedelta(minutes=20),
                    "resolved_by_user_id": None,
                    "resolved_at": None,
                    "created_at": requested,
                    "updated_at": requested,
                }
            )

    # -- shifts and stock ---------------------------------------------------

    def _build_shifts(self) -> None:
        rng = self.rng
        for branch in self.context.branches:
            cashiers = branch.cashiers or ([branch.manager_id] if branch.manager_id else [])
            if not cashiers:
                continue
            day = self.today - timedelta(days=self.history_days)
            index = 0
            previous_id: UUID | None = None
            while day <= self.today:
                takings = self.day_takings.get(
                    (branch.id, day), {"CASH": ZERO, "CARD": ZERO, "total": ZERO}
                )
                cashier_id = cashiers[index % len(cashiers)]
                index += 1
                opened = _utc(
                    datetime.combine(day, datetime.min.time()) + timedelta(hours=9, minutes=30)
                )
                is_today = day == self.today
                opening_cash = Decimal(rng.choice((2000, 2500, 3000)))
                shift_id = uuid4()
                closing_cash = (
                    None
                    if is_today
                    else money(
                        opening_cash
                        + takings["CASH"]
                        + Decimal(rng.choice((0, 0, 0, -50, 25, -25, 40)))
                    )
                )
                self.rows.shifts.append(
                    {
                        "id": shift_id,
                        "tenant_id": self.context.tenant_id,
                        "branch_id": branch.id,
                        "user_id": cashier_id,
                        "predecessor_shift_id": previous_id,
                        "cashier_name": branch.cashier_names.get(cashier_id),
                        "status": "OPEN" if is_today else "CLOSED",
                        "opening_cash": opening_cash,
                        "opening_note": None,
                        "closing_cash": closing_cash,
                        "cash_sales": takings["CASH"],
                        "card_sales": takings["CARD"],
                        "total_sales": takings["total"],
                        "cash_variance": (
                            None
                            if closing_cash is None
                            else money(closing_cash - opening_cash - takings["CASH"])
                        ),
                        "opened_at": opened,
                        "closed_at": None if is_today else opened + timedelta(hours=15),
                        "closing_note": None,
                        "created_at": opened,
                        "updated_at": opened if is_today else opened + timedelta(hours=15),
                    }
                )
                previous_id = shift_id
                day += timedelta(days=1)

    def _build_stock_movements(self) -> None:
        """Walk each item's recent movements so `balance_after` is real arithmetic.

        The current balance is fixed by the data file (some items are meant to be
        below their minimum), so the opening figure is derived backwards from it.
        """
        rng = self.rng
        spec_by_name = {spec.name: spec for spec in D.INVENTORY}
        for branch in self.context.branches:
            for item_name, item_id in branch.inventory.items():
                spec = spec_by_name[item_name]
                final = Decimal(spec.opening_quantity)
                movements = sorted(
                    self.stock_deltas.get((branch.id, item_id), []), key=lambda row: row[0]
                )
                if not movements:
                    continue
                # Weekly deliveries, sized to roughly cover what was consumed.
                consumed = -sum(delta for _, _, delta, _ in movements)
                purchases: list[tuple[datetime, str, Decimal, UUID | None]] = []
                for week in range(2):
                    when = self.now - timedelta(days=14 - week * 7, hours=rng.randint(6, 9))
                    delivered = (consumed / Decimal(2)).quantize(Decimal("0.000001"))
                    purchases.append((when, "PURCHASE", delivered, None))
                merged = sorted([*movements, *purchases], key=lambda row: row[0])
                # Deliveries roughly match consumption, so this lands on the
                # intended current level; the floor check below only matters if
                # a run of sales happens to precede the week's delivery.
                opening = final - sum(delta for _, _, delta, _ in merged)
                running = opening
                lowest = opening
                for _when, _type, delta, _item in merged:
                    running += delta
                    lowest = min(lowest, running)
                if lowest < ZERO:
                    opening -= lowest

                balance = opening
                for when, movement_type, delta, order_item_id in merged:
                    balance += delta
                    self.rows.stock_movements.append(
                        {
                            "id": uuid4(),
                            "tenant_id": self.context.tenant_id,
                            "branch_id": branch.id,
                            "inventory_item_id": item_id,
                            "location_id": branch.location_id,
                            "order_item_id": order_item_id,
                            "actor_user_id": (
                                branch.manager_id if movement_type == "PURCHASE" else None
                            ),
                            "movement_type": movement_type,
                            "quantity_delta": delta,
                            "balance_after": balance,
                            "unit_cost": Decimal(spec.unit_cost),
                            "reason": (
                                "Tedarikçi teslimatı"
                                if movement_type == "PURCHASE"
                                else "Satış tüketimi"
                            ),
                            "idempotency_key": self._key("stock"),
                            "created_at": when,
                            "updated_at": when,
                        }
                    )


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------


async def _bulk(
    db: AsyncSession, model: type[Any], rows: list[Row], chunk: int = 1000
) -> None:
    for start in range(0, len(rows), chunk):
        await db.execute(insert(model), rows[start : start + chunk])


async def generate_history(
    db: AsyncSession,
    context: DemoContext,
    *,
    rng: Random,
    history_days: int,
) -> Totals:
    builder = HistoryBuilder(
        context, rng=rng, history_days=history_days, now=datetime.now(UTC)
    )
    builder.run()
    rows = builder.rows

    # Redemptions point at the order item that was given away; resolve it now
    # that every line has an id.
    items_by_order: dict[tuple[UUID, UUID], UUID] = {}
    for item in rows.order_items:
        items_by_order.setdefault((item["order_id"], item["product_id"]), item["id"])
    resolved_redemptions: list[Row] = []
    for redemption in rows.redemptions:
        product_id = redemption.pop("_pending_product_id")
        order_item_id = items_by_order.get((redemption["order_id"], product_id))
        if order_item_id is None:
            continue
        redemption["order_item_id"] = order_item_id
        resolved_redemptions.append(redemption)

    await _bulk(db, TableSession, rows.table_sessions)
    await _bulk(db, Order, rows.orders)
    await _bulk(db, OrderItem, rows.order_items)
    await _bulk(db, OrderItemModifier, rows.order_item_modifiers)
    await _bulk(db, KitchenTicket, rows.kitchen_tickets)
    await _bulk(db, KitchenTicketItem, rows.kitchen_ticket_items)
    await _bulk(db, Payment, rows.payments)
    await _bulk(db, Discount, rows.discounts)
    await _bulk(db, Cancellation, rows.cancellations)
    await _bulk(db, ApprovalRequest, rows.approvals)
    await _bulk(db, LoyaltyLedgerEntry, rows.ledger_entries)
    await _bulk(db, LoyaltyReward, rows.rewards)
    await _bulk(db, LoyaltyRedemption, resolved_redemptions)
    await _bulk(db, DeliveryOrder, rows.delivery_orders)
    await _bulk(db, CashierShift, rows.shifts)
    await _bulk(db, StockMovement, rows.stock_movements)
    await _bulk(db, PrintJob, rows.print_jobs)
    await _bulk(db, QrOrderRequest, rows.qr_requests)

    # The floor is only correct once the live sessions exist.
    for table_id, (state, guest) in builder.table_states.items():
        table = await db.get(DiningTable, table_id)
        if table is not None:
            table.state = state
            table.guest_label = guest
            table.version += 1

    # Recent sales moved stock; make the balances agree with the movement trail.
    final_balances: dict[tuple[UUID, UUID], Decimal] = {}
    for movement in rows.stock_movements:
        final_balances[(movement["branch_id"], movement["inventory_item_id"])] = movement[
            "balance_after"
        ]
    for (branch_id, item_id), quantity in final_balances.items():
        await db.execute(
            update(StockBalance)
            .where(
                StockBalance.tenant_id == context.tenant_id,
                StockBalance.branch_id == branch_id,
                StockBalance.inventory_item_id == item_id,
            )
            .values(quantity=quantity)
        )

    await db.flush()
    return builder.totals
