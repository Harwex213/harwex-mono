ALTER TABLE "countries" ADD COLUMN "hex" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_hex_key" UNIQUE("hex");