"""Tests for Cloudflare R2 storage module with mocked boto3 client and fallback."""
from __future__ import annotations

from pathlib import Path
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


def test_r2_get_list_delete(monkeypatch, tmp_path):
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sec123")
    monkeypatch.setenv("R2_BUCKET", "fund-horizon-files")

    mock_client = MagicMock()
    mock_paginator = MagicMock()
    mock_paginator.paginate.return_value = [
        {"Contents": [{"Key": "backups/plans-20261020-0000.db.gz"}, {"Key": "backups/plans-20261021-0000.db.gz"}]}
    ]
    mock_client.get_paginator.return_value = mock_paginator

    with patch("app.storage.r2.boto3.client", return_value=mock_client):
        # get_file
        dest = tmp_path / "downloaded.txt"
        r2.get_file("test.txt", dest)
        mock_client.download_file.assert_called_once_with("fund-horizon-files", "test.txt", str(dest))

        # list_keys
        keys = r2.list_keys("backups/")
        assert keys == ["backups/plans-20261020-0000.db.gz", "backups/plans-20261021-0000.db.gz"]

        # delete
        assert r2.delete("old.txt") is True
        mock_client.delete_object.assert_called_once_with(Bucket="fund-horizon-files", Key="old.txt")


def test_backup_upload_and_retention(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app import backup

    db_path = tmp_path / "plans.db"
    import sqlite3
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE test (id int)")
    conn.execute("INSERT INTO test VALUES (1)")
    conn.commit()
    conn.close()

    monkeypatch.setattr("app.backup.get_default_db_path", lambda: db_path)
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sec123")
    monkeypatch.setenv("R2_BUCKET", "fund-horizon-files")
    monkeypatch.setattr("app.backup.KEEP", 2)

    uploaded: dict[str, bytes] = {}
    deleted = []

    def mock_put_file(local_path, key, content_type=None):
        uploaded[key] = Path(local_path).read_bytes()
        return key

    existing_backups = [
        "backups/plans-20261001-0000.db.gz",
        "backups/plans-20261002-0000.db.gz",
        "backups/plans-20261003-0000.db.gz",
    ]

    def mock_list_keys(prefix=""):
        return sorted(existing_backups + list(uploaded.keys()))

    def mock_delete(key):
        deleted.append(key)
        if key in existing_backups:
            existing_backups.remove(key)
        return True

    monkeypatch.setattr("app.storage.r2.put_file", mock_put_file)
    monkeypatch.setattr("app.storage.r2.list_keys", mock_list_keys)
    monkeypatch.setattr("app.storage.r2.delete", mock_delete)

    key = backup.backup_sqlite()
    assert key is not None and key.startswith("backups/plans-") and key.endswith(".db.gz")
    assert key in uploaded
    # Verify retention deleted older backups down to KEEP=2
    assert "backups/plans-20261001-0000.db.gz" in deleted
    assert "backups/plans-20261002-0000.db.gz" in deleted


def test_restore_on_boot(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    import gzip
    import sqlite3

    from app import backup

    db_path = tmp_path / "empty_plans.db"
    monkeypatch.setattr("app.backup.get_default_db_path", lambda: db_path)
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sec123")
    monkeypatch.setenv("R2_BUCKET", "fund-horizon-files")

    # Create dummy gzipped db content
    raw_tmp = tmp_path / "raw.db"
    conn = sqlite3.connect(raw_tmp)
    conn.execute("CREATE TABLE restored_table (x text)")
    conn.execute("INSERT INTO restored_table VALUES ('restored_val')")
    conn.commit()
    conn.close()

    gz_content = gzip.compress(raw_tmp.read_bytes())

    def mock_list_keys(prefix=""):
        return ["backups/plans-20261021-1200.db.gz"]

    def mock_get_file(key, local_path):
        Path(local_path).write_bytes(gz_content)
        return Path(local_path)

    monkeypatch.setattr("app.storage.r2.list_keys", mock_list_keys)
    monkeypatch.setattr("app.storage.r2.get_file", mock_get_file)

    assert backup.restore_if_needed() is True
    assert db_path.exists()
    conn2 = sqlite3.connect(db_path)
    row = conn2.execute("SELECT x FROM restored_table").fetchone()
    conn2.close()
    assert row[0] == "restored_val"


def test_health_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "r2" in data
    assert "db_bytes" in data
    assert "data_free_mb" in data
