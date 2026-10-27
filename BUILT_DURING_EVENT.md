# Built during the event

Meta Global AI Developer Hackathon building period: **Oct 27 to Nov 4, 2026 (ET)**.

Everything in this repository was written during the building period. No code, data or assets were carried in from before the event. The git history is the record. Each commit's timestamp is listed below in ET (the event's zone) and in the author's local time (UTC+3, Cairo). Check it with:

```bash
TZ=America/New_York git log --reverse --format='%h %ad %s' --date=format-local:'%Y-%m-%d %H:%M %Z'
```

## Oct 27, 2026 (day 1)

### Core agent and CLI
| Commit | ET | UTC+3 | What |
|---|---|---|---|
| `ffc5ded` | 02:05 | 09:05 | Project skeleton, MIT licence |
| `5f92210` | 02:06 | 09:06 | Synthetic catalog, seed stock, generated shelf and delivery photos with replay sidecars (`scripts/make_samples.py`) |
| `3e4bb25` | 02:06 | 09:06 | Meta Model API client (`sam-3.1` on `/responses`, `muse-spark-1.3` on `/chat/completions`), SAM box-token parser, replay and live providers |
| `29ea409` | 02:07 | 09:07 | Expiry rules (MM/YYYY means end of month), catalog matcher that sends doubtful reads to a human, approval-gated inventory store |
| `d990e2e` | 02:07 | 09:07 | Shelf audit, delivery intake, expiry report, restock draft, non-clinical guard (English and Arabic) |
| `f306f10` | 02:08 | 09:08 | CLI, offline demo script, 10 tests (including a fake-fetch test of the Meta API calls) |
| `74c204b` | 02:08 | 09:08 | README |

### Web UI
| Commit | ET | UTC+3 | What |
|---|---|---|---|
| `6cf85c5` | 02:15 | 09:15 | Review queue and named rejects in the store. Stock Q&A shared by the CLI and the web UI |
| `f1b04a8` | 02:19 | 09:19 | Web API server on `node:http` with no dependencies: scan, review queue, named approvals, inventory, restock draft. The replay provider stays the default |
| `8fe2959` | 02:19 | 09:19 | Web UI with five views: photo upload with SAM boxes overlaid, review queue, approve-by-name, inventory with expiry flags, restock draft |
| `542e3f8` | 02:19 | 09:19 | Web API tests (14 tests in total) |
| *(this commit)* | | | `BUILT_DURING_EVENT.md`, `DEMO_SCRIPT.md`, README update |

## What the demo video shows was built during the event
All of it: the photo-to-stock pipeline, the review queue, approve-by-name with the audit log, the expiry flags, the restock draft, and the clinical-question refusal. The video opens on this file and the `git log` above.

## What is not ours
- **Models:** SAM 3.1 and Muse Spark through the Meta Model API.
- **Runtime:** Node.js 20+ built-ins only. There are no npm dependencies.
- **Sample photos:** generated with Pillow by our own script.

## Data
Synthetic only. The pharmacy, products, makers, suppliers, lots and barcodes (in-store `200-` prefix) are all fictional. No real pharmacy, patient or supplier data is used. The agent gives no clinical or substitution advice.

<!-- Add later days below as work continues, one heading per date (ET). -->
