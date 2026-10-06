ALTER TABLE `record_attachments` ADD `group_document` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Marks the files already attached from a document imported as several items:
-- the file of a queue row that has items, and any file two records share (only
-- a group's file is ever shared). Only the new column is written.
UPDATE `record_attachments` SET `group_document` = 1
WHERE `filename` IN (
    SELECT `q`.`temp_file_path` FROM `import_queue` AS `q`
    WHERE EXISTS (SELECT 1 FROM `import_items` AS `i` WHERE `i`.`job_id` = `q`.`id`)
  )
  OR EXISTS (
    SELECT 1 FROM `record_attachments` AS `other`
    WHERE `other`.`filename` = `record_attachments`.`filename`
      AND `other`.`record_id` <> `record_attachments`.`record_id`
  );
