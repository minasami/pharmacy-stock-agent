# Demo video script (target 2:45, hard limit 3:00)

**Story in one line:** a stock-operations agent that chooses its own steps with tool calling (see → read → check → propose) and then **stops and waits for a named pharmacist** before anything changes. It handles stock only. It is not a medical-advice tool and not a one-shot image analyzer.

**Setup before recording**
```bash
npm test                                     # all passing (shown at the end)
AS_OF=2026-10-27 npm run web                 # http://127.0.0.1:8787
```
- Click **Reset demo data** in the footer. Zoom so the whole photo card fits. Approver name: "Demo Pharmacist".
- **Preferred: record in live mode** (`MODEL_PROVIDER=meta`, `MODEL_API_KEY` set, key never on screen) after one successful live test run. Then the tool choices, boxes and reads on screen really come from Muse Spark and SAM 3.1.
- **If recording offline (replay mode):** say so on screen and in the voice-over (lines marked *offline*). In replay mode the tool choices come from a deterministic mock planner and the results from synthetic fixture files, not from a live model call. Never claim a live call that did not happen.
- Show only this repo, which was built during the event. No other projects, no real pharmacy names, people or products, no clinical wording.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 to 0:20 | Title card with the loop: **Request → Muse Spark picks the next tool → SAM 3.1 finds packs, Muse Spark reads them → catalog + expiry checks → proposed change set → pharmacist approves → stock updates** | "I'm a pharmacist. Expired stock and manual counts cost pharmacies time and money. This agent plans and runs the whole stock check from a request and a couple of photos, then it stops: nothing changes until a named pharmacist approves. Stock only, never clinical advice. All data is synthetic." |
| 0:20 to 0:55 | **Agent run**: request "Morning check: audit the shelf, receive the delivery and draft the reorder", both sample photos ticked, max 6 steps, **Run agent**. The step trace appears: delivery intake, shelf audit, restock draft, final answer | "I give it a goal, not a script. The model chooses each step through tool calling: delivery intake for the carton, shelf audit for the shelf, then the restock draft. It runs at most six steps. It has five tools and none of them can approve anything, so every result is a proposal." *Offline: "This run uses the offline planner that simulates the tool choices on synthetic fixtures; in live mode Muse Spark chooses them."* |
| 0:55 to 1:20 | **Review queue**: the unclear pack's crop with its SAM box and reasons. Pick the item from the catalog (nothing pre-selected), type lot and expiry, **Record as identified** | "When a read is doubtful the agent doesn't guess, it queues the pack for a human. The pharmacist records what is printed. Nothing is pre-selected and the agent never suggests another product." |
| 1:20 to 1:50 | **Approvals**: the two proposed change sets. Show the button disabled with no name, type "Demo Pharmacist", **Approve** both. Audit log appears | "The human gate. With no name, the button is disabled and the server refuses too. With a name, the change applies and goes in the audit log, next to the agent run that proposed it." |
| 1:50 to 2:05 | **Agent run**: type "What can I give instead of Amoxicillin?", **Run agent** → refusal, zero steps | "Ask it anything clinical and a deterministic guard refuses before the model is even called, in English or Arabic." |
| 2:05 to 2:20 | **Inventory & expiry**: expired lot now quarantined, delivery received, "Show only flagged lots" | "Inventory reflects only approved changes. The expired lot is quarantined and the short-dated delivery lot was never received." |
| 2:20 to 2:35 | **Restock draft** by supplier, download | "And the restock draft the agent prepared, from par levels. Expired stock doesn't count, and it's a draft: nothing is sent." |
| 2:35 to 2:52 | `BUILT_DURING_EVENT.md` / `git log`, then `npm test` all passing | "Everything here was built during the hackathon. No dependencies, every test offline, and it runs live on the Meta Model API or offline on synthetic fixtures." |

**Checks before upload:** under 3:00; synthetic banner visible; the provider in the header matches what the voice-over claims; no real pharmacy names; no clinical or substitution wording; key never visible.
