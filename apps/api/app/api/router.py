from fastapi import APIRouter

from app.api import (
    audit,
    auth,
    businesses,
    catalog,
    dashboard,
    billing,
    campaigns,
    delivery,
    hotel_rooms,
    inventory,
    kitchen,
    loyalty,
    media,
    orders,
    organization,
    printing,
    qr,
    registrations,
    reports,
    shifts,
    subscriptions,
    tables,
    websocket,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(registrations.router)
api_router.include_router(businesses.router)
api_router.include_router(organization.router)
api_router.include_router(subscriptions.router)
api_router.include_router(shifts.router)
api_router.include_router(dashboard.router)
api_router.include_router(catalog.router)
api_router.include_router(media.router)
api_router.include_router(tables.router)
api_router.include_router(billing.router)
api_router.include_router(campaigns.router)
api_router.include_router(delivery.router)
api_router.include_router(hotel_rooms.router)
api_router.include_router(inventory.router)
api_router.include_router(orders.router)
api_router.include_router(qr.router)
api_router.include_router(kitchen.router)
api_router.include_router(loyalty.router)
api_router.include_router(reports.router)
api_router.include_router(printing.router)
api_router.include_router(audit.router)
api_router.include_router(websocket.router)
