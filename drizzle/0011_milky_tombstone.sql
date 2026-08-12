UPDATE `reconciliation_sessions`
SET `statement_state` = 4,
	`statement_error` = 'Statement extraction failed: No transactions were saved. Upload the statement again or add transactions manually.'
WHERE `statement_state` = 3
	AND NOT EXISTS (
		SELECT 1 FROM `bank_statement_lines`
		WHERE `bank_statement_lines`.`session_id` = `reconciliation_sessions`.`id`
	);--> statement-breakpoint
ALTER TABLE `reconciliation_sessions` DROP COLUMN `period_end_date`;
