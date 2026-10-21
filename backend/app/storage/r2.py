"""Cloudflare R2 storage client (S3-compatible API)."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def enabled() -> bool:
    """True when all required Cloudflare R2 credentials and bucket are set."""
    return bool(
        os.environ.get("R2_ACCOUNT_ID")
        and os.environ.get("R2_ACCESS_KEY_ID")
        and os.environ.get("R2_SECRET_ACCESS_KEY")
        and os.environ.get("R2_BUCKET")
    )


def get_client() -> Any:
    """Return a boto3 S3 client configured for Cloudflare R2."""
    account_id = os.environ.get("R2_ACCOUNT_ID", "")
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def put_file(local_path: str | Path, key: str, content_type: str = "application/pdf") -> str:
    """Upload a local file to R2 under key. Returns key."""
    bucket = os.environ["R2_BUCKET"]
    extra_args = {"ContentType": content_type} if content_type else {}
    get_client().upload_file(str(local_path), bucket, key, ExtraArgs=extra_args)
    return key


def put_bytes(data: bytes, key: str, content_type: str = "application/pdf") -> str:
    """Upload raw bytes to R2 under key. Returns key."""
    bucket = os.environ["R2_BUCKET"]
    get_client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)
    return key


def url_for(key: str, expires_in: int = 3600) -> str:
    """Return a public URL if R2_PUBLIC_BASE_URL is set, else a 1-hour presigned URL."""
    public_base = os.environ.get("R2_PUBLIC_BASE_URL", "").rstrip("/")
    clean_key = key.lstrip("/")
    if public_base:
        return f"{public_base}/{clean_key}"
    bucket = os.environ["R2_BUCKET"]
    return str(
        get_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )
    )


def exists(key: str) -> bool:
    """Check if object exists in R2 bucket."""
    if not enabled():
        return False
    bucket = os.environ.get("R2_BUCKET", "")
    try:
        get_client().head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        error_code = str(e.response.get("Error", {}).get("Code", ""))
        http_code = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if error_code in ("404", "NoSuchKey") or http_code == 404:
            return False
        raise

def get_file(key: str, local_path: str | Path) -> Path:
    """Download object from R2 to local_path. Returns Path(local_path)."""
    bucket = os.environ["R2_BUCKET"]
    path = Path(local_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    get_client().download_file(bucket, key, str(path))
    return path


def list_keys(prefix: str = "") -> list[str]:
    """List all object keys under prefix in R2 bucket."""
    if not enabled():
        return []
    bucket = os.environ.get("R2_BUCKET", "")
    client = get_client()
    keys: list[str] = []
    paginator = client.get_paginator("list_objects_v2")
    kwargs = {"Bucket": bucket}
    if prefix:
        kwargs["Prefix"] = prefix
    for page in paginator.paginate(**kwargs):
        for item in page.get("Contents", []):
            keys.append(item["Key"])
    return keys


def delete(key: str) -> bool:
    """Delete an object from R2 bucket."""
    if not enabled():
        return False
    bucket = os.environ.get("R2_BUCKET", "")
    get_client().delete_object(Bucket=bucket, Key=key)
    return True
