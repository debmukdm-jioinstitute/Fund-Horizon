from __future__ import annotations
"""SQLite DDL and initialization for Fund Horizon Backoffice tables.

Ensures schema exists idempotently and seeds the default source and instrument registries.
"""

import logging
import os
import sqlite3
from datetime import UTC, datetime

from app.db import sqlite as _sqlite

logger = logging.getLogger(__name__)


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def init_backoffice_schema(conn: sqlite3.Connection) -> None:
    """Create all backoffice tables and indexes in SQLite if they don't exist."""
    try:
        _init_backoffice_schema_raw(conn)
    except sqlite3.OperationalError as e:
        logger.error("Failed to create backoffice tables (disk full or DB error): %s", e)


def _init_backoffice_schema_raw(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS source_registry (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            official_docs_url TEXT,
            adapter_id TEXT NOT NULL,
            adapter_version TEXT NOT NULL DEFAULT '1.0.0',
            terms_notes TEXT,
            configured_permissions TEXT NOT NULL DEFAULT 'public_view_only',
            enabled INTEGER NOT NULL DEFAULT 1,
            rate_budget INTEGER NOT NULL DEFAULT 60,
            timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
            supported_frequency TEXT NOT NULL DEFAULT 'daily',
            health_status TEXT NOT NULL DEFAULT 'ready',
            last_attempt_at TEXT,
            last_success_at TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS instrument_registry (
            id TEXT PRIMARY KEY,
            exchange TEXT NOT NULL DEFAULT 'NSE',
            symbol TEXT NOT NULL,
            name TEXT NOT NULL,
            asset_class TEXT NOT NULL,
            currency TEXT NOT NULL DEFAULT 'INR',
            base_currency TEXT,
            quote_currency TEXT,
            unit TEXT NOT NULL DEFAULT 'index_pts',
            source_id TEXT NOT NULL,
            source_identifier TEXT,
            contract_convention TEXT,
            valid_from TEXT,
            valid_to TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_inst_symbol ON instrument_registry(symbol)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_inst_source ON instrument_registry(source_id)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instrument_id TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            reference_period TEXT,
            published_at TEXT,
            fetched_at TEXT NOT NULL,
            value_numeric REAL,
            value_text TEXT,
            frequency TEXT NOT NULL DEFAULT 'daily',
            vintage TEXT NOT NULL DEFAULT 'initial',
            provenance TEXT NOT NULL DEFAULT 'automated',
            quality_flags TEXT NOT NULL DEFAULT 'ok',
            raw_hash TEXT,
            UNIQUE(instrument_id, observed_at, vintage, provenance)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_obs_inst_observed ON observations(instrument_id, observed_at)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS option_snapshots (
            id TEXT PRIMARY KEY,
            exchange TEXT NOT NULL,
            underlying_symbol TEXT NOT NULL,
            underlying_price REAL,
            snapshot_timestamp TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            source TEXT NOT NULL,
            pcr_oi REAL,
            pcr_volume REAL,
            total_call_oi INTEGER,
            total_put_oi INTEGER,
            total_call_volume INTEGER,
            total_put_volume INTEGER
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_opt_snap_underlying ON option_snapshots(underlying_symbol)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_opt_snap_time ON option_snapshots(snapshot_timestamp)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS option_contracts (
            id TEXT PRIMARY KEY,
            snapshot_id TEXT NOT NULL,
            exchange TEXT NOT NULL,
            underlying_symbol TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            strike_price REAL NOT NULL,
            option_type TEXT NOT NULL,
            contract_id TEXT,
            lot_size INTEGER NOT NULL DEFAULT 1,
            last_price REAL,
            oi INTEGER NOT NULL DEFAULT 0,
            oi_change INTEGER NOT NULL DEFAULT 0,
            volume INTEGER NOT NULL DEFAULT 0,
            implied_vol REAL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_opt_contract_snap ON option_contracts(snapshot_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_opt_contract_exp ON option_contracts(expiry_date)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS flows (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            report_date TEXT NOT NULL,
            category TEXT NOT NULL,
            segment TEXT NOT NULL,
            gross_buy REAL NOT NULL,
            gross_sell REAL NOT NULL,
            net REAL NOT NULL,
            unit TEXT NOT NULL DEFAULT 'inr_crore',
            status TEXT NOT NULL DEFAULT 'provisional',
            vintage TEXT NOT NULL DEFAULT 'initial',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_flows_date_cat ON flows(report_date, category)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_flows_date_cat_seg ON flows(report_date, category, segment)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pms_strategy_observations (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            strategy_name TEXT NOT NULL,
            approach TEXT,
            category TEXT,
            report_month TEXT NOT NULL,
            aum_crore REAL,
            return_1m REAL,
            return_3m REAL,
            return_6m REAL,
            return_1y REAL,
            cagr_3y REAL,
            cagr_5y REAL,
            cagr_since_inception REAL,
            inception_date TEXT,
            benchmark_name TEXT,
            benchmark_return_1y REAL,
            fee_structure_desc TEXT,
            source TEXT NOT NULL DEFAULT 'APMI',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_pms_strat_provider ON pms_strategy_observations(provider)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_pms_strat_month ON pms_strategy_observations(report_month)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS portfolio_positions (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            valuation_date TEXT NOT NULL,
            security_type TEXT NOT NULL,
            symbol_or_isin TEXT NOT NULL,
            security_name TEXT NOT NULL,
            quantity REAL NOT NULL,
            cost_price_paise INTEGER,
            market_price_paise INTEGER,
            market_value_paise INTEGER NOT NULL,
            weight_pct REAL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_port_pos_account ON portfolio_positions(account_id, valuation_date)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS portfolio_cashflows (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            flow_date TEXT NOT NULL,
            flow_type TEXT NOT NULL,
            amount_paise INTEGER NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_port_flow_account ON portfolio_cashflows(account_id, flow_date)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS portfolio_valuations (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            valuation_date TEXT NOT NULL,
            nav_per_unit REAL,
            total_units REAL,
            total_value_paise INTEGER NOT NULL,
            cash_balance_paise INTEGER NOT NULL DEFAULT 0,
            fees_accrued_paise INTEGER NOT NULL DEFAULT 0,
            holdings_coverage_pct REAL NOT NULL DEFAULT 100.0,
            xirr_pct REAL,
            twr_pct REAL,
            source TEXT NOT NULL DEFAULT 'statement_import',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_port_val_account ON portfolio_valuations(account_id, valuation_date)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fund_holdings (
            id TEXT PRIMARY KEY,
            scheme_code TEXT NOT NULL,
            disclosure_date TEXT NOT NULL,
            isin TEXT,
            company_name TEXT NOT NULL,
            sector TEXT,
            asset_class TEXT NOT NULL DEFAULT 'equity',
            weight_pct REAL NOT NULL,
            rating TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_fund_holdings_scheme ON fund_holdings(scheme_code, disclosure_date)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS issuer_fundamentals (
            id TEXT PRIMARY KEY,
            isin_or_symbol TEXT NOT NULL,
            company_name TEXT NOT NULL,
            sector TEXT,
            fiscal_period TEXT NOT NULL,
            revenue_crore REAL,
            ebitda_crore REAL,
            pat_crore REAL,
            operating_margin_pct REAL,
            net_margin_pct REAL,
            total_debt_crore REAL,
            cash_crore REAL,
            roe_pct REAL,
            pe_ratio REAL,
            scope TEXT NOT NULL DEFAULT 'consolidated',
            source TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_fundamentals_symbol ON issuer_fundamentals(isin_or_symbol, fiscal_period)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS watchlists (
            id TEXT PRIMARY KEY,
            staff_id TEXT NOT NULL,
            name TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_watchlist_staff ON watchlists(staff_id)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS research_notes (
            id TEXT PRIMARY KEY,
            staff_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_notes_entity ON research_notes(entity_type, entity_id)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS import_jobs (
            id TEXT PRIMARY KEY,
            staff_id TEXT NOT NULL,
            import_type TEXT NOT NULL,
            filename TEXT NOT NULL,
            total_rows INTEGER NOT NULL DEFAULT 0,
            valid_rows INTEGER NOT NULL DEFAULT 0,
            error_rows INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'preview',
            summary_json TEXT,
            errors_json TEXT,
            created_at TEXT NOT NULL,
            committed_at TEXT
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS operations_filings (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            form_title TEXT NOT NULL,
            form_url TEXT,
            household_id TEXT,
            client_name TEXT,
            folio TEXT,
            filled_by_id TEXT,
            filled_by_name TEXT,
            status INTEGER NOT NULL DEFAULT 0,
            pdf BLOB
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS ix_filings_created ON operations_filings(created_at DESC)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            id TEXT PRIMARY KEY,
            staff_id TEXT,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT,
            details_json TEXT,
            ip_address TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS collector_runs (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            status TEXT NOT NULL,
            records_ingested INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            started_at TEXT NOT NULL,
            completed_at TEXT
        )
        """
    )

    _seed_default_registries(conn)


def _seed_default_registries(conn: sqlite3.Connection) -> None:
    """Seed supported sources and baseline instruments."""
    try:
        _seed_default_registries_raw(conn)
    except sqlite3.OperationalError as e:
        logger.error("Failed to seed default registries (disk full or DB error): %s", e)


def _seed_default_registries_raw(conn: sqlite3.Connection) -> None:
    now = _utcnow()

    sources = [
        ("SRC_AMFI", "AMFI India NAV", "https://portal.amfiindia.com/spages/NAVAll.txt", "amfi_bulk", "1.0.0", "Daily official NAV file. Public domain.", "public_view_only", 1, 4, "Asia/Kolkata", "daily", "ready"),
        ("SRC_MFAPI", "MFapi Scheme History", "https://api.mfapi.in", "mfapi", "1.0.0", "Free community AMFI-derived API.", "public_view_only", 1, 60, "Asia/Kolkata", "daily", "ready"),
        ("SRC_ECB", "ECB Reference FX", "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", "ecb_fx", "1.0.0", "European Central Bank official reference exchange rates.", "public_view_only", 1, 24, "Europe/Frankfurt", "daily", "ready"),
        ("SRC_CBOE", "Cboe Historical Volatility", "https://www.cboe.com/tradable-products/vix/vix-historical-data", "cboe_vix", "1.0.0", "Cboe VIX daily close histories.", "public_view_only", 1, 4, "America/Chicago", "daily", "ready"),
        ("SRC_FRED", "Federal Reserve Economic Data", "https://fred.stlouisfed.org/docs/api/fred/", "fred_macro", "1.0.0", "St. Louis Fed API. Requires free API key for automated pulls.", "public_view_only", 1, 120, "America/New_York", "daily", "ready"),
        ("SRC_APMI", "APMI PMS Performance (all SEBI portfolio managers)", "https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu", "apmi_live", "2.0.0", "APMI public monthly performance report for every registered PMS provider and strategy, fetched from the page's own report endpoint. Manual CSV import remains available.", "public_view_only", 1, 8, "Asia/Kolkata", "monthly", "ready"),
        ("SRC_NSE_FNO", "NSE Indices, Derivatives & Flows", "https://www.nseindia.com/", "nse_live", "1.0.0", "NSE public website JSON (indices, India VIX, FII/DII, option chains). Subject to NSE terms; may rate-limit datacenter IPs.", "public_view_only", 1, 12, "Asia/Kolkata", "intraday", "ready"),
        ("SRC_IN_YIELDS", "India G-Sec Yields (scraped)", "https://tradingeconomics.com/india/government-bond-yield", "india_yields_scrape", "1.0.0", "Scraped from the public Trading Economics India bond page (indicative OTC quotes). No official free feed exists; FRED/OECD monthly is the fallback.", "public_view_only", 1, 2, "Asia/Kolkata", "daily", "ready"),
        ("SRC_AMFI_TER", "AMFI Total Expense Ratios", "https://www.amfiindia.com/ter-of-mf-schemes", "amfi_ter", "1.0.0", "AMFI TER JSON API behind the public TER page (Regular and Direct plans).", "public_view_only", 1, 2, "Asia/Kolkata", "daily", "ready"),
        ("SRC_FACTSHEETS", "Official Factsheets (AMC / PMS publishers)", "https://www.amfiindia.com/", "factsheet_discovery", "1.0.0", "Links to each publisher's own monthly factsheet PDF, verified live (HTTP 200 + PDF) before recording. Publishers whose pages need a browser are not covered yet.", "public_view_only", 1, 4, "Asia/Kolkata", "daily", "ready"),
        ("SRC_RSS", "Open RSS News Feeds", "https://www.rbi.org.in/", "rss_feeds", "1.0.0", "RBI, SEBI, PIB, ET, Mint, Business Standard, BusinessLine, Moneycontrol and Google News public RSS feeds. Headlines and links only.", "public_view_only", 1, 6, "Asia/Kolkata", "intraday", "ready"),
        ("SRC_TREASURY", "US Treasury Par Yield Curve", "https://home.treasury.gov/resource-center/data-chart-center/interest-rates", "us_treasury", "1.0.0", "Official US Treasury daily par yield curve. No key required.", "public_view_only", 1, 4, "America/New_York", "daily", "ready"),
        ("SRC_CORP_FILINGS", "Corporate Fundamentals & Filings", "https://www.bseindia.com/corporates", "corp_filings", "1.0.0", "Quarterly financial results & disclosures.", "manual_only", 1, 10, "Asia/Kolkata", "quarterly", "manual_only"),
        ("SRC_SCREENING", "Fund Horizon Screening Engine", "https://fundhorizon.in/backoffice/research?tab=screening", "screening_engine", "1.0.0", "Internal MF Regular Growth funnel metrics.", "public_view_only", 1, 1, "Asia/Kolkata", "daily", "ready"),
        ("SRC_ADVISORKHOJ", "Advisorkhoj Public Research", "https://www.advisorkhoj.com/", "advisorkhoj", "1.0.0", "Public HTML fund quartile rankings under robots.txt Allow: /; fallback to computed.", "public_view_only", 1, 2, "Asia/Kolkata", "daily", "ready"),
    ]

    # FRED needs a free key; do not advertise it as ready when none is configured.
    if not os.environ.get("FRED_API_KEY", "").strip():
        sources = [
            (*src[:11], "needs_key") if src[0] == "SRC_FRED" else src for src in sources
        ]

    for s in sources:
        conn.execute(
            """
            INSERT INTO source_registry (
                id, name, official_docs_url, adapter_id, adapter_version,
                terms_notes, configured_permissions, enabled, rate_budget,
                timezone, supported_frequency, health_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                official_docs_url=excluded.official_docs_url,
                adapter_id=excluded.adapter_id,
                terms_notes=excluded.terms_notes,
                configured_permissions=excluded.configured_permissions,
                rate_budget=excluded.rate_budget,
                supported_frequency=excluded.supported_frequency,
                health_status=excluded.health_status,
                updated_at=excluded.updated_at
            """,
            (*s, now, now),
        )

    # Backfill (2026-10-14): the old screening-engine link 404s. The upsert
    # above already rewrites official_docs_url on existing rows, but belt-and-
    # braces: fix any SRC_SCREENING row still pointing at the dead path.
    conn.execute(
        """
        UPDATE source_registry
        SET official_docs_url = 'https://fundhorizon.in/backoffice/research?tab=screening',
            updated_at = ?
        WHERE id = 'SRC_SCREENING'
          AND official_docs_url LIKE '%/internal/screening'
        """,
        (now,),
    )

    instruments = [
        # FX reference pairs
        ("FX:USDINR", "ECB", "USDINR", "USD/INR Reference Rate", "currency", "INR", "USD", "INR", "inr_per_usd", "SRC_ECB", "USD/INR", "spot_reference", "2000-01-01", None),
        ("FX:EURUSD", "ECB", "EURUSD", "EUR/USD Reference Rate", "currency", "USD", "EUR", "USD", "usd_per_eur", "SRC_ECB", "EUR/USD", "spot_reference", "2000-01-01", None),
        ("FX:GBPUSD", "ECB", "GBPUSD", "GBP/USD Reference Rate", "currency", "USD", "GBP", "USD", "usd_per_gbp", "SRC_ECB", "GBP/USD", "spot_reference", "2000-01-01", None),
        ("FX:USDJPY", "ECB", "USDJPY", "USD/JPY Reference Rate", "currency", "JPY", "USD", "JPY", "jpy_per_usd", "SRC_ECB", "USD/JPY", "spot_reference", "2000-01-01", None),
        ("FX:EURINR", "ECB", "EURINR", "EUR/INR Reference Rate", "currency", "INR", "EUR", "INR", "inr_per_eur", "SRC_ECB", "EUR/INR", "spot_reference", "2000-01-01", None),
        ("FX:GBPINR", "ECB", "GBPINR", "GBP/INR Reference Rate", "currency", "INR", "GBP", "INR", "inr_per_gbp", "SRC_ECB", "GBP/INR", "spot_reference", "2000-01-01", None),
        ("FX:JPYINR", "ECB", "JPYINR", "JPY/INR Reference Rate (100 JPY)", "currency", "INR", "JPY", "INR", "inr_per_100_jpy", "SRC_ECB", "JPY/INR", "spot_reference", "2000-01-01", None),
        # US yields
        ("YIELD:US:10Y", "FRED", "US10Y", "US 10-Year Treasury Yield", "fixed_income", "USD", None, None, "percent", "SRC_FRED", "DGS10", "constant_maturity", "1962-01-01", None),
        ("YIELD:US:2Y", "FRED", "US2Y", "US 2-Year Treasury Yield", "fixed_income", "USD", None, None, "percent", "SRC_FRED", "DGS2", "constant_maturity", "1976-01-01", None),
        ("YIELD:US:30Y", "FRED", "US30Y", "US 30-Year Treasury Yield", "fixed_income", "USD", None, None, "percent", "SRC_FRED", "DGS30", "constant_maturity", "1977-01-01", None),
        # India yields
        ("YIELD:IN:10Y", "FBIL", "IN10Y", "India 10-Year Benchmark G-Sec Yield", "fixed_income", "INR", None, None, "percent", "SRC_AMFI", "IN10Y", "annual_compounding", "2000-01-01", None),
        ("YIELD:IN:2Y", "FBIL", "IN2Y", "India 2-Year Benchmark G-Sec Yield", "fixed_income", "INR", None, None, "percent", "SRC_AMFI", "IN2Y", "annual_compounding", "2000-01-01", None),
        # Volatility
        ("VOL:US:VIX", "CBOE", "VIX", "Cboe Volatility Index Close", "volatility", "USD", None, None, "index_pts", "SRC_CBOE", "VIX", "implied_vol", "1990-01-01", None),
        ("VOL:IN:INDIAVIX", "NSE", "INDIAVIX", "India VIX Index Close", "volatility", "INR", None, None, "index_pts", "SRC_NSE_FNO", "INDIAVIX", "implied_vol", "2008-01-01", None),
        # Equity indices (persisted by the NSE collector; seeded here for provenance)
        ("INDEX:IN:NIFTY50", "NSE", "NIFTY 50", "NIFTY 50 Index", "equity", "INR", None, None, "index_pts", "SRC_NSE_FNO", "NIFTY 50", "spot", "2000-01-01", None),
        ("INDEX:IN:NIFTYBANK", "NSE", "NIFTY BANK", "NIFTY Bank Index", "equity", "INR", None, None, "index_pts", "SRC_NSE_FNO", "NIFTY BANK", "spot", "2000-01-01", None),
        ("INDEX:IN:SENSEX", "BSE", "SENSEX", "BSE SENSEX Index", "equity", "INR", None, None, "index_pts", "SRC_NSE_FNO", "SENSEX", "spot", "2000-01-01", None),
        # Macro proxy
        ("MACRO:US:BROAD_USD", "FRED", "DTWEXBGS", "Trade Weighted U.S. Dollar Index (Broad Proxy)", "currency", "USD", None, None, "index_pts", "SRC_FRED", "DTWEXBGS", "trade_weighted", "2006-01-01", None),
    ]

    for inst in instruments:
        conn.execute(
            """
            INSERT INTO instrument_registry (
                id, exchange, symbol, name, asset_class, currency,
                base_currency, quote_currency, unit, source_id,
                source_identifier, contract_convention, valid_from, valid_to, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                source_identifier=excluded.source_identifier
            """,
            (*inst, now),
        )


_SEEDED_PATHS: set[str] = set()


def ensure_backoffice_schema() -> None:
    """Ensure SQLite backoffice and CRM products schemas are loaded and registries are current."""
    try:
        conn = _sqlite.get_default_connection()
    except sqlite3.OperationalError as e:
        logger.error("Failed to connect to SQLite in ensure_backoffice_schema: %s", e)
        return

    try:
        table_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='source_registry'"
        ).fetchone()
        crm_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='pms_accounts'"
        ).fetchone()
        if not table_check or not crm_check:
            with conn:
                from app.db_crm_products import init_crm_products_schema

                init_crm_products_schema(conn)
                init_backoffice_schema(conn)
            _SEEDED_PATHS.add(str(_sqlite.get_default_db_path()))
        elif str(_sqlite.get_default_db_path()) not in _SEEDED_PATHS:
            # Existing volumes: refresh source/instrument registries once per process so new feeds appear.
            with conn:
                _seed_default_registries(conn)
            _SEEDED_PATHS.add(str(_sqlite.get_default_db_path()))

        # Always guarantee unique index on flows(report_date, category, segment)
        flows_check = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='flows'"
        ).fetchone()
        if flows_check:
            with conn:
                conn.execute(
                    """
                    DELETE FROM flows
                    WHERE id NOT IN (
                        SELECT id FROM (
                            SELECT id, ROW_NUMBER() OVER (
                                PARTITION BY report_date, category, segment
                                ORDER BY created_at DESC, id DESC
                            ) AS rn
                            FROM flows
                        ) t
                        WHERE t.rn = 1
                    )
                    """
                )
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_flows_date_cat_seg ON flows(report_date, category, segment)")
    except sqlite3.OperationalError as e:
        logger.error("Failed to ensure backoffice schema or seed registries (disk full or DB error): %s", e)
    finally:
        conn.close()
