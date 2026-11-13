"""Direct-mode tests: OSM API and LLM are mocked, contract logic runs for real."""

import json

CONTRACT = "contracts/osm_fix_bounty.py"
GEN = 10**18
T0 = "2026-11-14T00:00:00Z"
DEADLINE = "2026-12-14T00:00:00Z"
CS = 900001


def changeset_json(cs_id, *, wallet, bounty="0", open_=False,
                   created="2026-11-15T10:00:00Z", closed="2026-11-15T10:05:00Z",
                   lat=52.52, lon=13.40):
    return json.dumps({
        "version": "0.6",
        "changeset": {
            "id": cs_id, "created_at": created, "open": open_,
            "closed_at": None if open_ else closed,
            "min_lat": lat, "min_lon": lon, "max_lat": lat + 0.001, "max_lon": lon + 0.001,
            "user": "mapper", "uid": 1,
            "tags": {"comment": "Add wheelchair info to cafes #osmfixbounty",
                     "genlayer:bounty": bounty, "genlayer:wallet": wallet},
        },
    })


def osmchange(*elements):
    body = []
    for action, kind, eid, version, tags in elements:
        tag_xml = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
        body.append(
            f'<{action}><{kind} id="{eid}" version="{version}" changeset="{CS}" '
            f'lat="52.5205" lon="13.4005">{tag_xml}</{kind}></{action}>'
        )
    return '<?xml version="1.0"?><osmChange version="0.6">' + "".join(body) + "</osmChange>"


def element_json(kind, eid, tags, visible=True):
    return json.dumps({"elements": [{"type": kind, "id": eid, "visible": visible, "tags": tags}]})


def ok(body):
    return {"status": 200, "body": body}


def setup_bounty(vm, deploy, sponsor, *, max_claims=2, min_elements=1):
    contract = deploy(CONTRACT)
    vm.warp(T0)
    vm.sender = sponsor
    vm.value = 2 * GEN
    bounty_id = contract.create_bounty(
        "Wheelchair info for Mitte cafes",
        "Add wheelchair=yes/no/limited to cafes in this area after checking the entrance.",
        "wheelchair",
        "52.50", "13.35", "52.55", "13.45",
        DEADLINE, max_claims, min_elements,
    )
    vm.value = 0
    return contract, bounty_id


def mock_good_osm(vm, wallet, *, current_value="yes", previous_tags=None, cs=CS):
    cafe = {"amenity": "cafe", "name": "Kaffee Eins", "wheelchair": "yes"}
    vm.mock_web(rf".*/changeset/{cs}\.json$", ok(changeset_json(cs, wallet=wallet)))
    vm.mock_web(rf".*/changeset/{cs}/download$", ok(osmchange(("modify", "node", 1001, 3, cafe))))
    prev = previous_tags if previous_tags is not None else {"amenity": "cafe", "name": "Kaffee Eins"}
    vm.mock_web(r".*/node/1001/2\.json$", ok(element_json("node", 1001, prev)))
    live = dict(cafe)
    live["wheelchair"] = current_value
    vm.mock_web(r".*/node/1001\.json$", ok(element_json("node", 1001, live)))


def mock_llm(vm, verdict="SATISFIED"):
    vm.mock_llm(r".*paid mapping bounty.*",
                json.dumps({"verdict": verdict, "reason": "Cafe got a valid wheelchair value."}))


def wallet_of(addr):
    from genlayer.py.types import Address
    return Address(addr).as_hex.lower()


# ------------------------------------------------------------------ tests ---


def test_create_bounty_stores_terms(direct_vm, direct_deploy, direct_alice):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    b = contract.get_bounty(bounty_id)
    assert b["status"] == "OPEN"
    assert b["reward_per_claim"] == str(GEN)
    assert b["escrow"] == str(2 * GEN)
    assert b["bbox"] == [525000000, 133500000, 525500000, 134500000]
    assert b["opened_at"] == T0 and b["deadline"] == DEADLINE
    assert len(contract.list_bounties()) == 1


