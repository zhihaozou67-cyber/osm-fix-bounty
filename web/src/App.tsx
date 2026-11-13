import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectWallet,
  currentAccount,
  followTransaction,
  formatGen,
  getProvider,
  parseGen,
  read,
  short,
  write,
  type Address,
  type TxProgress,
} from "./lib/genlayer";

type Bounty = {
  id: number;
  sponsor: string;
  title: string;
  instructions: string;
  tag_key: string;
  bbox: [number, number, number, number];
  opened_at: string;
  deadline: string;
  reward_per_claim: string;
  max_claims: number;
  paid_claims: number;
  min_elements: number;
  escrow: string;
  status: string;
};

type Claim = {
  id: number;
  bounty_id: number;
  claimant: string;
  changeset_id: number;
  outcome: string;
  failed_checks: string[];
  qualifying: number;
  verdict: string;
  reason: string;
  submitted_at: string;
};

const SCALE = 10_000_000;
const CLAIM_WINDOW_DAYS = 3;

const CHECK_LABELS: Record<string, string> = {
  changeset_not_found: "Changeset not found on OpenStreetMap",
  changeset_still_open: "Changeset is still open (close it in the editor, then claim)",
  missing_bounty_tag: "Changeset tag genlayer:bounty is missing or names another bounty",
  wallet_tag_not_claimant: "Changeset tag genlayer:wallet is not your wallet",
  edited_before_bounty_opened: "Edits were made before the bounty opened",
  edited_after_deadline: "Edits were made after the deadline",
  outside_bounty_area: "Edits are outside the bounty area",
  not_enough_qualifying_edits: "Not enough edits that changed the key and are still live",
  llm_review: "Validators judged that the edits do not do what the sponsor asked",
};

const ENV_CONTRACT = (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined) ?? "";

function deg(v: number) {
  return (v / SCALE).toFixed(5);
}

