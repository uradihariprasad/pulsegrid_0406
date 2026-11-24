/**
 * Universe discovery from the official Upstox instrument master
 * (NSE.json.gz / BSE.json.gz). Nothing is bundled, nothing is constructed:
 * spot keys, futures keys, expiries, lots and strikes all come from the file.
 *
 * Front-contract rule: for every underlying choose the EARLIEST expiry that is
 * on/after today's Asia/Kolkata date. Expired contracts are ignored regardless
 * of their position in the file, and ordering never depends on file order.
 */
import { fetchInstrumentMaster, type MasterDiagnostics, type MasterRow, type ApiFailure } from "./upstox";
import { istDateStr } from "./math";

export interface ContractSeed {
  symbol: string;
  name: string;
  sector: string;
  kind: "equity" | "index";
  lot: number;
  strikeStep: number;
  isin: string | null;
  spotKey: string;
  futKey: string | null;
  expiry: string | null;
  exchange: string;
  /** true when the seed carries a usable futures contract */
  hasFutures: boolean;
}

export interface UniverseDiagnostics extends MasterDiagnostics {
  eligibleUnderlyings: number;
  indexKeys: { nifty: string | null; sensex: string | null; banknifty: string | null };
  expiredIgnored: number;
  noFutures: number;
  noStrikes: number;
}

export interface UniverseResult {
  seeds: ContractSeed[];
  ok: boolean;
  errors: string[];
  failures: ApiFailure[];
  diag: UniverseDiagnostics;
}

interface Agg {
  spotKey: string;
  symbol: string;
  name: string;
  kind: "equity" | "index";
  isin: string | null;
  exchange: string;
  lot: number;
  futKey: string | null;
  expiry: string | null;
  strikes: Set<number>;
}

const isIndexKey = (k: string) => k.startsWith("NSE_INDEX|") || k.startsWith("BSE_INDEX|");

