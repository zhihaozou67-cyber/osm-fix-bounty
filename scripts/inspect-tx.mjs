import { createRequire } from "node:module";
const require = createRequire("C:/osm-bounty/web/package.json");
const { createClient } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const c = createClient({ chain: studionet });
for (let i = 0; i < 4; i++) {
  try {
    const tx = await c.getTransaction({ hash: process.argv[2] });
    const pick = { status: tx.status, statusName: tx.statusName, result: tx.result, resultName: tx.resultName,
      exec: tx.txExecutionResult, execName: tx.txExecutionResultName, to: tx.to_address ?? tx.recipient };
    console.log(JSON.stringify(pick, (k, v) => typeof v === "bigint" ? v.toString() : v));
    const lr = tx.consensus_data?.leader_receipt ?? tx.consensusData?.leaderReceipt;
    const r = Array.isArray(lr) ? lr[0] : lr;
    if (r) console.log("leader:", JSON.stringify({ execution_result: r.execution_result, error: r.error, result: r.result }).slice(0, 1500));
    else console.log("keys:", Object.keys(tx).join(","));
    break;
  } catch (e) { await new Promise(r => setTimeout(r, 4000)); }
}
