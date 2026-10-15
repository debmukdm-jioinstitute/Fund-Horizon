import pandas as pd

from app.backoffice.screening.jobs import with_live_tail

TODAY = pd.Timestamp("2026-10-16")


def _series(*pairs):
    return pd.Series([v for _, v in pairs], index=pd.to_datetime([d for d, _ in pairs]))


def test_future_month_end_point_is_relabelled_to_real_last_nav_date():
    s = _series(("2026-08-31", 100.0), ("2026-09-30", 101.0), ("2026-10-31", 103.0))
    out = with_live_tail(s, "2026-10-14", TODAY)
    assert list(out.index[-2:]) == [pd.Timestamp("2026-09-30"), pd.Timestamp("2026-10-14")]
    assert out.iloc[-1] == 103.0


def test_missing_or_not_newer_date_falls_back_to_dropping_the_point():
    s = _series(("2026-09-30", 101.0), ("2026-10-31", 103.0))
    assert with_live_tail(s, None, TODAY).index[-1] == pd.Timestamp("2026-09-30")
    assert with_live_tail(s, "2026-09-20", TODAY).index[-1] == pd.Timestamp("2026-09-30")
    assert with_live_tail(s, "2026-12-01", TODAY).index[-1] == pd.Timestamp("2026-09-30")


def test_series_without_future_point_is_untouched():
    s = _series(("2026-08-31", 100.0), ("2026-09-30", 101.0))
    assert with_live_tail(s, "2026-10-14", TODAY).equals(s)
