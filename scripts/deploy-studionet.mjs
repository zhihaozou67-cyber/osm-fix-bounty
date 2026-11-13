// Deploy OsmFixBounty to GenLayer Studionet with a throwaway test key.
// Usage: node scripts/deploy-studionet.mjs   (key kept in scripts/.testkey, git-ignored)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../web/package.json"));
const { createAccount, createClient, generatePrivateKey } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const keyFile = path.join(here, ".testkey");
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, generatePrivateKey());
const account = createAccount(fs.readFileSync(keyFile, "utf8").trim());
console.log("test account", account.address);

const rpc = async (method, params) => {
  const r = await fetch("https://studio.genlayer.com/api", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return r.json();
};
console.log("fund", JSON.stringify(await rpc("sim_fundAccount", [account.address, "0x" + (10n ** 21n).toString(16)])));

const client = createClient({ chain: studionet, account });
const code = fs.readFileSync(path.join(here, "../contracts/osm_fix_bounty.py"), "utf8");
const hash = await client.deployContract({ code, args: [] });
console.log("deploy tx", hash);
const receipt = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 60, interval: 5000 });
const addr = receipt?.data?.contract_address ?? receipt?.txDataDecoded?.contractAddress ?? receipt?.recipient ?? receipt?.to_address;
console.log("status", receipt.statusName, receipt.txExecutionResultName, "contract", addr);
fs.writeFileSync(path.join(here, "deployed.json"), JSON.stringify({ contract: addr, deployTx: hash, deployer: account.address }, null, 2));
