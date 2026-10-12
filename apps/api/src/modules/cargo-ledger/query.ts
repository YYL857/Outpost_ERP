import type {
  CargoLedger,
  CargoLedgerTicket,
  CargoLedgerTicketSummary,
  LedgerIssue,
} from "./types.js";

function toSummary(t: CargoLedgerTicket): CargoLedgerTicketSummary {
  const { boxes: _b, skuLines: _s, ...rest } = t;
  return rest;
}

export function ledgerMeta(ledger: CargoLedger): {
  builtAt: string;
  sources: CargoLedger["sources"];
  side: CargoLedger["side"];
  shops: CargoLedger["shops"];
  ticketCount: number;
  boxCount: number;
  skuLineCount: number;
  issueCount: number;
  issuesPreview: LedgerIssue[];
} {
  return {
    builtAt: ledger.builtAt,
    sources: ledger.sources,
    side: ledger.side,
    shops: ledger.shops,
    ticketCount: ledger.tickets.length,
    boxCount: ledger.tickets.reduce((s, t) => s + t.boxCount, 0),
    skuLineCount: ledger.tickets.reduce((s, t) => s + t.skuLines.length, 0),
    issueCount: ledger.issues.length,
    issuesPreview: ledger.issues.slice(0, 40),
  };
}

export function filterTickets(
  ledger: CargoLedger,
  opts: {
    shop?: string;
    q?: string;
    transit?: "all" | "in_transit" | "arrived";
    page?: number;
    pageSize?: number;
  },
): {
  rows: CargoLedgerTicketSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
} {
  const shop = (opts.shop ?? "").trim().toUpperCase();
  const q = (opts.q ?? "").trim().toLowerCase();
  const transit = opts.transit ?? "all";
  let rows = ledger.tickets;
  if (shop && shop !== "ALL") {
    rows = rows.filter((t) => t.shopCode.toUpperCase() === shop);
  }
  if (transit === "in_transit") rows = rows.filter((t) => t.inTransit);
  if (transit === "arrived") rows = rows.filter((t) => !t.inTransit);
  if (q) {
    rows = rows.filter((t) => {
      if (t.ticketKey.toLowerCase().includes(q)) return true;
      if (t.ticketNo.toLowerCase().includes(q)) return true;
      if (t.logisticsNo.toLowerCase().includes(q)) return true;
      if (t.forwarder.toLowerCase().includes(q)) return true;
      if (t.boxes.some((b) => b.boxNo.toLowerCase().includes(q))) return true;
      if (
        t.skuLines.some(
          (s) =>
            s.partnerSku.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q),
        )
      ) {
        return true;
      }
      return false;
    });
  }
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(opts.page ?? 1, 1), pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize).map(toSummary),
    total: rows.length,
    page,
    pageSize,
    pageCount,
  };
}

export function findTicket(
  ledger: CargoLedger,
  ticketKey: string,
): CargoLedgerTicket | null {
  const key = ticketKey.trim();
  if (!key) return null;
  return (
    ledger.tickets.find((t) => t.ticketKey === key) ??
    ledger.tickets.find((t) => t.ticketNo === key) ??
    null
  );
}
