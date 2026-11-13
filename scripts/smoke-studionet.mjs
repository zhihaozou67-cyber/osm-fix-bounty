// End-to-end smoke test on Studionet: create a bounty, claim with a real changeset.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../web/package.json"));
const { createAccount, createClient } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const account = createAccount(fs.readFileSync(path.join(here, ".testkey"), "utf8").trim());
const { contract } = JSON.parse(fs.readFileSync(path.join(here, "deployed.json"), "utf8"));
const client = createClient({ chain: studionet, account });
const step = process.argv[2] ?? "read";

const bal = await (await fetch("https://studio.genlayer.com/api", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [account.address, "latest"] }) })).json();
console.log("balance wei", BigInt(bal.result).toString());

async function send(functionName, args, value = 0n) {
  const hash = await client.writeContract({ address: contract, functionName, args, value });
  console.log(functionName, "tx", hash);
  const r = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 80, interval: 5000 });
  console.log("  ->", r.statusName ?? r.status, r.txExecutionResultName ?? r.txExecutionResult, r.resultName ?? "");
  return r;
}
const show = async (fn, args = []) => console.log(fn, JSON.stringify(await client.readContract({ address: contract, functionName: fn, args, jsonSafeReturn: true }), null, 1));

if (step === "create") {
  const deadline = new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 19) + "Z";
  await send("create_bounty", ["Heritage tags near Evora (test)", "Add heritage=* to classified monuments.", "heritage",
    "38.5", "-7.9", "38.7", "-7.7", deadline, 2, 1], 2n * 10n ** 18n);
}
if (step === "claim") await send("claim", [0, Number(process.argv[3] ?? 191897293)]);
await show("get_rules");
await show("list_bounties");
await show("get_claims", [0]);
