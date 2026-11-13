# Portal submission text (Projects)

Copy the parts below into the GenLayer Portal "Submit contribution → Projects" form.
All links are filled in.

---

**Title:** OSM Fix Bounty: paid OpenStreetMap fixes, verified from the OSM API

**Description:**

OSM Fix Bounty lets anyone fund a specific OpenStreetMap improvement in a small area, for example "add wheelchair=* to cafés in this district", and pays mappers only for edits that are real, in the right place, made by them, and still on the map.

The trust problem: paying strangers for map edits needs someone to review every changeset (area, time, before/after values), credit can be claimed for someone else's changeset, and edits can be reverted after payment. A central bounty site would have to be trusted with both the money and the judgment.

How GenLayer is used: the sponsor's GEN is held in the Intelligent Contract. On `claim(bounty_id, changeset_id)` every validator reads the public OpenStreetMap API itself (changeset metadata, the osmChange download, each touched element's previous and current version) and rebuilds a canonical evidence record under strict equality. Deterministic code then checks: changeset closed; created after the bounty opened and closed before the deadline; changeset bbox inside the bounty area; changeset tags `genlayer:bounty=<id>` and `genlayer:wallet=<claimant>` (binds authorship, and doubles as the paid-edit disclosure the OSM Organised Editing Guidelines ask for); at least N elements whose bounty key actually changed and is still live (reverted edits do not count). Only if all of that holds, validators answer one narrow question with a custom validator that compares just the verdict enum: do these concrete tag changes do what the sponsor asked, with plausible values? The contract then pays the claimant automatically or stores the rejection with the exact failed rules. Unpaid escrow returns to the sponsor after the deadline plus a 3-day claim window.

How to use: open the app, connect a wallet on Studionet. Sponsors use "Fund a bounty" (title, instructions, OSM key, area, deadline, number of fixes, total GEN). Mappers open a bounty, follow the editor link, add the two changeset tags shown in the app before uploading, then paste the changeset number into "Claim reward" and watch the transaction go through consensus.

Testing: 10 direct-mode tests (paid claim, double claim, validator disagreement, wrong wallet, reverted edit, unchanged value, area/time/open/wrong-bounty/missing changeset, LLM rejection, refund timing) plus a live test that replays a real changeset from the OSM API. Live on Studionet: OSM changeset 191903285 (added name:zh to Maison de Victor Hugo, copied from Wikidata) was claimed against bounty 0; validators reached consensus, every rule passed, the verdict was SATISFIED and 1 GEN was paid automatically (shown in the demo video).

Sustained use: accessibility groups and local NGOs that already organise wheelchair/toilets/tactile_paving mapping, city or humanitarian teams that need one attribute completed in one district by a date, and OSM quality campaigns that want to replace manual review time.

**Links:**
- Repository: https://github.com/zhihaozou67-cyber/osm-fix-bounty
- Live app: https://osm-fix-bounty.vercel.app
- Demo video: https://github.com/zhihaozou67-cyber/osm-fix-bounty/blob/main/docs/demo.mp4
- Contract (Studionet): 0x143EAd41f2fb9E00a5f06851780e092d30e21DBC
- Deploy transaction: 0xb4fc8e15962d1ed880d7707d396c37963522fa93fd5a91f902629e7358de2f06