def test_create_bounty_validates_input(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    direct_vm.sender = direct_alice
    direct_vm.value = 3 * GEN + 1
    with direct_vm.expect_revert("divides evenly"):
        contract.create_bounty("t", "i", "wheelchair", "52.5", "13.3", "52.6", "13.4", DEADLINE, 2, 1)
    direct_vm.value = 3 * GEN
    with direct_vm.expect_revert("plain OSM key"):
        contract.create_bounty("t", "i", "bad key!", "52.5", "13.3", "52.6", "13.4", DEADLINE, 3, 1)
    with direct_vm.expect_revert("at most 1 degree"):
        contract.create_bounty("t", "i", "wheelchair", "50", "13.3", "52.6", "13.4", DEADLINE, 3, 1)
    with direct_vm.expect_revert("in the future"):
        contract.create_bounty("t", "i", "wheelchair", "52.5", "13.3", "52.6", "13.4", "2026-01-01T00:00:00Z", 3, 1)


def test_valid_claim_is_paid(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.warp("2026-11-16T00:00:00Z")
    direct_vm.sender = direct_bob
    mock_good_osm(direct_vm, wallet_of(direct_bob))
    mock_llm(direct_vm)

    claim_id = contract.claim(bounty_id, CS)
    claim = contract.get_claim(claim_id)
    assert claim["outcome"] == "PAID", claim
    assert claim["failed_checks"] == []
    assert claim["verdict"] == "SATISFIED"
    b = contract.get_bounty(bounty_id)
    assert b["paid_claims"] == 1
    assert b["escrow"] == str(GEN)

    # same changeset cannot be paid twice
    with direct_vm.expect_revert("already paid"):
        contract.claim(bounty_id, CS)


def test_validator_rejects_different_verdict(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.warp("2026-11-16T00:00:00Z")
    direct_vm.sender = direct_bob
    mock_good_osm(direct_vm, wallet_of(direct_bob))
    mock_llm(direct_vm)
    contract.claim(bounty_id, CS)

    assert direct_vm.run_validator() is True
    assert direct_vm.run_validator(
        leader_result={"verdict": "NOT_SATISFIED", "reason": "x"}) is False


def test_wallet_tag_must_match_claimant(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.warp("2026-11-16T00:00:00Z")
    direct_vm.sender = direct_charlie  # tries to claim Bob's work
    mock_good_osm(direct_vm, wallet_of(direct_bob))
    mock_llm(direct_vm)
    claim = contract.get_claim(contract.claim(bounty_id, CS))
    assert claim["outcome"] == "REJECTED"
    assert "wallet_tag_not_claimant" in claim["failed_checks"]
    assert contract.get_bounty(bounty_id)["paid_claims"] == 0


def test_reverted_edit_does_not_count(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.warp("2026-11-16T00:00:00Z")
    direct_vm.sender = direct_bob
    mock_good_osm(direct_vm, wallet_of(direct_bob), current_value="")  # someone removed it
    mock_llm(direct_vm)
    claim = contract.get_claim(contract.claim(bounty_id, CS))
    assert claim["outcome"] == "REJECTED"
    assert claim["failed_checks"] == ["not_enough_qualifying_edits"]


def test_untouched_value_does_not_count(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.warp("2026-11-16T00:00:00Z")
    direct_vm.sender = direct_bob
    # wheelchair=yes was already there before this changeset
    mock_good_osm(direct_vm, wallet_of(direct_bob),
                  previous_tags={"amenity": "cafe", "name": "Kaffee Eins", "wheelchair": "yes"})
    mock_llm(direct_vm)
    claim = contract.get_claim(contract.claim(bounty_id, CS))
    assert claim["failed_checks"] == ["not_enough_qualifying_edits"]


def test_area_time_and_open_changeset_rules(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.warp("2026-11-16T00:00:00Z")
    direct_vm.sender = direct_bob
    w = wallet_of(direct_bob)

    direct_vm.mock_web(r".*/changeset/700\.json$",
                       ok(changeset_json(700, wallet=w, lat=48.1, lon=11.5)))
    direct_vm.mock_web(r".*/changeset/700/download$", ok(osmchange()))
    c = contract.get_claim(contract.claim(bounty_id, 700))
    assert "outside_bounty_area" in c["failed_checks"]

    direct_vm.mock_web(r".*/changeset/701\.json$",
                       ok(changeset_json(701, wallet=w, created="2026-11-01T00:00:00Z",
                                         closed="2026-11-01T00:10:00Z")))
    direct_vm.mock_web(r".*/changeset/701/download$", ok(osmchange()))
    c = contract.get_claim(contract.claim(bounty_id, 701))
    assert "edited_before_bounty_opened" in c["failed_checks"]

    direct_vm.mock_web(r".*/changeset/702\.json$", ok(changeset_json(702, wallet=w, open_=True)))
    c = contract.get_claim(contract.claim(bounty_id, 702))
    assert "changeset_still_open" in c["failed_checks"]

    direct_vm.mock_web(r".*/changeset/703\.json$", ok(changeset_json(703, wallet=w, bounty="99")))
    direct_vm.mock_web(r".*/changeset/703/download$", ok(osmchange()))
    c = contract.get_claim(contract.claim(bounty_id, 703))
    assert "missing_bounty_tag" in c["failed_checks"]

    direct_vm.mock_web(r".*/changeset/704\.json$", {"status": 404, "body": ""})
    c = contract.get_claim(contract.claim(bounty_id, 704))
    assert c["failed_checks"] == ["changeset_not_found"]
    assert len(contract.get_claims(bounty_id)) == 5


def test_llm_can_reject(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.warp("2026-11-16T00:00:00Z")
    direct_vm.sender = direct_bob
    mock_good_osm(direct_vm, wallet_of(direct_bob))
    mock_llm(direct_vm, verdict="NOT_SATISFIED")
    claim = contract.get_claim(contract.claim(bounty_id, CS))
    assert claim["outcome"] == "REJECTED"
    assert claim["failed_checks"] == ["llm_review"]


def test_close_bounty_refunds_after_claim_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, bounty_id = setup_bounty(direct_vm, direct_deploy, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only the sponsor"):
        contract.close_bounty(bounty_id)
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-12-15T00:00:00Z")
    with direct_vm.expect_revert("mappers can still claim"):
        contract.close_bounty(bounty_id)
    direct_vm.warp("2026-12-18T00:00:00Z")
    contract.close_bounty(bounty_id)
    b = contract.get_bounty(bounty_id)
    assert b["status"] == "CLOSED" and b["escrow"] == "0"

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("bounty is closed"):
        contract.claim(bounty_id, CS)
