"""Tests for Cloudflare R2 storage module with mocked boto3 client and fallback."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from app.storage import r2


def test_r2_disabled_by_default(monkeypatch):
    monkeypatch.delenv("R2_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("R2_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("R2_SECRET_ACCESS_KEY", raising=False)
    monkeypatch.delenv("R2_BUCKET", raising=False)

    assert r2.enabled() is False
    assert r2.exists("factsheets/sample.pdf") is False


def test_r2_enabled_and_operations(monkeypatch, tmp_path):
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sec123")
    monkeypatch.setenv("R2_BUCKET", "fund-horizon-files")
    monkeypatch.delenv("R2_PUBLIC_BASE_URL", raising=False)

    assert r2.enabled() is True

    mock_client = MagicMock()
    mock_client.generate_presigned_url.return_value = "https://signed.r2.cloudflarestorage.com/test.pdf?sig=123"

    with patch("app.storage.r2.boto3.client", return_value=mock_client):
        # 1. put_bytes
        key = r2.put_bytes(b"%PDF-test", "factsheets/test.pdf", content_type="application/pdf")
        assert key == "factsheets/test.pdf"
        mock_client.put_object.assert_called_once_with(
            Bucket="fund-horizon-files",
            Key="factsheets/test.pdf",
            Body=b"%PDF-test",
            ContentType="application/pdf",
        )

        # 2. put_file
        local_file = tmp_path / "local.pdf"
        local_file.write_bytes(b"%PDF-local")
        fkey = r2.put_file(local_file, "factsheets/local.pdf")
        assert fkey == "factsheets/local.pdf"
        mock_client.upload_file.assert_called_once_with(
            str(local_file),
            "fund-horizon-files",
            "factsheets/local.pdf",
            ExtraArgs={"ContentType": "application/pdf"},
        )

        # 3. url_for without public base URL (presigned)
        presigned = r2.url_for("factsheets/test.pdf")
        assert "sig=123" in presigned
        mock_client.generate_presigned_url.assert_called_once_with(
            "get_object",
            Params={"Bucket": "fund-horizon-files", "Key": "factsheets/test.pdf"},
            ExpiresIn=3600,
        )

        # 4. url_for with public base URL
        monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://files.fundhorizon.com")
        pub_url = r2.url_for("factsheets/test.pdf")
        assert pub_url == "https://files.fundhorizon.com/factsheets/test.pdf"

        # 5. exists -> True when head_object succeeds
        mock_client.head_object.return_value = {"ContentLength": 100}
        assert r2.exists("factsheets/test.pdf") is True

        # 6. exists -> False when head_object raises 404
        mock_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}},
            "HeadObject",
        )
        assert r2.exists("factsheets/missing.pdf") is False


def test_factsheet_file_redirect_when_r2_enabled(monkeypatch, client):
    from app.backoffice.repository import BackofficeRepository
    from tests.test_backoffice_api import _create_staff, _login_staff

    monkeypatch.setenv("R2_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sec123")
    monkeypatch.setenv("R2_BUCKET", "fund-horizon-files")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://files.fundhorizon.com")

    repo = BackofficeRepository()
    conn = repo._conn()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO factsheets (id, source_key, period, title, url, archived_path, first_seen_at, verified_at) "
            "VALUES (54321, 'test', '2026-09', 'Test Factsheet', 'https://example.test', 'factsheets/test-2026-09.pdf', '2026-10-01', '2026-10-01')"
        )

    _login_staff(client, _create_staff("analyst"))
    res = client.get("/api/backoffice/factsheets/54321/file", follow_redirects=False)
    assert res.status_code == 307
    assert res.headers["location"] == "https://files.fundhorizon.com/factsheets/test-2026-09.pdf"


def test_migrate_factsheets_to_r2(monkeypatch, tmp_path):
    from app.backoffice.repository import BackofficeRepository
    from scripts import migrate_factsheets_to_r2

    monkeypatch.setenv("R2_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sec123")
    monkeypatch.setenv("R2_BUCKET", "fund-horizon-files")

    archive_dir = tmp_path / "factsheets"
    archive_dir.mkdir()
    sample_file = archive_dir / "dsp-2026-09-abcdef1234.pdf"
    sample_file.write_bytes(b"%PDF-sample")

    monkeypatch.setattr("scripts.migrate_factsheets_to_r2.factsheet_archive_dir", lambda: archive_dir)

    repo = BackofficeRepository()
    conn = repo._conn()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO factsheets (id, source_key, period, title, url, archived_path, first_seen_at, verified_at) "
            "VALUES (98765, 'dsp', '2026-09', 'DSP Factsheet', 'https://example.test', ?, '2026-10-01', '2026-10-01')",
            (str(sample_file),)
        )

    uploaded_keys = set()

    def mock_put_file(local_path, key, content_type="application/pdf"):
        uploaded_keys.add(key)
        return key

    def mock_exists(key):
        return key in uploaded_keys

    monkeypatch.setattr("app.storage.r2.put_file", mock_put_file)
    monkeypatch.setattr("app.storage.r2.exists", mock_exists)

    # First run: should upload, update DB, and delete local file
    migrate_factsheets_to_r2.migrate()

    assert not sample_file.exists()
    assert "factsheets/dsp-2026-09-abcdef1234.pdf" in uploaded_keys

    row = repo.get_factsheet(98765)
    assert row["archived_path"] == "factsheets/dsp-2026-09-abcdef1234.pdf"

    # Second run: idempotent, should not fail
    migrate_factsheets_to_r2.migrate()
    row = repo.get_factsheet(98765)
    assert row["archived_path"] == "factsheets/dsp-2026-09-abcdef1234.pdf"
