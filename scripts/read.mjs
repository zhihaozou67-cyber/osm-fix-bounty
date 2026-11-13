import { createRequire } from "node:module";
const require = createRequire("C:/osm-bounty/web/package.json");
const { createClient } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");
const c = createClient({ chain: studionet });
const [fn, ...args] = process.argv.slice(2);
for (let i = 0; i < 4; i++) {
  try {
    const r = await c.readContract({ address: "0x143EAd41f2fb9E00a5f06851780e092d30e21DBC", functionName: fn, args: args.map(Number), jsonSafeReturn: true });
    console.log(JSON.stringify(r, null, 1)); break;
  } catch (e) { await new Promise(r => setTimeout(r, 4000)); }
}
