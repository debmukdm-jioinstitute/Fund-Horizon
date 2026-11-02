from app.backoffice.valuation.providers.base import ProviderAdapter
from app.backoffice.valuation.providers.fundsindia import FundsIndia
from app.backoffice.valuation.providers.proaffluence import ProAffluence
from app.backoffice.valuation.providers.stallion import Stallion

ADAPTERS: dict[str, type[ProviderAdapter]] = {a.id: a for a in (FundsIndia, ProAffluence, Stallion)}
