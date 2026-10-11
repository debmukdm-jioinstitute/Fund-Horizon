# Phase 4 Report: Fund Knowledge Base & Retrieval ("Ask about any fund")

**Status:** Completed  
**Coverage:** 91.49% engine test coverage (floor: 85%)  
**Tests:** 425/425 backend tests passed; 8/8 Playwright E2E tests passed  
**Lint & Compliance:** `make lint` clean; `node scripts/check-copy.mjs` clean (zero banned words, mandatory compliance tags checked)

---

## 1. What Changed

1. **Document Generation Script (`backend/scripts/generate_docs.py`)**:
   - Purely local, zero-network script that reads existing CSVs (`all_schemes_metrics.csv`, `category_summary.csv`, and `nav_monthly/*.csv`).
   - Generated 3,638 individual scheme markdown files in `data/fundhorizon_mf_rag_dataset/schemes_md/` with YAML frontmatter, data quality banner (`ok`, `split_adjusted`, `nav_shock`, `segregated_portfolio`, `flat_nav`, `inactive_or_stale`), trailing returns table, 3Y risk metrics (Sharpe, Sortino, max drawdown), rolling return tables, and calendar-year return table.
   - Generated 3,638 structured scheme JSON files in `schemes_json/`.
   - Generated 92 category summary pages in `categories/` with median returns, volatility, Sharpe ratio, and 3Y CAGR rankings.
   - Generated 51 AMC summary pages in `amcs/` listing headline scheme returns.
   - Created `ingest_example.py` in `data/fundhorizon_mf_rag_dataset/`.

2. **ChromaDB & FastEmbed Vector Store (`backend/app/rag/store.py`)**:
   - Integrated ChromaDB with `BAAI/bge-small-en-v1.5` embeddings via `fastembed` (ONNX runtime for lightweight footprint).
   - Configurable persistence directory via `FH_CHROMA_DIR`, defaulting to `/data/chroma` on Railway volumes or local `chroma_db/`.
   - Batch ingestion function (`ingest_documents`) extracting frontmatter and upserting document chunks with metadata: `scheme_code`, `scheme_name`, `amc`, `category`, `plan`, `data_quality`.
   - Semantic similarity search (`search_schemes`) supporting cosine distance and metadata filtering.

3. **Synthesis & Q&A Layer (`backend/app/rag/qa.py`)**:
   - Templated response generator that combines retrieved semantic hits with authoritative metrics from `all_schemes_metrics.csv`.
   - Includes graceful fallback keyword search over in-memory metrics when Chroma vector collection is unpopulated.
   - Transparent source citations (`scheme_code`, `scheme_name`, `amc`, `category`, `plan`, `data_quality`).
   - Explicit "as of" date (`2026-10-09`) and statutory disclaimer under ARN 345439 (`app/config/disclosures.py:RAG_DISCLAIMER`).

4. **API Endpoints (`backend/app/api/routes.py`)**:
   - `GET /api/rag/ask`: Accepts query string, category, plan, amc, and top_k parameters.
   - `POST /api/rag/ask`: Accepts JSON body with query and filters (`RagAskRequest`).
   - `POST /api/rag/ingest`: Triggers background or on-demand ingestion into ChromaDB.

5. **Frontend "Ask About Any Fund" Experience**:
   - Types: Defined `RagSourceItem` and `RagAnswerResult` in `frontend/lib/types.ts`.
   - Client API: Added `askFundRag` in `frontend/lib/api.ts`.
   - Component: `frontend/components/FundRagSearch.tsx` featuring query input, suggested quick queries ("HDFC Banking and PSU Debt", "Large Cap Funds", "Parag Parikh Flexi Cap", "SBI Small Cap"), plan selector, formatted response, clickable source cards linking to fund pages (`/funds/[code]`), and statutory disclaimers.
   - Dedicated Page: `frontend/app/funds/ask/page.tsx` with breadcrumbs and metadata.
   - Navigation: Added "Ask Funds" link to top header navigation (`frontend/app/layout.tsx`).

6. **Testing & Quality Assurance**:
   - Backend tests in `backend/tests/test_rag.py` covering frontmatter parsing, sample doc ingestion into ChromaDB, vector search, templated answer generation, and FastAPI endpoints.
   - Verified statutory disclosures and banned word scanning in `backend/tests/test_compliance_copy.py`.
   - Playwright E2E smoke test in `frontend/e2e/smoke.spec.ts` verifying `/funds/ask` rendering, search inputs, suggestions, and ARN 345439 attribution.

---

## 2. Files Touched

- `backend/requirements.txt`
- `backend/pyproject.toml`
- `backend/app/config/disclosures.py`
- `backend/app/schemas.py`
- `backend/app/api/routes.py`
- `backend/app/rag/__init__.py` (new)
- `backend/app/rag/store.py` (new)
- `backend/app/rag/qa.py` (new)
- `backend/scripts/generate_docs.py` (new)
- `backend/tests/test_rag.py` (new)
- `backend/tests/test_compliance_copy.py`
- `frontend/lib/types.ts`
- `frontend/lib/api.ts`
- `frontend/components/FundRagSearch.tsx` (new)
- `frontend/app/funds/ask/page.tsx` (new)
- `frontend/app/layout.tsx`
- `frontend/e2e/smoke.spec.ts`
- `data/fundhorizon_mf_rag_dataset/` (`schemes_md/`, `schemes_json/`, `categories/`, `amcs/`, `ingest_example.py`)

---

## 3. Test & Verification Results

- `make lint`:
  - `backend`: Ruff checks all passed cleanly.
  - `frontend`: ESLint clean, TypeScript compiler (`tsc --noEmit`) clean, copy checker (`scripts/check-copy.mjs`) clean.
- `make test`:
  - Pytest: 425 passed, 14 warnings in 15.35s.
  - Test coverage for `app/engine`: **91.49%** (exceeds 85% requirement).
  - Playwright E2E: 8 passed in 25.0s.

---

## 4. Open Questions

- *Automatic background Chroma indexing on server boot:* Should the API container automatically index the top 500 funds or full collection on startup if the Chroma database directory is empty, or keep it triggered via `POST /api/rag/ingest`?
