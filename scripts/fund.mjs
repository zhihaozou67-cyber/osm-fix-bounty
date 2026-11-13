// Fund the throwaway test key on Studionet (Studio's faucet RPC, test GEN only).
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("C:/osm-bounty/web/package.json");
const { createAccount } = require("genlayer-js");
const account = createAccount(fs.readFileSync("C:/osm-bounty/scripts/.testkey", "utf8").trim());
const body = `{"jsonrpc":"2.0","id":1,"method":"sim_fundAccount","params":["${account.address}",${process.argv[2] ?? "100000000000000000000"}]}`;
const r = await fetch("https://studio.genlayer.com/api", { method: "POST", headers: { "content-type": "application/json" }, body });
console.log(await r.text());
