import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CHAIN_ID = 61999;
const CHAIN_ID_HEX = "0xf22f";
const RPC_URL = "https://studio.genlayer.com/api";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export type Address = `0x${string}`;

export function getProvider(): Eip1193 | null {
  return typeof window !== "undefined" && window.ethereum ? window.ethereum : null;
}

/** Ask the wallet for an account and make sure it is on GenLayer Studionet. */
export async function connectWallet(): Promise<Address> {
  const provider = getProvider();
  if (!provider) throw new Error("No browser wallet found. Install or unlock a wallet extension.");
  const accounts: string[] = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("The wallet returned no account.");
  await ensureNetwork(provider);
  return accounts[0] as Address;
}

export async function currentAccount(): Promise<Address | null> {
  const provider = getProvider();
  if (!provider) return null;
  const accounts: string[] = await provider.request({ method: "eth_accounts" });
  return (accounts?.[0] as Address) ?? null;
}

async function ensureNetwork(provider: Eip1193) {
  const chainId: string = await provider.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) === CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (err: any) {
    if (err?.code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: "GenLayer Studio",
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
        },
      ],
    });
  }
}

const readClient = createClient({ chain: studionet });

function writeClient(account: Address) {
  return createClient({ chain: studionet, account });
}

/** genlayer-js returns Maps and bigints; turn them into plain JSON values. */
function plain(value: unknown): any {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) out[String(k)] = plain(v);
    return out;
  }
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

export async function read<T>(contract: Address, functionName: string, args: any[] = []): Promise<T> {
  const result = await readClient.readContract({ address: contract, functionName, args });
  return plain(result) as T;
}

export async function write(
  account: Address,
  contract: Address,
  functionName: string,
  args: any[],
  value: bigint = 0n,
): Promise<`0x${string}`> {
  const client = writeClient(account);
  return (await client.writeContract({ address: contract, functionName, args, value })) as `0x${string}`;
}

export type TxProgress = {
  status: string;
  execution?: string;
};

const DONE = new Set(["ACCEPTED", "FINALIZED"]);
const FAILED = new Set(["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);

/**
 * Follow a transaction until validators accept it. Calls onProgress on every
 * status change so the UI can show the consensus steps.
 */
export async function followTransaction(
  hash: `0x${string}`,
  onProgress: (p: TxProgress) => void,
  { intervalMs = 3000, timeoutMs = 6 * 60_000 } = {},
): Promise<TxProgress> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const tx = await readClient.getTransaction({ hash: hash as any });
      const status = String(tx.statusName ?? tx.status ?? "PENDING");
      const execution = tx.txExecutionResultName ? String(tx.txExecutionResultName) : undefined;
      if (status !== last) {
        last = status;
        onProgress({ status, execution });
      }
      if (DONE.has(status) || FAILED.has(status)) return { status, execution };
    } catch {
      // the node may not know the hash for a moment right after submission
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for validators. The transaction may still finish; refresh later.");
}

export function parseGen(text: string): bigint {
  const clean = text.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(clean)) throw new Error("Enter an amount like 10 or 2.5");
  const [whole, frac = ""] = clean.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export function formatGen(wei: string | number | bigint): string {
  const v = BigInt(wei);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
