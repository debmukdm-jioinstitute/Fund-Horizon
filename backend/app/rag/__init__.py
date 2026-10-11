"""RAG (Retrieval-Augmented Generation) package for mutual fund scheme knowledge base."""
from app.rag.qa import answer_query
from app.rag.store import get_collection, ingest_documents, search_schemes

__all__ = ["get_collection", "ingest_documents", "search_schemes", "answer_query"]
