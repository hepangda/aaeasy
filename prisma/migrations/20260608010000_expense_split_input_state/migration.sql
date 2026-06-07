-- Raw snapshot of the split editor's per-row inputs (checked / shares / extra
-- per member) at save time. `splitRule` stays the authoritative computed
-- result; this column lets the edit page restore the exact controls the user
-- last typed. Null for drafts and pre-existing rows.

ALTER TABLE "expenses" ADD COLUMN "splitInputState" JSONB;
