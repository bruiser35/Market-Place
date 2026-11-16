CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`role` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sha256` text NOT NULL,
	`report_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_object_key_unique` ON `assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `assets_product` ON `assets` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_product_role` ON `assets` (`product_id`,`role`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favourites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favourites_user_product` ON `favourites` (`user_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`price_cents` integer NOT NULL,
	`asset_ids` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_cents` integer NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`paypal_order_id` text,
	`capture_id` text,
	`created_at` integer NOT NULL,
	`paid_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_paypal_order_id_unique` ON `orders` (`paypal_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_capture_id_unique` ON `orders` (`capture_id`);--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`user_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`type` text NOT NULL,
	`price_cents` integer NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`quality` text DEFAULT 'pending' NOT NULL,
	`rights_confirmed` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `products_status_category` ON `products` (`status`,`category`);--> statement-breakpoint
CREATE INDEX `products_updated` ON `products` (`updated_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
