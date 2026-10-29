# Live runs on Baseten (Muse Spark Open), 2026-10-29

Command environment: `MODEL_PROVIDER=baseten`, `BASETEN_MODEL=meta-models/muse-spark-open-1026`, default base URL `https://inference.baseten.co/v1`, `--as-of 2026-10-27`, synthetic samples only. The API key is not in any file here. Outputs are copied verbatim from the CLI.

| File | Flow | Result |
|---|---|---|
| 01-shelf.txt | `shelf samples/shelf-01.png` | 9 packs; expired lot DG2308F flagged, 2 near-expiry lots, region 8 sent to human review. Identical to the fixture ground truth. |
| 02-delivery.txt | `delivery samples/delivery-01.png` | Receive SYN-002 lot NL2409T x2; short-dated OP2408N refused; **1 pack sent to human review** (the fixture truth has SYN-007 lot NL2408S x1 receivable). Conservative miss, not a wrong receive. |
| 03-expiry.txt | `expiry` | Deterministic (no model call). |
| 04-restock.txt | `restock` | Deterministic draft (no model call); nothing sent. |
| 05-clinical-refusal.txt | `ask "What can I give instead of Amoxicillin?"` | Refused by the guard before any model call. |
| 06-agent.txt | `agent "Morning check: ..." --photo shelf --photo delivery --max-steps 6` | Muse Spark Open chose shelf_audit → delivery_intake → expiry_flags → restock_draft → final answer, proposing CS-001 and CS-002 and leaving stock unchanged. |
| 07-agent-refusal.txt | `agent "What can I give instead of Amoxicillin?"` | Refused, zero steps, no model call. |
| 08/09 | `pending`, `approve CS-001 --by "Demo Pharmacist"` | Approval gate applied the change only after a named approval. |

Limits: SAM 3.1 is not offered on Baseten (checked `GET /v1/models` on 2026-10-29: only `meta-models/muse-spark-open` and `meta-models/muse-spark-open-1026` from Meta), so pack boxes came from the labelled recorded sample boxes ("offline fixture, not SAM"); Muse Spark Open did the pack reads and the tool choices live. No integration bugs were found; no code changes were needed. Wall time: shelf read ~12 s; all eight commands ~26 s.
