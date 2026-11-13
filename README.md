# OSM Fix Bounty

Pay for OpenStreetMap fixes, and only for the ones that are real, in the right place, and still on the map.

A sponsor locks GEN for one kind of improvement in a small area (for example: *add `wheelchair=*` to cafés in this district*). A mapper does the work on openstreetmap.org, discloses the bounty in the changeset tags, and claims with the changeset number. Every GenLayer validator reads the public OpenStreetMap API on its own, rebuilds the same evidence record, and the contract pays the mapper only if every rule holds and validators agree that the edits do what the sponsor asked.

- **Live app:** https://osm-fix-bounty.vercel.app
- **Contract:** [`contracts/osm_fix_bounty.py`](contracts/osm_fix_bounty.py) (GenLayer Intelligent Contract, Python)
- **Frontend:** [`web/`](web) (Vite + React + genlayer-js)
- **Network:** GenLayer Studionet (chain id 61999)
- **Deployed contract:** `0x143EAd41f2fb9E00a5f06851780e092d30e21DBC` (deploy tx `0xb4fc8e15962d1ed880d7707d396c37963522fa93fd5a91f902629e7358de2f06`)

## The trust problem

Paying strangers for map edits fails in three ways today:

1. **Nobody can check cheaply.** Someone has to open each changeset, compare old and new versions, and see whether the edit is in the agreed area and time. Sponsors stop funding because review costs more than the work.
2. **Credit can be stolen.** Anyone can point at someone else's changeset and say "that was me".
3. **Edits get reverted.** A paid edit that the community rolls back a day later should not be paid.

A centralized bounty site can do the checks, but then the sponsor and the mapper both have to trust that site with the money and the judgment. Here the escrow and the judgment live in a contract, and the judgment uses only public, authoritative data that anyone can re-read.

## How a claim is decided

```
mapper calls claim(bounty_id, changeset_id)
        │
        ▼
 every validator reads the OSM API (strict equality)
   /changeset/{id}.json            open/closed, times, bbox, tags
   /changeset/{id}/download        osmChange: which elements, new tag values
   /{type}/{id}/{version-1}.json   previous value of the bounty key
   /{type}/{id}.json               current value (was it reverted?)
        │  canonical JSON evidence, byte-identical across honest validators
        ▼
 deterministic rules in contract code
   changeset closed · created after the bounty opened · closed before deadline
   changeset bbox inside the bounty area
   tag genlayer:bounty = bounty id · tag genlayer:wallet = claimant
   ≥ min_elements elements whose key value changed and is still live
        │  all pass?
        ▼
 one narrow LLM question (custom validator)
   "Do these concrete tag changes do what the sponsor asked,
    with plausible OSM values?"  → SATISFIED / NOT_SATISFIED
   validators re-ask independently; only the verdict must match
        │
        ▼
 PAID: reward sent to the claimant, changeset marked used
 REJECTED: stored with the list of failed rules
```

Design choices:

- **Facts are not left to the model.** Area, time, authorship, "did the value actually change", and "is it still live" are integer and string comparisons on API data. The LLM only judges intent ("are these `wheelchair` values on cafés what was asked for?").
- **Strict consensus on evidence.** A closed changeset is immutable, so validators must produce the same evidence JSON. A validator that sees different data disagrees instead of guessing.
- **Custom validator for the verdict.** The leader's short reason is kept for the record; validators compare only the verdict enum, so wording differences between models do not fail consensus.
- **Authorship binding.** The claim only counts if the changeset itself carries `genlayer:wallet=<claimant address>`. Only the account that uploaded the changeset could have written that tag.
- **Disclosure built in.** OSM's [Organised Editing Guidelines](https://osmfoundation.org/wiki/Organised_Editing_Guidelines) ask paid edits to be disclosed. The two required changeset tags are that disclosure, visible to every OSM user.
- **Prompt-injection guard.** Sponsor text and tag values are passed as quoted data; the prompt tells the model to ignore instructions inside them, and the verdict is clamped to two allowed values.
- **Bounded work.** At most 8 elements' histories are read per claim; areas are limited to 1° per side; deadlines to 180 days.

## Contract API

| Method | Kind | What it does |
|---|---|---|
| `create_bounty(title, instructions, tag_key, min_lat, min_lon, max_lat, max_lon, deadline, max_claims, min_elements)` | payable write | Locks the sent GEN; reward per claim = value / max_claims (must divide evenly). |
| `claim(bounty_id, changeset_id)` | write | Runs the checks above; pays or records a rejection. Returns the claim id. |
| `close_bounty(bounty_id)` | write | Sponsor only, after deadline + 3-day claim window; refunds unpaid escrow. |
| `get_bounty(id)`, `list_bounties()` | view | Bounty terms, escrow, paid count, status. |
| `get_claims(bounty_id)`, `get_claim(id)` | view | Outcome, failed rules, qualifying edits, verdict and reason. |
| `get_rules()` | view | Tag names and limits the frontend shows to mappers. |

Rejection codes: `changeset_not_found`, `changeset_still_open`, `missing_bounty_tag`, `wallet_tag_not_claimant`, `edited_before_bounty_opened`, `edited_after_deadline`, `outside_bounty_area`, `not_enough_qualifying_edits`, `llm_review`.

## For mappers

1. Open the bounty, then the area in the OSM editor (link in the app).
2. Make the edits. Before uploading, add two changeset tags (iD: *Upload* → tag editor → text view):
   ```
   genlayer:bounty=<bounty id>
   genlayer:wallet=<your wallet address, lowercase>
   ```
3. Upload, wait until the changeset closes, and paste its number into **Claim reward**.

## Run it

Contract tests (direct mode, OSM and LLM mocked):

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # or bin/pip on Linux/macOS
pytest tests/direct -q
OSM_LIVE=1 pytest tests/direct/test_live_osm.py -s   # replays a real changeset from the live OSM API
genvm-lint check contracts/osm_fix_bounty.py
```

Frontend:

```bash
cd web
npm install
VITE_CONTRACT_ADDRESS=0x... npm run dev     # or paste the address in the app
npm run build                               # static site in web/dist (deploys to Vercel/Netlify as-is)
```

Deploy the contract: open [GenLayer Studio](https://studio.genlayer.com), load `contracts/osm_fix_bounty.py`, connect a wallet on Studionet and deploy (no constructor arguments). `scripts/deploy-studionet.mjs` does the same with a throwaway test key.

## Test coverage

`tests/direct/test_osm_fix_bounty.py` covers: bounty creation and input validation, a paid claim, double-claim prevention, the custom validator rejecting a different verdict, a claim by the wrong wallet, a reverted edit, a value that was already present, area / time / open-changeset / wrong-bounty / missing-changeset rules, an LLM rejection, and sponsor refund timing. `tests/direct/test_live_osm.py` runs the evidence pipeline on a real changeset from the live API.

## Who would keep using it

- **Accessibility and local NGOs** that already run mapping parties for `wheelchair`, `toilets:wheelchair`, `tactile_paving`.
- **Humanitarian and city teams** that need one attribute completed in one district (opening hours, addresses, building levels) before a deadline.
- **OSM communities** running quality campaigns, where the bounty replaces manual reviewer time with validator consensus, while the edits stay normal, attributed OSM edits.

## Limits

- It verifies what OpenStreetMap records, not the physical world; the LLM judges plausibility, and the community's revert is the ground-truth backstop (reverted edits are not paid).
- A mapper who already uploaded without the tags cannot claim for that changeset (tags cannot be added after upload). That is deliberate: it keeps authorship provable.
- Studionet is a test network; GEN here has no monetary value.

## License

MIT
