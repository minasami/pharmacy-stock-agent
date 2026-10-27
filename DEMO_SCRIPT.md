# Demo video script (target 2:45, hard limit 3:00)

**Story in one line:** a stock-operations agent that runs a multi-step loop (see → read → check → propose) and then **stops and waits for a named pharmacist** before anything changes. It handles stock only. It is not a medical-advice tool and not a one-shot image analyzer.

**Setup before recording**
```bash
npm test                                     # 29 passing (shown at the end)
AS_OF=2026-10-27 npm run web                 # http://127.0.0.1:8787
```
- Click **Reset demo data** in the footer. Zoom so the whole photo card fits. Approver name: "Demo Pharmacist".
- **Preferred: record in live mode** (`MODEL_PROVIDER=meta`, `MODEL_API_KEY` set, key never on screen) after one successful live test run. Then the boxes and reads on screen really come from SAM 3.1 and Muse Spark.
- **If recording offline (replay mode):** say so on screen and in the voice-over (lines marked *offline*). In replay mode the results come from synthetic fixture files, not from a live model call. Never claim a live call that did not happen.
- Show only this repo, which was built during the event. No other projects, no real pharmacy names, people or products, no clinical wording.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 to 0:20 | Title card with the loop: **Photo → SAM 3.1 finds packs → Muse Spark reads each pack → catalog + expiry checks → proposed change set → pharmacist approves → stock updates** | "I'm a pharmacist. Expired stock and manual counts cost pharmacies time and money. This agent runs the whole stock check from one phone photo, then it stops: nothing changes until a named pharmacist approves. Stock only, never clinical advice. All data is synthetic." |
| 0:20 to 0:50 | **Scan photo**: shelf photo. Boxes appear. Hover a red box and a purple dashed box | "Step one, SAM 3.1 finds every pack. Step two, Muse Spark reads each region into a strict schema: name, strength, lot, expiry. Step three, the agent checks the catalog and expiry dates. Red is expired, orange is near expiry, and dashed purple means it isn't sure, so it doesn't guess." *Offline: "This run replays synthetic fixtures; live mode calls both models."* |
| 0:50 to 1:05 | Shelf audit panel: pull list, near expiry, **proposed CS-001** | "Step four, it proposes an action: quarantine the expired lot. That's a proposal, not a change. Stock is untouched." |
| 1:05 to 1:30 | **Review queue**: the unclear pack's crop and reasons. Pick the item from the catalog (nothing pre-selected), type lot and expiry, **Record as identified** | "When the read is doubtful, the agent hands it to a human. The pharmacist records what is printed. Nothing is pre-selected and the agent never suggests another product." |
| 1:30 to 1:55 | **Approvals**: show the button disabled with no name, type "Demo Pharmacist", **Approve**. Audit log appears | "The human gate. With no name, the button is disabled and the server refuses too. With a name, the change applies and goes in the audit log." |
| 1:55 to 2:10 | **Scan photo**: delivery carton sample → proposed receive change set → approve | "Same loop for deliveries: it receives good stock and refuses to receive a short-dated lot, again waiting for approval." |
| 2:10 to 2:25 | **Inventory & expiry**: expired lot now quarantined, "Show only flagged lots". Ask "Can I swap Ibuprofen for Paracetamol?" | "Inventory reflects only approved changes. Ask a substitution question and a deterministic guard refuses, in English or Arabic." |
| 2:25 to 2:40 | **Restock draft** by supplier, download | "Last step, a restock draft from par levels. Expired stock doesn't count, and it's a draft: nothing is sent." |
| 2:40 to 2:52 | `BUILT_DURING_EVENT.md` / `git log`, then `npm test` 29 passing | "Everything here was built during the hackathon. No dependencies, 29 tests, and it runs live on the Meta Model API or offline on synthetic fixtures." |

**Checks before upload:** under 3:00; synthetic banner visible; the provider in the header matches what the voice-over claims; no real pharmacy names; no clinical or substitution wording; key never visible.
