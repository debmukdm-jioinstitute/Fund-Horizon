from __future__ import annotations
"""Staff-only media download, backed by a self-hosted cobalt instance (AGPL-3.0, github.com/imputnet/cobalt).

The browser never talks to cobalt: it asks this API, which checks staff auth and forwards to the one configured
instance (``FH_COBALT_URL``). Tunnel files are streamed back through ``/file`` so cobalt stays on the private network.
"""

import json
import os
import urllib.error
import urllib.request
from typing import Annotated, Literal
from urllib.parse import parse_qsl, urlencode, urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from app.api.customer_portal import staff_only

router = APIRouter(prefix="/api/staff/download", tags=["download"])

_TUNNEL_KEYS = {"id", "exp", "sig", "sec", "iv"}  # the only query params a cobalt tunnel link carries


def _base() -> str:
    url = os.environ.get("FH_COBALT_URL", "").rstrip("/")
    if not url:
        raise HTTPException(503, "Download service is not configured.")
    return url


class DownloadIn(BaseModel):
    url: str
    mode: Literal["auto", "audio", "mute"] = "auto"
    quality: Literal["max", "2160", "1440", "1080", "720", "480", "360"] = "1080"

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = (v or "").strip()
        p = urlparse(v)
        if p.scheme not in ("http", "https") or not p.netloc or len(v) > 2048:
            raise ValueError("enter a full http(s) link")
        return v


@router.post("")
def start_download(body: DownloadIn, _: Annotated[dict, Depends(staff_only)]):
    req = urllib.request.Request(
        _base() + "/",
        data=json.dumps({"url": body.url, "downloadMode": body.mode, "videoQuality": body.quality}).encode(),
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 - fixed, operator-configured host
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read())
        except ValueError:
            raise HTTPException(502, "Download service error.") from e
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise HTTPException(502, "Download service is unavailable.") from e

    status = data.get("status")
    if status == "error":
        code = (data.get("error") or {}).get("code", "error")
        raise HTTPException(422, f"Could not fetch this link ({code}).")
    if status == "tunnel":
        q = {k: v for k, v in parse_qsl(urlparse(data["url"]).query) if k in _TUNNEL_KEYS}
        return {"status": "tunnel", "filename": data.get("filename", "download"), "file": "/api/staff/download/file?" + urlencode(q)}
    if status == "redirect":
        return {"status": "redirect", "filename": data.get("filename", "download"), "file": data["url"]}
    if status == "picker":
        return {"status": "picker", "items": [{"type": i.get("type"), "url": i.get("url")} for i in data.get("picker", [])]}
    raise HTTPException(422, "This link needs a feature that is not supported here.")


@router.get("/file")
def fetch_file(id: str, exp: str, sig: str, sec: str, iv: str, _: Annotated[dict, Depends(staff_only)]):
    q = urlencode({"id": id, "exp": exp, "sig": sig, "sec": sec, "iv": iv})
    try:
        r = urllib.request.urlopen(_base() + "/tunnel?" + q, timeout=60)  # noqa: S310
    except urllib.error.HTTPError as e:
        raise HTTPException(404 if e.code == 404 else 502, "File is no longer available.") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise HTTPException(502, "Download service is unavailable.") from e

    def stream():
        try:
            while chunk := r.read(64 * 1024):
                yield chunk
        finally:
            r.close()

    headers = {k: v for k, v in r.headers.items() if k.lower() in ("content-type", "content-disposition", "content-length")}
    return StreamingResponse(stream(), headers=headers)
