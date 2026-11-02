"""Monthly portfolio valuation: multi-provider statements -> reconciled, approved, immutable consolidated report.

Layering (each layer only calls the one below it):
  api/valuation.py -> service.py -> {ingestion, detection, providers/*, validation, reconciliation,
  consolidation, performance, report} -> models.py (SQLAlchemy, additive tables prefixed ``val_``).
Provider adapters only extract and normalise; every financial number is computed in consolidation/performance.
"""
