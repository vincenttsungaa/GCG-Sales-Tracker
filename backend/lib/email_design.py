"""The look of every email CardStakk sends: a white card on light grey, the CardStakk name plate with
the dark red / blue stripe, a small dark plate over the heading, one dark red button, and a footer
saying why the email came. Mail apps need tables and inline styles, so that's what this writes.
Each email keeps its plain-text version too (for mail apps that don't show designs).

    html = render(eyebrow="Password reset", title="Set a new password", body=[p("...")],
                  button=("Choose a new password", link), fine="...", why="...")
    add_html(msg, html)   # after msg.set_content(plain_text), before any attachment
"""

from __future__ import annotations

from email.message import EmailMessage
from html import escape
from pathlib import Path

LOGO = (Path(__file__).parent / "email-logo.png").read_bytes()  # the two-card mark, shown inside the email
LOGO_CID = "cardstakk-logo"

FONT = "'Instrument Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
INK, BODY, MUTED, LINE, RED, BLUE = "#1c222b", "#3d4550", "#6b7480", "#e6eaf0", "#8a1c1a", "#4a6a94"


def p(text: str) -> str:
    """A paragraph of plain text (escaped; line breaks kept)."""
    return f'<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:{BODY}">{escape(text).replace(chr(10), "<br>")}</p>'


def quote(text: str) -> str:
    """Someone's own note, set off with a blue bar."""
    return (
        f'<div style="margin:0 0 18px;padding:12px 16px;border-left:3px solid {BLUE};background:#f4f6f9;'
        f'font-size:14.5px;line-height:1.5;color:{BODY}">{escape(text).replace(chr(10), "<br>")}</div>'
    )


def rows(pairs: list[tuple[str, str]]) -> str:
    """A small two-column box: label on the left, value on the right."""
    cells = "".join(
        f'<tr><td style="padding:10px 14px;font-size:14px;color:{BODY};{"" if i == 0 else f"border-top:1px solid {LINE};"}">{escape(k)}</td>'
        f'<td align="right" style="padding:10px 14px;font-size:14px;font-weight:700;color:{INK};{"" if i == 0 else f"border-top:1px solid {LINE};"}">{escape(v)}</td></tr>'
        for i, (k, v) in enumerate(pairs)
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid #dbe1e8;border-radius:10px;border-collapse:separate">{cells}</table>'


def file_box(filename: str, note: str) -> str:
    """An attached file, shown as a tile."""
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px dashed #c9d0d9;'
        'border-radius:10px;background:#f7f8fa"><tr>'
        '<td width="52" style="padding:12px 0 12px 14px"><div style="width:38px;height:38px;line-height:38px;border-radius:8px;'
        'background:#1f7a4d;color:#ffffff;font-size:11px;font-weight:700;text-align:center">XLSX</div></td>'
        f'<td style="padding:12px 14px 12px 4px"><div style="font-size:14px;font-weight:700;color:{INK};word-break:break-all">{escape(filename)}</div>'
        f'<div style="font-size:12.5px;color:{MUTED}">{escape(note)}</div></td></tr></table>'
    )


def render(*, eyebrow: str, title: str, body: list[str], button: tuple[str, str] | None = None, fine: str | None = None, why: str) -> str:
    """The whole email. `body` is HTML from p() / quote() / rows() / file_box(); everything else is plain text."""
    btn = ""
    if button:
        text, url = button
        btn = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border-radius:8px;background:{RED}">'
            f'<a href="{escape(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">{escape(text)}</a>'
            "</td></tr></table>"
        )
    small = ""
    if fine:
        small = f'<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:{MUTED}">{escape(fine)}</p>'
    if button and fine is not None:  # the link written out, for when the button doesn't work
        small += (
            f'<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:{MUTED}">Button not working? Paste this into your browser:<br>'
            f'<a href="{escape(button[1])}" style="color:#3f5f8a;word-break:break-all">{escape(button[1])}</a></p>'
        )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>{escape(title)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:{FONT}">
<div style="display:none;max-height:0;overflow:hidden">{escape(title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe1e8;border-radius:12px;border-collapse:separate;overflow:hidden">
  <tr><td style="padding:18px 28px 16px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:10px"><img src="cid:{LOGO_CID}" width="30" height="30" alt="" style="display:block;border:0"></td>
      <td><div style="font-size:17px;font-weight:800;font-style:italic;letter-spacing:.14em;color:{INK};line-height:1">CARDSTAKK</div>
          <div style="margin-top:3px;font-size:8.5px;font-weight:600;letter-spacing:.16em;color:{BLUE};line-height:1">GCG SALES TRACKER</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="font-size:0;line-height:0;height:3px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="80" height="3" style="background:{RED}"></td><td width="40" height="3" style="background:{BLUE}"></td><td height="3" style="background:{LINE}"></td>
  </tr></table></td></tr>
  <tr><td style="padding:26px 28px 8px">
    <span style="display:inline-block;padding:4px 11px;background:#1f2630;color:#f3d38a;font-family:Consolas,Menlo,monospace;font-size:10.5px;font-style:italic;letter-spacing:.14em;text-transform:uppercase">{escape(eyebrow)}</span>
    <h1 style="margin:14px 0 10px;font-size:24px;line-height:1.2;color:{INK}">{escape(title)}</h1>
    {"".join(body)}{btn}{small}
  </td></tr>
  <tr><td style="padding:18px 28px 22px;background:#f7f8fa;border-top:1px solid {LINE};font-size:12px;line-height:1.5;color:{MUTED}">
    {escape(why)}<br><br>CardStakk &middot; an unofficial, fan-made tool for Gundam Card Game collectors &middot; Australia
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def add_html(msg: EmailMessage, html: str) -> None:
    """Add the designed version (with the logo inside it) to a message that already has its plain text."""
    msg.add_alternative(html, subtype="html")
    # inline, not attachment: with only a filename, Python marks the logo as an attachment, and Gmail then lists
    # it under the email and shows an empty box where it goes
    msg.get_payload()[-1].add_related(LOGO, maintype="image", subtype="png", cid=f"<{LOGO_CID}>", disposition="inline", filename="cardstakk.png")


if __name__ == "__main__":  # self-check: python -m lib.email_design
    m = EmailMessage()
    m.set_content("plain")
    add_html(m, render(eyebrow="Test", title="Hi <you>", body=[p("a & b")], button=("Go", "https://x.test/?a=1&b=2"), fine="", why="test"))
    out = m.as_string()
    assert "multipart/alternative" in out and "multipart/related" in out and "Hi &lt;you&gt;" in out and "cid:cardstakk-logo" in out
    assert "Content-Disposition: inline" in out and "Content-Disposition: attachment" not in out
    m.add_attachment(b"x", maintype="application", subtype="octet-stream", filename="f.bin")
    assert "multipart/mixed" in m.as_string()
    print("ok")
