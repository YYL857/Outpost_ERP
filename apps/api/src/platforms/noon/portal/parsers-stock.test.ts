/**
 * FBN Inventory Ledger Summary / Detailed → stock parser smoke tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { parseStockContent } from "./parsers.js";

const portalCsv = `fulfillment_type,id_partner,country_code,warehouse_code,pbarcode,sku,opening_stock,in_transit,inbound_received,customer_shipment,return_reinbound,qc_fail_return,vendor_return,liquidation,dispose,relabel,warehouse_transfer,lost_and_found,unknown_transactions,closing_stock
fbn,482387,SA,RUH01S,N2SASHBD002GRY,ZB2EF2B4D0634BBBF7938Z-1,3,0,0,0,0,0,0,0,0,0,0,0,0,3
supermall,482387,SA,RUHMS01,N2SASHBD002GRY,ZB2EF2B4D0634BBBF7938Z-1,1,0,0,0,0,0,0,0,0,0,0,0,0,1
transit,482387,SA,SA_TRANSIT,N2SASHBD002GRY,ZB2EF2B4D0634BBBF7938Z-1,0,2,0,0,0,0,0,0,0,0,0,0,0,2
`;

const portal = parseStockContent(portalCsv, "csv");
const fbn = portal.find(
  (s) => s.partner_sku === "N2SASHBD002GRY" && s.fulfillment === "fbn",
);
const sm = portal.find(
  (s) => s.partner_sku === "N2SASHBD002GRY" && s.fulfillment === "supermall",
);
const tr = portal.find(
  (s) => s.partner_sku === "N2SASHBD002GRY" && s.fulfillment === "transit",
);
assert.ok(fbn);
assert.equal(fbn.qty, 3);
assert.equal(fbn.warehouse_code, "RUH01S");
assert.ok(sm);
assert.equal(sm.qty, 1);
assert.ok(tr);
assert.equal(tr.qty, 0);
assert.equal(tr.in_transit_qty, 2);

const detailedPath = join(
  process.cwd(),
  "scripts/_out/impex-stock-detailed-PRJ482387-2026-09-27.csv",
);
try {
  const detailedCsv = readFileSync(detailedPath, "utf8");
  const detailed = parseStockContent(detailedCsv, "csv");
  const dFbn = detailed.find(
    (s) =>
      s.partner_sku === "N2SASHBD002GRY" &&
      s.warehouse_code === "RUH01S" &&
      s.fulfillment === "fbn",
  );
  assert.ok(dFbn, "detailed fbn row");
  assert.equal(dFbn.qty, 3);
  const smRows = detailed.filter(
    (s) => s.partner_sku === "N2SASHBD002GRY" && s.fulfillment === "supermall",
  );
  assert.ok(smRows.length > 0);
  console.log("parseStockContent detailed OK", {
    rows: detailed.length,
    fbn: dFbn.qty,
    supermallSkus: smRows.length,
  });
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === "ENOENT") {
    console.log("skip detailed file probe (no local export)");
  } else {
    throw e;
  }
}

console.log("parsers stock summary/detailed.test OK");
