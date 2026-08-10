from __future__ import annotations

from html import escape

# Email clients strip <style> blocks and ignore most modern CSS, so everything
# here is inline and table-based. Kept deliberately narrow (560px) because that
# is what survives Gmail's mobile rendering without horizontal scroll.
BRAND = "#c2410c"
INK = "#121010"
MUTED = "#78716c"
PAPER = "#fffbf7"
BORDER = "#e7e2dd"


def _shell(*, title: str, body: str, footer: str | None = None) -> str:
    footer_html = (
        f'<p style="margin:24px 0 0;font-size:12px;line-height:18px;color:{MUTED}">'
        f"{footer}</p>"
        if footer
        else ""
    )
    return f"""\
<!doctype html>
<html lang="tr">
<body style="margin:0;padding:24px 12px;background:#f5f2ef;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
             style="width:560px;max-width:100%;background:{PAPER};border:1px solid {BORDER};
                    border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:22px 32px;background:{INK};">
            <span style="color:#ffffff;font-size:19px;font-weight:700;
                         letter-spacing:-0.02em;">dixora</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 18px;font-size:22px;line-height:30px;
                       font-weight:700;color:{INK};letter-spacing:-0.02em;">{title}</h1>
            {body}
            {footer_html}
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:{MUTED};">
        Bu e-posta Dixora tarafından gönderildi.
      </p>
    </td></tr>
  </table>
</body>
</html>"""


def _paragraph(text: str) -> str:
    return (
        f'<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:{INK};">'
        f"{text}</p>"
    )


def _code_block(code: str, caption: str) -> str:
    """The number the reader is here for — large, spaced, impossible to misread."""
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:22px 0;">
  <tr><td align="center"
          style="padding:22px;background:#ffffff;border:2px dashed {BRAND};
                 border-radius:14px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.16em;
                text-transform:uppercase;color:{MUTED};">{caption}</div>
    <div style="margin-top:10px;font-size:38px;font-weight:800;letter-spacing:0.22em;
                color:{BRAND};font-family:'SF Mono',Menlo,Consolas,monospace;">{code}</div>
  </td></tr>
</table>"""


def verification_code_email(
    *, greeting_name: str, business_name: str, code: str, ttl_minutes: int
) -> str:
    """Loyalty sign-up: the customer reads this code back to the cashier."""
    name = escape(greeting_name)
    business = escape(business_name)
    body = (
        _paragraph(f"Merhaba <strong>{name}</strong>,")
        + _paragraph(
            f"<strong>{business}</strong> sadakat programına kaydınızı tamamlamak "
            "için aşağıdaki kodu kasiyere okuyun."
        )
        + _code_block(escape(code), "Doğrulama kodu")
        + _paragraph(
            f'<span style="color:{MUTED};font-size:14px;">'
            f"Kod {ttl_minutes} dakika geçerlidir.</span>"
        )
    )
    return _shell(
        title="Üyelik doğrulama kodunuz",
        body=body,
        footer="Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
    )


def membership_card_email(
    *,
    greeting_name: str,
    business_name: str,
    program_name: str,
    member_code: str,
    progress_target: int,
    card_cid: str | None,
) -> str:
    """Welcome mail carrying the card; the PNG is embedded when it rendered."""
    name = escape(greeting_name)
    business = escape(business_name)
    program = escape(program_name)

    card_html = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"'
        f' border="0" style="margin:22px 0;"><tr><td align="center">'
        f'<img src="cid:{card_cid}" width="440" alt="{business} üyelik kartı"'
        f' style="width:440px;max-width:100%;border-radius:14px;display:block;" />'
        f"</td></tr></table>"
        if card_cid
        # Falling back to the code block means a rendering failure still leaves
        # the customer with everything they need.
        else _code_block(escape(member_code), "Üyelik kodunuz")
    )

    target = (
        _paragraph(
            f"Her uygun ziyarette ilerlemeniz artar; <strong>{progress_target} "
            "ziyarette</strong> ödülünüzü kazanırsınız."
        )
        if progress_target > 0
        else ""
    )

    body = (
        _paragraph(f"Merhaba <strong>{name}</strong>,")
        + _paragraph(
            f"<strong>{business} · {program}</strong> programına hoş geldiniz. "
            "Kartınız hazır."
        )
        + card_html
        + _paragraph(
            "Bir sonraki ziyaretinizde bu kartı (veya kodu) kasiyere gösterin."
        )
        + target
    )
    return _shell(
        title="Üyelik kartınız hazır",
        body=body,
        footer="Kartı telefonunuza kaydedebilir veya bu e-postayı saklayabilirsiniz.",
    )


def registration_code_email(
    *, owner_name: str, business_name: str, code: str, ttl_minutes: int
) -> str:
    """Business signup: proves the owner controls the address before provisioning."""
    name = escape(owner_name)
    business = escape(business_name)
    body = (
        _paragraph(f"Merhaba <strong>{name}</strong>,")
        + _paragraph(
            f"<strong>{business}</strong> işletmenizi Dixora'da oluşturmak için "
            "e-posta adresinizi doğrulayın."
        )
        + _code_block(escape(code), "Doğrulama kodu")
        + _paragraph(
            f'<span style="color:{MUTED};font-size:14px;">'
            f"Kod {ttl_minutes} dakika geçerlidir. İşletmeniz, kod doğrulandıktan "
            "sonra oluşturulur.</span>"
        )
    )
    return _shell(
        title="E-posta adresinizi doğrulayın",
        body=body,
        footer="Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
    )
