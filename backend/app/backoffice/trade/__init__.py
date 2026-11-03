"""Fund Horizon Trade desk — NSE cash day-trading toolkit (paper by default).

Ported from the day-trader-skill algorithms (scanner → entry → exit → timemachine →
budget → risk → broker) with Indian session, INR, and NSE symbol conventions.
"""

from app.backoffice.trade.service import TradeService, _SERVICE
from app.backoffice.trade.session import TradeError

__all__ = ["TradeService", "TradeError", "_SERVICE"]
