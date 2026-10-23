from __future__ import annotations
"""Transactional email via Resend (https://resend.com/docs/api-reference/emails/send-email).

Config (env): RESEND_API_KEY, EMAIL_FROM (an address on a domain verified in Resend,
e.g. ``Fund Horizon <updates@yourdomain>``), optional EMAIL_REPLY_TO.
"""

import os
from html import escape

import httpx

RESEND_URL = "https://api.resend.com/emails"


class MailerError(Exception):
    """Email could not be sent. ``configured`` is False when env config is missing."""

    def __init__(self, message: str, configured: bool = True):
        super().__init__(message)
        self.configured = configured


def send_email(to: str, subject: str, text: str) -> str:
    """Send a plain-text message (also rendered as simple HTML). Returns Resend's email id."""
    key, sender = os.environ.get("RESEND_API_KEY"), os.environ.get("EMAIL_FROM")
    if not key or not sender:
        raise MailerError("Email is not configured (set RESEND_API_KEY and EMAIL_FROM).", configured=False)
    payload = {"from": sender, "to": [to], "subject": subject, "text": text,
               "html": f"<div style=\"white-space:pre-wrap\">{escape(text)}</div>"}
    if os.environ.get("EMAIL_REPLY_TO"):
        payload["reply_to"] = os.environ["EMAIL_REPLY_TO"]
    try:
        r = httpx.post(RESEND_URL, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=10)
    except httpx.HTTPError as e:
        raise MailerError(f"Could not reach Resend: {e.__class__.__name__}") from e
    if r.status_code >= 400:
        try:
            detail = r.json().get("message", "")
        except ValueError:
            detail = ""
        raise MailerError(f"Resend rejected the email ({r.status_code}). {detail}".strip())
    return r.json().get("id", "")
