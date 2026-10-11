"""ChromaDB store and vector search using BAAI/bge-small-en-v1.5 embeddings."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import chromadb

_embedding_model = None


def get_chroma_dir() -> str:
    """Return persistent directory for ChromaDB storage."""
    env_dir = os.environ.get("FH_CHROMA_DIR")
    if env_dir:
        return env_dir
    if os.path.exists("/data/chroma"):
        return "/data/chroma"
    # Local fallback
    default_local = Path(__file__).resolve().parent.parent.parent / "chroma_db"
    default_local.mkdir(parents=True, exist_ok=True)
    return str(default_local)


def get_embedding_model():
    """Lazy-load fastembed BAAI/bge-small-en-v1.5 embedding model."""
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding

        _embedding_model = TextEmbedding("BAAI/bge-small-en-v1.5")
    return _embedding_model


def get_chroma_client() -> chromadb.ClientAPI:
    """Get persistent Chroma client."""
    path = get_chroma_dir()
    return chromadb.PersistentClient(path=path)


def get_collection() -> chromadb.Collection:
    """Get or create the fundhorizon_schemes collection."""
    client = get_chroma_client()
    return client.get_or_create_collection(
        name="fundhorizon_schemes",
        metadata={"hnsw:space": "cosine"},
    )


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Extract YAML frontmatter fields from markdown text."""
    meta: dict[str, Any] = {}
    body = content
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            raw_meta = parts[1]
            body = parts[2].strip()
            for line in raw_meta.splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    meta[k] = v
    return meta, body


def ingest_documents(
    docs_dir: Path | str,
    limit: int | None = None,
    batch_size: int = 64,
) -> int:
    """Ingest markdown files from schemes_md into ChromaDB with fastembed."""
    docs_path = Path(docs_dir)
    if not docs_path.exists():
        raise FileNotFoundError(f"Knowledge base directory not found: {docs_path}")

    files = sorted(list(docs_path.glob("*.md")))
    if limit is not None and limit > 0:
        files = files[:limit]

    if not files:
        return 0

    collection = get_collection()
    model = get_embedding_model()

    total_ingested = 0
    for i in range(0, len(files), batch_size):
        batch_files = files[i : i + batch_size]
        ids = []
        documents = []
        metadatas = []

        for f in batch_files:
            text = f.read_text(encoding="utf-8")
            meta, body = parse_frontmatter(text)

            scheme_code = str(meta.get("scheme_code") or f.stem.split("_")[0])
            scheme_name = str(meta.get("scheme_name") or f.stem)
            amc = str(meta.get("amc") or "")
            category = str(meta.get("category") or "")
            plan = str(meta.get("plan") or "Regular")
            data_quality = str(meta.get("data_quality") or "ok")

            clean_meta = {
                "scheme_code": scheme_code,
                "scheme_name": scheme_name[:120],
                "amc": amc[:80],
                "category": category[:80],
                "plan": plan,
                "data_quality": data_quality,
            }

            ids.append(scheme_code)
            documents.append(text[:2500])  # keep full context chunk
            metadatas.append(clean_meta)

        embeddings_gen = model.embed(documents)
        embeddings = [e.tolist() for e in embeddings_gen]

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        total_ingested += len(batch_files)

    return total_ingested


def search_schemes(
    query: str,
    filters: dict[str, Any] | None = None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """Search for relevant schemes using semantic embedding similarity and optional metadata filters."""
    collection = get_collection()
    count = collection.count()
    if count == 0:
        return []

    model = get_embedding_model()
    query_embedding = list(model.embed([query]))[0].tolist()

    where_clause = None
    if filters:
        clean_filters = {k: v for k, v in filters.items() if v is not None}
        if len(clean_filters) == 1:
            where_clause = clean_filters
        elif len(clean_filters) > 1:
            where_clause = {"$and": [{k: v} for k, v in clean_filters.items()]}

    results = collection.query(
        query_embeddings=[list(query_embedding)],
        n_results=min(top_k, count),
        where=where_clause,
        include=["documents", "metadatas", "distances"],
    )

    out = []
    if results and results.get("ids") and results["ids"][0]:
        ids = results["ids"][0]
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        dists = results.get("distances", [[]])[0]

        for i in range(len(ids)):
            out.append({
                "scheme_code": ids[i],
                "document": docs[i] if i < len(docs) else "",
                "metadata": metas[i] if i < len(metas) else {},
                "distance": dists[i] if i < len(dists) else 0.0,
            })
    return out
