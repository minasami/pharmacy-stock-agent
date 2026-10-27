# Built during the event

Meta Global AI Developer Hackathon building period: **Oct 26, 2026, 12:00 PM ET (kickoff livestream, 17:00 UTC) to Nov 4, 2026, 9:00 PM ET (submission deadline, Nov 5 02:00 UTC)**, as listed on the event page (cerebralvalley.ai/e/meta-ai-developer-hackathon) and in the organisers' welcome email. The first commit here (`ffc5ded`, Oct 27 02:05 ET) is about 14 hours after kickoff.

Everything in this repository was written during the building period. No code, data or assets were carried in from before the event. The git history is the record. Each commit's timestamp is listed below in ET (the event's zone) and in the author's local time (UTC+3, Cairo). Check it with:

```bash
TZ=America/New_York git log --reverse --format='%h %ad %s' --date=format-local:'%Y-%m-%d %H:%M %Z'
```

## Oct 27, 2026 (ET)

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
| `7d1c815` | 02:20 | 09:20 | `BUILT_DURING_EVENT.md`, `DEMO_SCRIPT.md`, README update |

### Hardening, tests and accessibility
| Commit | ET | UTC+3 | What |
|---|---|---|---|
| `c722403` | 09:39 | 16:39 | Correct the event window in the docs and footer (the building period starts at the Oct 26 kickoff) |
| `e2aa84f` | 09:40 | 16:40 | Validate the mock/meta provider switch, failing fast on bad config (3 tests) |
| `e3af4e9` | 09:40 | 16:40 | Meta API client: timeout, retry on 429/5xx with `Retry-After`, 401/403 hints, key redacted from errors (4 tests) |
| `18f351f` | 09:40 | 16:40 | SAM 3.1 request sent as a typed user message, with the full request shape asserted |
| `8782fea` | 09:41 | 16:41 | CLI input validation with usage and exit code 2 (2 tests) |
| `e359872` | 09:41 | 16:41 | Replay provider explains when a photo has no recorded result (1 test) |
| `9c36af8` | 09:41 | 16:41 | Web server: model failures return 502 with no state change, clear port-in-use message (2 tests) |
| `5d7cab7` | 09:42 | 16:42 | Web UI accessibility: skip link, `aria-current`, focus management, error alerts, labelled inputs, focus rings, AA contrast (3 tests) |
| `5b16d57` | 09:43 | 16:43 | README: setup and run steps, documented mock vs live provider switch |
| `59f8090` | 09:43 | 16:43 | This log updated, demo script test count (29 tests in total) |
| `0237e0f` | 09:53 | 16:53 | `.gitignore` covers every `.env` variant except `.env.example`, key files, logs |
| `f0bc8d9` | 09:53 | 16:53 | Catalog makers renamed to placeholders (Maker A/B/C) so none resembles a real company |
| `b0dace0` | 09:54 | 16:54 | Demo script leads with the agent loop and the approval gate, with honest offline/live wording |
| `722b9dd` | 09:54 | 16:54 | This log updated |

### Agentic step selection (tool calling)
| Commit | ET | UTC+3 | What |
|---|---|---|---|
| `b4a6ab3` | 09:59 | 16:59 | Agent tools: five function tools over the existing workflows, no approve tool, photo ids only, guarded notes (3 tests) |
| `3c6c2d5` | 10:00 | 17:00 | Bounded agent loop and offline mock planner: guard before the planner, duplicate-scan block, step limit (5 tests) |
| `0f7dfb5` | 10:01 | 17:01 | Meta planner: Muse Spark tool calling on `/chat/completions`, request shape checked with a fake `fetch` (2 tests) |
| `3fad7c1` | 10:01 | 17:01 | CLI `agent` command with `--photo`, `--max-steps` and a step trace (1 test) |
| `84c865f` | 10:03 | 17:03 | Web: Agent run view and `POST /api/agent` (3 tests) |
| *(this commit)* | | | README agent section, demo script and `npm run demo` updated, this log (43 tests in total) |

## What the demo video shows was built during the event
All of it: the agent run where the model chooses the steps, the photo-to-stock pipeline, the review queue, approve-by-name with the audit log, the expiry flags, the restock draft, and the clinical-question refusal. The video opens on this file and the `git log` above.

## What is not ours
- **Models:** SAM 3.1 and Muse Spark through the Meta Model API.
- **Runtime:** Node.js 20+ built-ins only. There are no npm dependencies.
- **Sample photos:** generated with Pillow by our own script.

## Data
Synthetic only. The pharmacy, products, makers, suppliers, lots and barcodes (in-store `200-` prefix) are all fictional. No real pharmacy, patient or supplier data is used. The agent gives no clinical or substitution advice.

<!-- Add later days below as work continues, one heading per date (ET). -->
