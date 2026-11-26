-- Convert Influencer.country (single ISO) to Influencer.countries (string[]).
-- Existing non-empty values become a one-element array.

ALTER TABLE "Influencer" ADD COLUMN "countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Influencer"
SET "countries" = ARRAY[UPPER(TRIM("country"))]
WHERE "country" IS NOT NULL AND TRIM("country") <> '';

DROP INDEX IF EXISTS "Influencer_country_idx";

ALTER TABLE "Influencer" DROP COLUMN "country";

CREATE INDEX "Influencer_countries_idx" ON "Influencer" USING GIN ("countries");
