# Phase 5 Report: LiteLLM Explanation Layer with Safety Guardrails

**Status:** Completed  
**Coverage:** 91.49% engine test coverage (floor: 85%)  
**Tests:** 433/433 backend tests passed; 8/8 Playwright E2E tests passed  
**Lint & Compliance:** `make lint` clean; `node scripts/check-copy.mjs` clean (zero banned words, mandatory compliance tags checked)

---

## 1. What Changed

1. **LiteLLM Multi-Provider Fallback Orchestration (`backend/app/ai/client.py`, `backend/app/config/ai.yaml`)**:
   - Integrated LiteLLM with ordered fallback support across free-tier providers:
     1. Groq (`groq/llama-3.1-8b-instant`)
     2. Google Gemini (`gemini/gemini-1.5-flash`)
     3. OpenRouter (`openrouter/meta-llama/llama-3-8b-instruct:free`)
     4. Local Ollama (`ollama/llama3`)
   - Configurable timeouts (15s), retry loops, system prompt instructions, and deterministic temperature (0.1).
   - In-memory response caching based on SHA256 of payloads to prevent redundant LLM invocations.

2. **Compliance & Accuracy Guardrails (`backend/app/ai/guardrails.py`)**:
   - **Number Consistency Verifier:** Parses all numbers from structured engine inputs and asserts that any number in generated text exists in the input payload within numeric formatting tolerance. If an extraneous number or hallucination is detected, the system safely falls back to deterministic rule-based templates.
   - **Banned-Wording Compliance Scanner:** Automatically scans generated outputs against prohibited distributor wording (`best`, `guaranteed`, `advice`, `advisory`, `recommend you buy`).
   - **PII Scrubber:** Redacts PAN numbers, email addresses, and phone numbers before logging or forwarding payloads.
   - **Statutory Disclosures:** Enforces mandatory ARN 345439 attribution and educational disclaimer on all generated narratives.

3. **Explanation Services (`backend/app/ai/explain.py`)**:
   - `explain_plan`: Translates risk profile, asset allocation, goal SIPs, and Monte Carlo probabilities into a plain-English narrative.
   - `explain_fund`: Explains trailing returns, 3Y volatility, Sharpe ratio, and drawdown metrics.
   - `explain_cas`: Explains CAS portfolio summary, XIRR returns, asset allocation drift, and direct vs regular plan distribution.

4. **API Endpoints (`backend/app/api/routes.py`)**:
   - `POST /api/ai/explain/plan`: Accepts `plan_id` or `plan_data`.
   - `POST /api/ai/explain/fund`: Accepts `scheme_code`.
   - `POST /api/ai/explain/cas`: Accepts `cas_data`.

5. **Frontend UI Integration**:
   - Created `frontend/components/ExplainModal.tsx`: Interactive modal component featuring an "AI-Assisted" or "Rule-Based Summary" badge, narrative display, and statutory disclosures.
   - Integrated "Explain Plan with AI" button on plan dashboard (`frontend/app/plan/[id]/PlanView.tsx`).
   - Integrated "Explain Metrics" button on fund detail page (`frontend/app/funds/[code]/page.tsx`).
   - Integrated "Explain Portfolio Analysis" button on CAS analysis results (`frontend/components/CasUpload.tsx`).
   - Added frontend API helpers in `frontend/lib/api.ts` and types in `frontend/lib/types.ts`.

6. **Testing & Quality Assurance**:
   - Added unit tests in `backend/tests/test_ai.py` covering number consistency verification, banned word scanning, PII scrubbing, deterministic fallback, mocked LLM validation, guardrail rejection triggers, and API routes.
   - Verified compliance scanner integrity in `backend/tests/test_compliance_copy.py`.

---

## 2. Files Touched

- `backend/requirements.txt`
- `backend/pyproject.toml`
- `backend/app/config/ai.yaml` (new)
- `backend/app/config/disclosures.py`
- `backend/app/schemas.py`
- `backend/app/api/routes.py`
- `backend/app/ai/__init__.py` (new)
- `backend/app/ai/client.py` (new)
- `backend/app/ai/guardrails.py` (new)
- `backend/app/ai/explain.py` (new)
- `backend/tests/test_ai.py` (new)
- `backend/tests/test_compliance_copy.py`
- `frontend/lib/types.ts`
- `frontend/lib/api.ts`
- `frontend/components/ExplainModal.tsx` (new)
- `frontend/app/plan/[id]/PlanView.tsx`
- `frontend/app/funds/[code]/page.tsx`
- `frontend/components/CasUpload.tsx`

---

## 3. Test & Verification Results

- `make lint`:
  - `backend`: Ruff checks all passed cleanly.
  - `frontend`: ESLint clean, TypeScript compiler (`tsc --noEmit`) clean, copy checker (`scripts/check-copy.mjs`) clean.
- `make test`:
  - Pytest: 433 passed, 14 warnings in 18.45s.
  - Test coverage for `app/engine`: **91.49%** (floor: 85%).
  - Playwright E2E: 8 passed in 22.1s.

---

## 4. Open Questions

- *Streaming Responses:* Would you like streamed token responses via Server-Sent Events (SSE) for explanation queries in a future phase, or is the current JSON payload format preferred?
