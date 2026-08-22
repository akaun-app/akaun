import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { getAuditTrail, type RecordType } from "$lib/server/audit.js";
import { hasPermission, type ResourceName } from "$lib/server/permissions.js";

// audit RecordType -> the ResourceName whose 'view' permission gates it.
//
// 'expense' and 'income' survive for entries written before the ledger upgrade;
// every ledger write since is a 'record'. All three are gated on `records` view:
// the audit trail is read from a detail page the user already had to be
// allowed to open, and there is now one ability for every kind of record.
const RESOURCE_BY_RECORD_TYPE: Record<RecordType, ResourceName> = {
  expense: "records",
  income: "records",
  record: "records",
  account: "accounts",
  settlement: "records",
  contact: "contacts",
  quotation: "quotations",
  invoice: "invoices",
  reconciliation: "reconciliation",
};

export const GET: RequestHandler = ({ locals, params }) => {
  const recordType = params.recordType as RecordType;
  const resource = RESOURCE_BY_RECORD_TYPE[recordType];
  if (!resource)
    return Response.json({ error: "Unknown record type" }, { status: 400 });
  if (!hasPermission(locals, resource, "view"))
    return new Response("Forbidden", { status: 403 });

  const recordId = parseInt(params.recordId!);
  if (!recordId)
    return Response.json({ error: "Invalid record id" }, { status: 400 });

  return Response.json(getAuditTrail(db, recordType, recordId));
};
