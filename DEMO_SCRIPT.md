# Demo video script (target 2:45, hard limit 3:00)

**Setup before recording**
```bash
npm test                                     # show 14 passing in the video
AS_OF=2026-10-27 npm run web                 # http://127.0.0.1:8787, offline replay provider
```
Click **Reset demo data** in the footer. Set the browser zoom so the whole photo card fits on screen. Have `samples/shelf-01.png` ready to drag in. Use the name "Demo Pharmacist". Do not show real pharmacy names, real people or real products on screen.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00 to 0:15 | Title card, then `BUILT_DURING_EVENT.md` and `git log` (ET dates) | "Pharmacy Stock Agent. Everything you'll see was built during the Meta hackathon, after the Oct 26 kickoff. Here is the commit log." |
| 0:15 to 0:30 | Header and synthetic-data banner | "Pharmacies lose money and time to expired stock and manual counts. Our agent turns a phone photo into stock updates, but only for stock. It never gives clinical or substitution advice, and a pharmacist approves every change. All data here is synthetic." |
| 0:30 to 1:05 | **Scan photo**: drag in `shelf-01.png`. Boxes appear. Hover a box | "SAM 3.1 finds every pack on the shelf. Muse Spark reads each region's name, strength, lot and expiry into a strict JSON schema. Green is fine, orange is near expiry, red is expired. Purple dashed means the agent isn't sure, so it doesn't guess." |
| 1:05 to 1:20 | Shelf audit panel: pull list, near expiry, proposed CS-001 | "It found an expired Omeprazole lot and proposed a quarantine. Nothing has changed yet." |
| 1:20 to 1:50 | **Review queue**: RV-001 crop, reasons. Type the name, pick the item from the catalog, type the lot and expiry, then **Record as identified** | "This pack's name and lot were unreadable. The pharmacist reads the pack and records what is printed. Nothing is pre-selected, and the agent never suggests a different product. Their name goes in the log." |
| 1:50 to 2:10 | **Approvals**: CS-001, then **Approve as Demo Pharmacist**. Audit log appears | "Approval needs a named pharmacist. Without a name, the button stays disabled and the server refuses. Every decision goes in the audit log." |
| 2:10 to 2:30 | **Inventory & expiry**: the expired lot now shows 0 sellable and 2 quarantined. Tick "Show only flagged lots". Type "Can I swap Ibuprofen for Paracetamol?" and press Ask | "The inventory updates and flags every expiring lot. Clinical or substitution questions are refused by a deterministic guard, in English and Arabic." |
| 2:30 to 2:45 | **Restock draft**: grouped by supplier | "Finally, a restock draft per supplier from par levels. Expired stock doesn't count. It's a draft, and nothing is sent." |
| 2:45 to 2:55 | Terminal: `npm test` showing 14 passing, and the footer showing the provider | "No dependencies, 14 tests, and it runs offline on replayed synthetic results or live on the Meta Model API. Thanks!" |

**Checks before upload:** the runtime is under 3:00, the synthetic banner is visible, no real pharmacy names appear, and no clinical or substitution wording appears anywhere.

**If recording live mode:** set `MODEL_PROVIDER=meta` and `MODEL_API_KEY` in your shell, and keep the key off screen. Before claiming live results in the video, check that the live SAM response envelope matches the parser.
