CREATE TABLE `artwork_metadata` (
	`product_id` text PRIMARY KEY NOT NULL,
	`metadata_json` text NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`source_id` text,
	`source_site` text,
	`source_job_id` text,
	`source_created_at` text,
	`received_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_metadata_source_id_unique` ON `artwork_metadata` (`source_id`);--> statement-breakpoint
CREATE TABLE `bridge_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `design_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest_json` text NOT NULL,
	`metadata_json` text,
	`vector_json` text,
	`model` text,
	`status` text DEFAULT 'receiving' NOT NULL,
	`product_id` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_imports_source_id_unique` ON `design_imports` (`source_id`);--> statement-breakpoint
CREATE TABLE `catalogue_embeddings` (
	`product_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `design_import_files` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`side` text NOT NULL,
	`object_key` text NOT NULL,
	`preview_key` text NOT NULL,
	`sha256` text NOT NULL,
	`report_json` text NOT NULL,
	`size` integer NOT NULL,
	`preview_size` integer NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `design_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_file_side` ON `design_import_files` (`import_id`,`side`);--> statement-breakpoint
CREATE TABLE `search_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`band` integer NOT NULL,
	`bucket` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `search_bucket_lookup` ON `search_buckets` (`band`,`bucket`);