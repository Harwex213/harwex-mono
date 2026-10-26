CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL UNIQUE,
	"map_id" uuid
);
--> statement-breakpoint
CREATE TABLE "maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "provinces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL UNIQUE,
	"hex" varchar(255) NOT NULL UNIQUE,
	"country_id" uuid
);
--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_map_id_maps_id_fkey" FOREIGN KEY ("map_id") REFERENCES "maps"("id");--> statement-breakpoint
ALTER TABLE "provinces" ADD CONSTRAINT "provinces_country_id_countries_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id");