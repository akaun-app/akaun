/**
 * Attaching a document to an income record, at its old URL.
 *
 * One pair of endpoints serves every record now, and this is the same handler
 * rather than a copy of it — the permission it checks already follows the
 * record's kind, so income is checked against `income` exactly as before
 * (contracts/api.md). Re-exporting is what keeps the two from drifting.
 */
export { POST } from "../../../records/[id]/attachments/+server.js";
