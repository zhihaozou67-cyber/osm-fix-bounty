"""Optional check against the real OpenStreetMap API (no mocks for web).

Run with:  OSM_LIVE=1 pytest tests/direct/test_live_osm.py -s
It replays a real, closed changeset (191897293, a heritage update in
Portugal). That changeset has no bounty tags, so the claim must be
rejected for exactly those reasons, while the area/time rules pass and the
real osmChange + element history are parsed.
"""

import json
import os
import urllib.request

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("OSM_LIVE") != "1", reason="set OSM_LIVE=1")

CONTRACT = "contracts/osm_fix_bounty.py"


def _live_web(data):
    req = urllib.request.Request(data["url"], headers={"User-Agent": "osm-fix-bounty-tests/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status, body = resp.status, resp.read()
    except urllib.error.HTTPError as err:
        status, body = err.code, err.read()
    return {"ok": {"response": {"status": status, "headers": {}, "body": body}}}


def test_real_changeset_is_parsed_and_rules_apply(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm._live_web_handler = _live_web
    direct_vm.mock_llm(r".*paid mapping bounty.*", json.dumps({"verdict": "SATISFIED", "reason": "ok"}))

    contract = direct_deploy(CONTRACT)
    direct_vm.warp("2026-11-13T00:00:00Z")
    direct_vm.sender = direct_alice
    direct_vm.value = 10**18
    bounty_id = contract.create_bounty(
        "Heritage tags near Evora", "Add heritage=* to classified monuments.", "heritage",
        "38.5", "-7.9", "38.7", "-7.7", "2026-12-01T00:00:00Z", 1, 1,
    )
    direct_vm.value = 0

    direct_vm.warp("2026-11-14T00:00:00Z")
    direct_vm.sender = direct_bob
    claim = contract.get_claim(contract.claim(bounty_id, 191897293))
    print(json.dumps(claim, indent=2))

    assert claim["outcome"] == "REJECTED"
    assert "missing_bounty_tag" in claim["failed_checks"]
    assert "wallet_tag_not_claimant" in claim["failed_checks"]
    for rule in ("outside_bounty_area", "edited_before_bounty_opened",
                 "edited_after_deadline", "changeset_still_open", "changeset_not_found"):
        assert rule not in claim["failed_checks"]