function mapEmbed(b: Bounty["bbox"]) {
  const [s, w, n, e] = b.map((v) => v / SCALE);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${w},${s},${e},${n}&layer=mapnik`;
}

function editorLink(b: Bounty["bbox"]) {
  const lat = (b[0] + b[2]) / 2 / SCALE;
  const lon = (b[1] + b[3]) / 2 / SCALE;
  return `https://www.openstreetmap.org/edit?editor=id#map=17/${lat.toFixed(5)}/${lon.toFixed(5)}`;
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type TxState = {
  label: string;
  phase: "sign" | "pending" | "done" | "error";
  hash?: string;
  status?: string;
  message?: string;
};

const STEPS = ["PENDING", "PROPOSING", "COMMITTING", "REVEALING", "ACCEPTED"];

export default function App() {
  const [contract, setContract] = useState<string>(
    () => ENV_CONTRACT || localStorage.getItem("osmBountyContract") || "",
  );
  const [account, setAccount] = useState<Address | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [tx, setTx] = useState<TxState | null>(null);
  const [view, setView] = useState<"browse" | "create">("browse");

  const validContract = /^0x[0-9a-fA-F]{40}$/.test(contract);

  const refresh = useCallback(async () => {
    if (!validContract) return;
    setLoading(true);
    setLoadError("");
    try {
      const list = await read<Bounty[]>(contract as Address, "list_bounties");
      setBounties([...list].sort((a, b) => b.id - a.id));
    } catch (err: any) {
      setLoadError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [contract, validContract]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    currentAccount().then(setAccount).catch(() => undefined);
    const p = getProvider();
    const onAccounts = (accs: string[]) => setAccount((accs?.[0] as Address) ?? null);
    p?.on?.("accountsChanged", onAccounts);
    return () => p?.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const runTx = useCallback(
    async (label: string, fn: (acc: Address) => Promise<`0x${string}`>): Promise<boolean> => {
      try {
        const acc = account ?? (await connectWallet());
        setAccount(acc);
        setTx({ label, phase: "sign" });
        const hash = await fn(acc);
        setTx({ label, phase: "pending", hash, status: "PENDING" });
        const result = await followTransaction(hash, (p: TxProgress) =>
          setTx((t) => (t ? { ...t, status: p.status } : t)),
        );
        if (result.status !== "ACCEPTED" && result.status !== "FINALIZED") {
          setTx({ label, phase: "error", hash, status: result.status, message: `Consensus ended as ${result.status}.` });
          return false;
        }
        if (result.execution === "FINISHED_WITH_ERROR") {
          setTx({
            label,
            phase: "error",
            hash,
            status: result.status,
            message: "The contract rejected the call (see the reason in GenLayer Studio's transaction log).",
          });
          return false;
        }
        setTx({ label, phase: "done", hash, status: result.status });
        await refresh();
        return true;
      } catch (err: any) {
        const rejected = err?.code === 4001 || /reject|denied/i.test(err?.message ?? "");
        setTx({ label, phase: "error", message: rejected ? "You rejected the request in your wallet." : err?.message ?? String(err) });
        return false;
      }
    },
    [account, refresh],
  );

  const selectedBounty = useMemo(() => bounties.find((b) => b.id === selected) ?? null, [bounties, selected]);

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◎
          </span>
          <div>
            <strong>OSM Fix Bounty</strong>
            <small>Paid OpenStreetMap fixes, verified by GenLayer validators</small>
          </div>
        </div>
        <div className="top-actions">
          <span className="chip">GenLayer Studionet</span>
          {account ? (
            <span className="chip strong" title={account}>
              {short(account)}
            </span>
          ) : (
            <button className="btn" onClick={() => connectWallet().then(setAccount).catch((e) => alert(e.message))}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <h1>Fund the map fixes your area needs. Pay only for edits that stay.</h1>
        <ol className="how">
          <li>
            <b>Sponsor</b> locks GEN for a kind of fix (one OSM key) inside a small area.
          </li>
          <li>
            <b>Mapper</b> edits on openstreetmap.org and tags the changeset with the bounty and their wallet.
          </li>
          <li>
            <b>Validators</b> each read the OSM API, check area, time, authorship and that the change is still live,
            then agree whether it does what was asked. The reward is paid automatically.
          </li>
        </ol>
      </section>

      {!ENV_CONTRACT && (
        <section className="panel contract-box">
          <label>
            Contract address
            <input
              value={contract}
              placeholder="0x… (deployed OsmFixBounty on Studionet)"
              onChange={(e) => {
                setContract(e.target.value.trim());
                localStorage.setItem("osmBountyContract", e.target.value.trim());
              }}
            />
          </label>
        </section>
      )}

      <nav className="tabs">
        <button className={view === "browse" ? "active" : ""} onClick={() => setView("browse")}>
          Bounties
        </button>
        <button className={view === "create" ? "active" : ""} onClick={() => setView("create")}>
          Fund a bounty
        </button>
        <button className="ghost" onClick={refresh} disabled={!validContract || loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </nav>

      {!validContract && <p className="muted">Enter the contract address to load bounties.</p>}
      {loadError && <p className="error">Could not read the contract: {loadError}</p>}

      {view === "create" ? (
        <CreateBounty
          disabled={!validContract}
          onSubmit={(args, value) =>
            runTx("Fund bounty", (acc) => write(acc, contract as Address, "create_bounty", args, value)).then((ok) => {
              if (ok) setView("browse");
              return ok;
            })
          }
        />
      ) : selectedBounty ? (
        <BountyDetail
          bounty={selectedBounty}
          contract={contract as Address}
          account={account}
          onBack={() => setSelected(null)}
          onClaim={(changeset) =>
            runTx(`Claim with changeset ${changeset}`, (acc) =>
              write(acc, contract as Address, "claim", [selectedBounty.id, changeset]),
            )
          }
          onClose={() =>
            runTx("Close bounty and refund", (acc) => write(acc, contract as Address, "close_bounty", [selectedBounty.id]))
          }
        />
      ) : (
        <div className="grid">
          {bounties.map((b) => (
            <article key={b.id} className="card" onClick={() => setSelected(b.id)}>
              <iframe className="map" src={mapEmbed(b.bbox)} title={`Area of bounty ${b.id}`} loading="lazy" />
              <div className="card-body">
                <div className="row">
                  <span className={`status ${b.status.toLowerCase()}`}>{b.status}</span>
                  <span className="key">{b.tag_key}=*</span>
                </div>
                <h3>{b.title}</h3>
                <p className="reward">
                  {formatGen(b.reward_per_claim)} GEN <small>per accepted fix</small>
                </p>
                <p className="muted">
                  {b.paid_claims}/{b.max_claims} paid · edits until {when(b.deadline)}
                </p>
              </div>
            </article>
          ))}
          {validContract && !loading && !bounties.length && !loadError && (
            <p className="muted">No bounties yet. Fund the first one.</p>
          )}
        </div>
      )}

      {tx && <TxPanel tx={tx} onDismiss={() => setTx(null)} />}

      <footer className="foot">
        Map data © OpenStreetMap contributors. Edits paid through this app must follow the{" "}
        <a href="https://osmfoundation.org/wiki/Organised_Editing_Guidelines" target="_blank" rel="noreferrer">
          Organised Editing Guidelines
        </a>
        ; the required changeset tags are the public disclosure.
      </footer>
    </div>
  );
}

function BountyDetail(props: {
  bounty: Bounty;
  contract: Address;
  account: Address | null;
  onBack: () => void;
  onClaim: (changeset: number) => Promise<boolean>;
  onClose: () => Promise<boolean>;
}) {
  const { bounty: b, contract, account } = props;
  const [claims, setClaims] = useState<Claim[]>([]);
  const [changeset, setChangeset] = useState("");
  const [busy, setBusy] = useState(false);

  const loadClaims = useCallback(() => {
    read<Claim[]>(contract, "get_claims", [b.id])
      .then((c) => setClaims([...c].sort((x, y) => y.id - x.id)))
      .catch(() => setClaims([]));
  }, [contract, b.id]);

  useEffect(() => {
    loadClaims();
  }, [loadClaims, b.paid_claims]);

  const claimEnd = new Date(new Date(b.deadline).getTime() + CLAIM_WINDOW_DAYS * 86400_000);
  const isSponsor = account && account.toLowerCase() === b.sponsor.toLowerCase();
  const wallet = account?.toLowerCase() ?? "<connect your wallet>";
  const tagText = `genlayer:bounty=${b.id}\ngenlayer:wallet=${wallet}`;

  return (
    <section className="detail">
      <button className="ghost back" onClick={props.onBack}>
        ← All bounties
      </button>
      <div className="detail-grid">
        <div>
          <iframe className="map big" src={mapEmbed(b.bbox)} title="Bounty area" />
          <p className="muted small">
            Area: {deg(b.bbox[0])}, {deg(b.bbox[1])} → {deg(b.bbox[2])}, {deg(b.bbox[3])}
          </p>
        </div>
        <div className="panel">
          <div className="row">
            <span className={`status ${b.status.toLowerCase()}`}>{b.status}</span>
            <span className="key">{b.tag_key}=*</span>
          </div>
          <h2>{b.title}</h2>
          <p className="instructions">{b.instructions}</p>
          <dl className="facts">
            <dt>Reward</dt>
            <dd>{formatGen(b.reward_per_claim)} GEN per accepted changeset</dd>
            <dt>Paid</dt>
            <dd>
              {b.paid_claims} of {b.max_claims} · {formatGen(b.escrow)} GEN left in escrow
            </dd>
            <dt>Each claim needs</dt>
            <dd>
              at least {b.min_elements} element(s) whose <code>{b.tag_key}</code> value you changed
            </dd>
            <dt>Edit window</dt>
            <dd>
              {when(b.opened_at)} → {when(b.deadline)}
            </dd>
            <dt>Claims accepted until</dt>
            <dd>{when(claimEnd.toISOString())}</dd>
            <dt>Sponsor</dt>
            <dd title={b.sponsor}>{short(b.sponsor)}</dd>
          </dl>
        </div>
      </div>

      {b.status === "OPEN" && (
        <div className="panel steps">
          <h3>Claim this bounty</h3>
          <ol>
            <li>
              <a href={editorLink(b.bbox)} target="_blank" rel="noreferrer">
                Open the area in the OSM editor
              </a>{" "}
              and make the edits described above.
            </li>
            <li>
              Before you press <i>Upload</i>, open the changeset tag editor (text view) and add these two tags. They
              link the edit to this bounty and to the wallet that gets paid:
              <pre className="tags">{tagText}</pre>
              <button className="ghost" onClick={() => navigator.clipboard.writeText(tagText)} disabled={!account}>
                Copy tags
              </button>
            </li>
            <li>Upload, wait a minute for the changeset to close, then paste its number here:</li>
          </ol>
          <form
            className="claim-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const id = Number(changeset);
              if (!Number.isInteger(id) || id <= 0) return;
              setBusy(true);
              if (await props.onClaim(id)) {
                setChangeset("");
                loadClaims();
              }
              setBusy(false);
            }}
          >
            <input
              inputMode="numeric"
              placeholder="Changeset number, e.g. 191897293"
              value={changeset}
              onChange={(e) => setChangeset(e.target.value.replace(/\D/g, ""))}
            />
            <button className="btn" disabled={busy || !changeset}>
              {busy ? "Validators are checking…" : "Claim reward"}
            </button>
          </form>
          <p className="muted small">
            Each validator reads openstreetmap.org independently; this usually takes one to three minutes.
          </p>
        </div>
      )}

      {isSponsor && b.status === "OPEN" && (
        <div className="panel">
          <h3>Sponsor</h3>
          <p className="muted">
            After {when(claimEnd.toISOString())} you can close the bounty and get the unpaid escrow back.
          </p>
          <button className="ghost" disabled={Date.now() < claimEnd.getTime()} onClick={props.onClose}>
            Close and refund
          </button>
        </div>
      )}

      <div className="panel">
        <h3>Claims ({claims.length})</h3>
        {!claims.length && <p className="muted">No claims yet.</p>}
        <ul className="claims">
          {claims.map((c) => (
            <li key={c.id} className={c.outcome.toLowerCase()}>
              <div className="row">
                <span className={`status ${c.outcome.toLowerCase()}`}>{c.outcome}</span>
                <a href={`https://www.openstreetmap.org/changeset/${c.changeset_id}`} target="_blank" rel="noreferrer">
                  changeset {c.changeset_id}
                </a>
                <span className="muted small">
                  by {short(c.claimant)} · {when(c.submitted_at)}
                </span>
              </div>
              <p className="small">
                {c.qualifying} qualifying edit(s){c.verdict ? ` · validators: ${c.verdict}` : ""}
                {c.reason ? ` — “${c.reason}”` : ""}
              </p>
              {!!c.failed_checks.length && (
                <ul className="fails">
                  {c.failed_checks.map((f) => (
                    <li key={f}>{CHECK_LABELS[f] ?? f}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CreateBounty(props: { disabled: boolean; onSubmit: (args: any[], value: bigint) => Promise<boolean> }) {
  const inThirty = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    title: "Wheelchair info for cafés",
    instructions:
      "Add wheelchair=yes, limited or no to cafés in this area after checking the entrance in person or on street-level imagery.",
    tag_key: "wheelchair",
    min_lat: "52.515",
    min_lon: "13.395",
    max_lat: "52.525",
    max_lon: "13.415",
    deadline: inThirty,
    max_claims: "5",
    min_elements: "1",
    total: "10",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  const preview = useMemo(() => {
    const nums = [f.min_lat, f.min_lon, f.max_lat, f.max_lon].map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null;
    return mapEmbed(nums.map((n) => Math.round(n * SCALE)) as Bounty["bbox"]);
  }, [f.min_lat, f.min_lon, f.max_lat, f.max_lon]);

  let perFix = "";
  try {
    const total = parseGen(f.total);
    const n = BigInt(Math.max(1, Number(f.max_claims) || 1));
    perFix = total % n === 0n ? formatGen(total / n) : "";
  } catch {
    perFix = "";
  }

  return (
    <form
      className="panel create"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const value = parseGen(f.total);
          const maxClaims = Number(f.max_claims);
          if (value % BigInt(maxClaims) !== 0n) throw new Error("The total must split evenly between the fixes.");
          const deadline = `${f.deadline}T23:59:59Z`;
          await props.onSubmit(
            [
              f.title,
              f.instructions,
              f.tag_key.trim(),
              f.min_lat,
              f.min_lon,
              f.max_lat,
              f.max_lon,
              deadline,
              maxClaims,
              Number(f.min_elements),
            ],
            value,
          );
        } catch (err: any) {
          setError(err.message);
        }
      }}
    >
      <h2>Fund a bounty</h2>
      <div className="create-grid">
        <div className="fields">
          <label>
            Title
            <input value={f.title} onChange={set("title")} maxLength={120} required />
          </label>
          <label>
            What should mappers do?
            <textarea value={f.instructions} onChange={set("instructions")} maxLength={1500} rows={4} required />
          </label>
          <label>
            OSM key that must change
            <input value={f.tag_key} onChange={set("tag_key")} placeholder="wheelchair" required />
          </label>
          <div className="pair">
            <label>
              South (min lat)
              <input value={f.min_lat} onChange={set("min_lat")} required />
            </label>
            <label>
              West (min lon)
              <input value={f.min_lon} onChange={set("min_lon")} required />
            </label>
            <label>
              North (max lat)
              <input value={f.max_lat} onChange={set("max_lat")} required />
            </label>
            <label>
              East (max lon)
              <input value={f.max_lon} onChange={set("max_lon")} required />
            </label>
          </div>
          <div className="pair">
            <label>
              Edits accepted until
              <input type="date" value={f.deadline} onChange={set("deadline")} required />
            </label>
            <label>
              Number of fixes to pay
              <input type="number" min={1} max={100} value={f.max_claims} onChange={set("max_claims")} required />
            </label>
            <label>
              Elements per claim
              <input type="number" min={1} max={8} value={f.min_elements} onChange={set("min_elements")} required />
            </label>
            <label>
              Total reward (GEN)
              <input value={f.total} onChange={set("total")} required />
            </label>
          </div>
          <p className="muted small">
            {perFix ? `${perFix} GEN per accepted changeset.` : "The total must split evenly between the fixes."} Unpaid
            escrow can be refunded {CLAIM_WINDOW_DAYS} days after the deadline.
          </p>
        </div>
        <div>{preview && <iframe className="map big" src={preview} title="Preview of the area" />}</div>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={props.disabled}>
        Lock GEN and publish
      </button>
    </form>
  );
}

function TxPanel({ tx, onDismiss }: { tx: TxState; onDismiss: () => void }) {
  const reached = tx.status ? STEPS.indexOf(tx.status === "FINALIZED" ? "ACCEPTED" : tx.status) : -1;
  return (
    <aside className={`tx ${tx.phase}`} role="status">
      <div className="row">
        <strong>{tx.label}</strong>
        {(tx.phase === "done" || tx.phase === "error") && (
          <button className="ghost x" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        )}
      </div>
      {tx.phase === "sign" && <p>Confirm the transaction in your wallet…</p>}
      {tx.hash && (
        <ol className="tx-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < reached || tx.phase === "done" ? "ok" : i === reached ? "now" : ""}>
              {s.toLowerCase()}
            </li>
          ))}
        </ol>
      )}
      {tx.hash && <p className="small mono">tx {short(tx.hash)}</p>}
      {tx.phase === "done" && <p>Accepted by validators. Data refreshed.</p>}
      {tx.phase === "error" && <p className="error">{tx.message}</p>}
    </aside>
  );
}
