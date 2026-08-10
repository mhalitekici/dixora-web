from __future__ import annotations

import base64
import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Literal, Protocol

import anyio
import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class EmailAttachment:
    filename: str
    content: bytes
    content_type: str = "application/octet-stream"
    # Set to reference the file from the HTML as <img src="cid:...">; without it
    # the file arrives as a normal download instead.
    content_id: str | None = None


@dataclass(frozen=True, slots=True)
class OutgoingEmail:
    to: str
    subject: str
    text_body: str
    html_body: str | None = None
    attachments: tuple[EmailAttachment, ...] = ()


EmailMode = Literal["DEVELOPMENT", "SMTP", "RESEND", "DISABLED"]


class EmailSender(Protocol):
    @property
    def mode(self) -> EmailMode: ...

    async def send(self, message: OutgoingEmail) -> None: ...


class DevelopmentEmailSender:
    """Logs the message instead of sending it.

    Lets the whole enrolment flow be exercised locally without a mail server.
    Production configuration rejects this sender, so a live deployment can never
    silently swallow a verification code a customer is waiting for.
    """

    @property
    def mode(self) -> EmailMode:
        return "DEVELOPMENT"

    async def send(self, message: OutgoingEmail) -> None:
        logger.info(
            "email.development_send to=%s subject=%s body=%s",
            message.to,
            message.subject,
            message.text_body,
        )


class DisabledEmailSender:
    """Explicitly turned off; callers must treat this as a hard failure."""

    @property
    def mode(self) -> EmailMode:
        return "DISABLED"

    async def send(self, message: OutgoingEmail) -> None:
        raise RuntimeError("Email delivery is disabled")


class ResendEmailSender:
    """Delivery through Resend's HTTP API.

    Preferred over raw SMTP for hosted deployments: no long-lived connections,
    and failures come back as a status code we can log rather than a socket
    timeout. A non-2xx response raises so callers can decide what to do — an
    enrolment must not silently claim an email went out.
    """

    ENDPOINT = "https://api.resend.com/emails"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        key = settings.resend_api_key
        self._api_key = key.get_secret_value() if key is not None else ""

    @property
    def mode(self) -> EmailMode:
        return "RESEND"

    async def send(self, message: OutgoingEmail) -> None:
        payload: dict[str, object] = {
            "from": self._settings.email_from,
            "to": [message.to],
            "subject": message.subject,
            "text": message.text_body,
        }
        if message.html_body:
            payload["html"] = message.html_body
        if message.attachments:
            payload["attachments"] = [
                {
                    "filename": item.filename,
                    "content": base64.b64encode(item.content).decode("ascii"),
                    "content_type": item.content_type,
                    **({"content_id": item.content_id} if item.content_id else {}),
                }
                for item in message.attachments
            ]

        async with httpx.AsyncClient(
            timeout=self._settings.email_timeout_seconds
        ) as client:
            response = await client.post(
                self.ENDPOINT,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.status_code >= 400:
            # The body carries Resend's reason (unverified domain, bad key, ...),
            # which is exactly what an operator needs to fix it.
            logger.warning(
                "email.resend_failed status=%s body=%s",
                response.status_code,
                response.text[:300],
            )
            response.raise_for_status()


class SmtpEmailSender:
    """Real delivery over SMTP.

    smtplib is blocking, so the send runs on a worker thread — a slow mail
    server must never stall the event loop serving the till.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def mode(self) -> EmailMode:
        return "SMTP"

    async def send(self, message: OutgoingEmail) -> None:
        await anyio.to_thread.run_sync(self._send_blocking, message)

    def _send_blocking(self, message: OutgoingEmail) -> None:
        settings = self._settings
        email = EmailMessage()
        email["Subject"] = message.subject
        email["From"] = settings.email_from
        email["To"] = message.to
        email.set_content(message.text_body)
        if message.html_body:
            email.add_alternative(message.html_body, subtype="html")
        for item in message.attachments:
            maintype, _, subtype = item.content_type.partition("/")
            maintype = maintype or "application"
            subtype = subtype or "octet-stream"
            html_part = (
                email.get_body(preferencelist=("html",))
                if item.content_id and message.html_body
                else None
            )
            if html_part is not None:
                # Related to the HTML part so <img src="cid:..."> resolves inline.
                html_part.add_related(
                    item.content,
                    maintype=maintype,
                    subtype=subtype,
                    cid=f"<{item.content_id}>",
                    filename=item.filename,
                )
            else:
                email.add_attachment(
                    item.content,
                    maintype=maintype,
                    subtype=subtype,
                    filename=item.filename,
                )

        password = (
            settings.smtp_password.get_secret_value()
            if settings.smtp_password is not None
            else ""
        )
        timeout = settings.smtp_timeout_seconds
        if settings.smtp_use_ssl:
            server: smtplib.SMTP | smtplib.SMTP_SSL = smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port, timeout=timeout
            )
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=timeout)
        try:
            if settings.smtp_use_starttls and not settings.smtp_use_ssl:
                server.starttls()
            if settings.smtp_username and password:
                server.login(settings.smtp_username, password)
            server.send_message(email)
        finally:
            server.quit()


def get_email_sender(settings: Settings) -> EmailSender:
    if settings.email_provider == "resend":
        return ResendEmailSender(settings)
    if settings.email_provider == "smtp":
        return SmtpEmailSender(settings)
    if settings.email_provider == "disabled":
        return DisabledEmailSender()
    return DevelopmentEmailSender()
