CREATE TABLE `query_embedding_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`vector_json` text NOT NULL,
	`expires_at` integer NOT NULL
);
