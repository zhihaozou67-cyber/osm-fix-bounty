import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("C:/osm-bounty/web/package.json");
const { createClient } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const c = createClient({ chain: studionet });
for (const f of process.argv.slice(2)) {
  for (let i = 0; i < 4; i++) {
    try {
      const s = await c.getContractSchemaForCode(fs.readFileSync(f, "utf8"));
      console.log("OK", f, JSON.stringify(s).slice(0, 200)); break;
    } catch (e) {
      if (/fetch failed|Timeout/.test(String(e?.details ?? e))) { await new Promise(r => setTimeout(r, 4000)); continue; }
      console.log("ERR", f, String(e?.details ?? e?.message ?? e).slice(-2500)); break;
    }
  }
}
