# Demo video script (as recorded: 2:42)

Rendered headless from the verbatim live transcripts in [docs/live-runs](docs/live-runs/) (Muse Spark Open on Baseten, `meta-models/muse-spark-open-1026`, run 2026-10-29). There were no new model calls for the video. Piper TTS voice: en_US ryan-high. A banner reads "SYNTHETIC DATA ONLY" on every frame. Pack boxes come from labelled sample fixtures, not SAM (SAM isn't offered on Baseten). The Meta Model API run is still pending.

| Time | On screen |
|---|---|
| 0:00 | Title card |
| 0:08 | Problem card |
| 0:23 | "What you are seeing" card: live on Baseten, replayed transcripts, synthetic data, fixture boxes not SAM, Meta API pending |
| 0:45 | Live agent run: shelf_audit → delivery_intake → expiry_flags → restock_draft → final answer; CS-001, CS-002 proposed |
| 1:09 | Shelf photo with fixture boxes (region 8 amber = human review) |
| 1:21 | Shelf audit output |
| 1:40 | Delivery photo |
| 1:43 | Delivery intake output (short-dated lot refused, 1 pack to review) |
| 1:56 | Expiry flags + restock draft (no model call, nothing sent) |
| 2:07 | pending → approve CS-001 --by "Demo Pharmacist" → stock updated |
| 2:18 | Clinical question refused, zero steps |
| 2:31 | End card: github.com/minasami/pharmacy-stock-agent, MIT |

## Narration
Shelf Gate. A pharmacy stock agent with a human approval gate, built for the Meta hackathon theme, Build for Your World.

I'm a pharmacist. In small pharmacies, stock counts and expiry checks are done by hand. Expired packs get missed, deliveries take time to check, and reorders are guesswork. I wanted an agent that does the checking, but never changes stock on its own.

To be clear about what you're seeing. The model is Muse Spark Open on Baseten, run live on October twenty ninth. The output here is replayed word for word from the saved transcripts. All data is synthetic. The pack boxes come from labelled sample fixtures, not SAM, because SAM is not offered on Baseten. A run on the Meta Model API is still pending.

I give the agent a goal, not a script. Morning check: audit the shelf, receive the delivery, and draft the reorder. Muse Spark Open chooses each step through tool calling. Shelf audit, then delivery intake, then expiry flags, then the restock draft, and a final answer. It has a six step limit, and none of its tools can approve anything. So it ends with two proposed change sets, and stock unchanged.

This is the synthetic shelf photo. Each box is a pack. Muse Spark Open read the name, lot and expiry from each one, live. Pack eight was hard to read, so it was not guessed.

The shelf audit flags one expired lot to pull from sale, and two near expiry lots. The unclear pack goes to a human for review. It proposes change set C S zero zero one, to quarantine the expired lot, and waits for a pharmacist. On this photo the live reads matched the ground truth exactly.

Next, the delivery carton.

Delivery intake proposes receiving two packs. A short dated lot is refused, not received. One pack went to human review instead of being received. That was a cautious miss on the live run, not a wrong entry.

Expiry flags and the restock draft are plain code, not model calls. The draft is grouped by supplier from par levels. It is only a draft. Nothing is sent.

This is the gate. The change sets wait in the pending list. Only when a named pharmacist approves C S zero zero one does the stock change, and the approval goes into the audit log.

Ask it a clinical question, like what to give instead of an antibiotic, and a deterministic guard refuses with zero steps, before the model is called. Stock only. Never clinical advice.

Shelf Gate. Zero dependencies, fifty three offline tests, MIT licensed, and on GitHub at minasami slash pharmacy stock agent. Thanks for watching.
