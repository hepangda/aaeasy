-- The expense note is capped at 200 characters (see
-- `packages/contracts/src/expenses.ts`), down from 2000. Existing rows are
-- truncated rather than rejected: a note is an aside, and anything past 200
-- characters was already invisible in the ledger, which only renders a marker
-- icon and a tooltip.
UPDATE "expenses" SET "note" = left("note", 200) WHERE length("note") > 200;
