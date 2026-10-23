CREATE TABLE "manual_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"map_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"queue_id" text NOT NULL,
	"patch" text,
	"rounds_won" integer NOT NULL,
	"rounds_lost" integer NOT NULL,
	"kills" integer NOT NULL,
	"deaths" integer NOT NULL,
	"assists" integer NOT NULL,
	"combat_score" integer,
	"damage_dealt" integer,
	"first_kills" integer,
	"first_deaths" integer,
	"note" text,
	"excluded" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_matches_user_dedupe_uq" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "manual_matches" ADD CONSTRAINT "manual_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manual_matches_user_started_idx" ON "manual_matches" USING btree ("user_id","started_at");