function strikeStepOf(strikes: Set<number>, kind: "equity" | "index"): number {
  const uniq = Array.from(strikes).sort((a, b) => a - b);
  if (uniq.length < 2) return kind === "index" ? 50 : 10;
  const steps = uniq.slice(1).map((s, i) => s - uniq[i]).filter((d) => d > 0);
  if (!steps.length) return kind === "index" ? 50 : 10;
  // most common positive step (ties → smallest)
  const counts = new Map<number, number>();
  for (const d of steps) counts.set(d, (counts.get(d) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

export async function discoverUniverse(): Promise<UniverseResult> {
  const errors: string[] = [];
  let rows: MasterRow[] = [];
  let masterDiag: MasterDiagnostics | null = null;

  try {
    const res = await fetchInstrumentMaster();
    rows = res.rows;
    masterDiag = res.diag;
    for (const f of res.diag.failures) errors.push(`${f.endpoint} → ${f.code}: ${f.message}`);
  } catch (e) {
    errors.push(`instrument master download failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!rows.length || !masterDiag) {
    return {
      seeds: [],
      ok: false,
      errors: [
        ...errors,
        "The official Upstox instrument master (NSE.json.gz / BSE.json.gz) could not be downloaded or parsed, so the eligible universe is unknown. Nothing is substituted.",
      ],
      failures: masterDiag?.failures ?? [],
      diag: emptyDiag(masterDiag),
    };
  }

  const today = istDateStr();
  const fo = rows.filter((r) => r.segment === "NSE_FO" || r.segment === "BSE_FO");
  const futures = fo.filter((r) => r.instrumentType.startsWith("FUT") && r.underlyingKey && r.expiry);
  const options = fo.filter((r) => (r.instrumentType === "CE" || r.instrumentType === "PE") && r.underlyingKey && r.expiry);

  const expiredIgnored = futures.filter((r) => (r.expiry as string) < today).length;
  const validFutures = futures.filter((r) => (r.expiry as string) >= today);

  const agg = new Map<string, Agg>();
  const ensure = (r: MasterRow): Agg | null => {
    const spotKey = r.underlyingKey;
    if (!spotKey) return null;
    const symbol = r.underlyingSymbol ?? spotKey.split("|")[1] ?? r.symbol;
    const existing = agg.get(spotKey);
    if (existing) return existing;
    const a: Agg = {
      spotKey,
      symbol,
      name: r.name && r.name !== symbol ? r.name : symbol,
      kind: isIndexKey(spotKey) ? "index" : "equity",
      isin: spotKey.startsWith("NSE_EQ|") ? spotKey.split("|")[1] : null,
      exchange: r.exchange || (spotKey.startsWith("BSE_") ? "BSE" : "NSE"),
      lot: r.lot ?? 0,
      futKey: null,
      expiry: null,
      strikes: new Set<number>(),
    };
    agg.set(spotKey, a);
    return a;
  };

  // 1) front futures per underlying — earliest expiry >= today, order-independent
  for (const r of validFutures) {
    const a = ensure(r);
    if (!a) continue;
    if (!a.expiry || (r.expiry as string) < a.expiry) {
      a.expiry = r.expiry as string;
      a.futKey = r.instrumentKey;
      a.lot = r.lot ?? a.lot;
    }
  }

  // 2) options for the chosen front expiry only (never mix expiries silently)
  for (const r of options) {
    const a = agg.get(r.underlyingKey as string);
    if (!a || !a.expiry || r.expiry !== a.expiry) continue;
    if (typeof r.strike === "number" && r.strike > 0) a.strikes.add(r.strike);
    if (!a.lot && r.lot) a.lot = r.lot;
  }

  // 3) index spots discovered independently of any futures row
  const indexRows = rows.filter((r) => r.segment.endsWith("_INDEX"));
  const findIndex = (want: string): MasterRow | null =>
    indexRows.find((r) => (r.instrumentKey ?? "").toUpperCase() === want.toUpperCase()) ??
    indexRows.find((r) => (r.tradingSymbol ?? "").toUpperCase() === want) ??
    null;

  const niftyRow = findIndex("NSE_INDEX|NIFTY 50") ?? indexRows.find((r) => r.instrumentKey === "NSE_INDEX|Nifty 50") ?? null;
  const sensexRow = findIndex("BSE_INDEX|SENSEX") ?? null;
  const bankNiftyRow = findIndex("NSE_INDEX|NIFTY Bank") ?? indexRows.find((r) => (r.tradingSymbol ?? "").toUpperCase() === "BANKNIFTY") ?? null;

  const indexSeeds: ContractSeed[] = [];
  const pushIndex = (row: MasterRow | null, key: string | null, symbol: string, fallbackName: string) => {
    const spotKey = row?.instrumentKey ?? key;
    if (!spotKey) {
      errors.push(`${symbol}: index instrument key not present in the Upstox master — spot data cannot be requested.`);
      return;
    }
    const fromFutures = Array.from(agg.values()).find((a) => a.spotKey === spotKey && a.futKey);
    indexSeeds.push({
      symbol,
      name: row?.name && row.name !== symbol ? row.name : fallbackName,
      sector: "INDEX",
      kind: "index",
      lot: fromFutures?.lot ?? row?.lot ?? 0,
      strikeStep: strikeStepOf(fromFutures?.strikes ?? new Set<number>(), "index"),
      isin: null,
      spotKey,
      futKey: fromFutures?.futKey ?? null,
      expiry: fromFutures?.expiry ?? null,
      exchange: (row?.exchange ?? (spotKey.startsWith("BSE_") ? "BSE" : "NSE")).toUpperCase(),
      hasFutures: !!fromFutures?.futKey,
    });
  };

  pushIndex(niftyRow, null, "NIFTY", "Nifty 50 Index");
  pushIndex(sensexRow, "BSE_INDEX|SENSEX", "SENSEX", "BSE Sensex Index");
  pushIndex(bankNiftyRow, null, "BANKNIFTY", "Nifty Bank Index");

  // 4) F&O underlyings (indices already added are de-duplicated by spotKey)
  const seeds: ContractSeed[] = [];
  let noFutures = 0;
  let noStrikes = 0;
  for (const a of agg.values()) {
    if (indexSeeds.some((s) => s.spotKey === a.spotKey)) continue;
    if (!a.futKey || !a.expiry) {
      noFutures++;
      continue;
    }
    if (a.strikes.size === 0) noStrikes++;
    seeds.push({
      symbol: a.symbol,
      name: a.name,
      sector: "UNCLASSIFIED",
      kind: a.kind,
      lot: a.lot || 1,
      strikeStep: strikeStepOf(a.strikes, a.kind),
      isin: a.isin,
      spotKey: a.spotKey,
      futKey: a.futKey,
      expiry: a.expiry,
      exchange: a.exchange.toUpperCase(),
      hasFutures: true,
    });
  }

  const priority = (s: ContractSeed) =>
    s.symbol === "NIFTY" ? 0 : s.symbol === "SENSEX" ? 1 : s.symbol === "BANKNIFTY" ? 2 : 3;
  const all = [...indexSeeds, ...seeds].sort((a, b) => priority(a) - priority(b) || a.symbol.localeCompare(b.symbol));

  const indexKeys = {
    nifty: niftyRow?.instrumentKey ?? indexSeeds.find((s) => s.symbol === "NIFTY")?.spotKey ?? null,
    sensex: sensexRow?.instrumentKey ?? indexSeeds.find((s) => s.symbol === "SENSEX")?.spotKey ?? null,
    banknifty: bankNiftyRow?.instrumentKey ?? indexSeeds.find((s) => s.symbol === "BANKNIFTY")?.spotKey ?? null,
  };

  if (!all.length) errors.push("No eligible underlyings were produced from the instrument master.");
  if (!indexKeys.nifty) errors.push("NIFTY index instrument key not found in master.");
  if (!indexKeys.sensex) errors.push("SENSEX index instrument key not found in master.");

  const diag: UniverseDiagnostics = {
    ...masterDiag,
    eligibleUnderlyings: all.length,
    indexKeys,
    expiredIgnored,
    noFutures,
    noStrikes,
  };

  return {
    // no arbitrary cap — every eligible underlying is returned
    seeds: all,
    ok: all.length > 0,
    errors,
    failures: masterDiag.failures,
    diag,
  };
}

function emptyDiag(master: MasterDiagnostics | null): UniverseDiagnostics {
  return {
    nseRows: 0,
    bseRows: 0,
    nseFo: 0,
    bseFo: 0,
    futures: 0,
    options: 0,
    indices: 0,
    expired: 0,
    invalid: 0,
    fetchedAt: master?.fetchedAt ?? 0,
    sources: master?.sources ?? [],
    failures: master?.failures ?? [],
    eligibleUnderlyings: 0,
    indexKeys: { nifty: null, sensex: null, banknifty: null },
    expiredIgnored: 0,
    noFutures: 0,
    noStrikes: 0,
  };
}
