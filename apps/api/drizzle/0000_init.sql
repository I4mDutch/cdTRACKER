CREATE TABLE "analysis_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"filter" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"asset_path" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_kind_id_pk" PRIMARY KEY("kind","id")
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"total" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_category" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "insight_feedback" (
	"user_id" uuid NOT NULL,
	"finding_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_feedback_user_id_finding_id_pk" PRIMARY KEY("user_id","finding_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"map_id" text NOT NULL,
	"queue_id" text NOT NULL,
	"patch" text,
	"season_id" text,
	"duration_ms" integer,
	"rounds_played" integer NOT NULL,
	"is_completed" boolean NOT NULL,
	"excluded" text,
	"teams" jsonb NOT NULL,
	"has_round_data" boolean NOT NULL,
	"raw_payload_id" uuid,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_match_records" (
	"match_id" text NOT NULL,
	"puuid" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"map_id" text NOT NULL,
	"queue_id" text NOT NULL,
	"patch" text,
	"agent_id" text NOT NULL,
	"team_id" text NOT NULL,
	"outcome" text NOT NULL,
	"rounds_played" integer NOT NULL,
	"rounds_won" integer NOT NULL,
	"rounds_lost" integer NOT NULL,
	"kills" integer NOT NULL,
	"deaths" integer NOT NULL,
	"assists" integer NOT NULL,
	"combat_score" integer,
	"damage_dealt" integer,
	"headshots" integer,
	"bodyshots" integer,
	"legshots" integer,
	"first_kills" integer,
	"first_deaths" integer,
	"plants" integer,
	"defuses" integer,
	"performance_score" integer,
	"excluded" text,
	CONSTRAINT "player_match_records_match_id_puuid_pk" PRIMARY KEY("match_id","puuid")
);
--> statement-breakpoint
CREATE TABLE "player_rounds" (
	"match_id" text NOT NULL,
	"puuid" text NOT NULL,
	"round_number" integer NOT NULL,
	"won" boolean NOT NULL,
	"result" text NOT NULL,
	"kills" integer NOT NULL,
	"died" boolean NOT NULL,
	"damage" integer NOT NULL,
	"first_kill" boolean NOT NULL,
	"first_death" boolean NOT NULL,
	"planted" boolean NOT NULL,
	"defused" boolean NOT NULL,
	CONSTRAINT "player_rounds_match_id_puuid_round_number_pk" PRIMARY KEY("match_id","puuid","round_number")
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"schema_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riot_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"puuid" text NOT NULL,
	"game_name" text,
	"tag_line" text,
	"shard" text NOT NULL,
	"link_state" text NOT NULL,
	"consented_at" timestamp with time zone,
	"linked_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "riot_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "riot_accounts_puuid_unique" UNIQUE("puuid")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_snapshots" ADD CONSTRAINT "analysis_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_feedback" ADD CONSTRAINT "insight_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_raw_payload_id_raw_payloads_id_fk" FOREIGN KEY ("raw_payload_id") REFERENCES "public"."raw_payloads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_records" ADD CONSTRAINT "player_match_records_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("match_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_rounds" ADD CONSTRAINT "player_rounds_record_fk" FOREIGN KEY ("match_id","puuid") REFERENCES "public"."player_match_records"("match_id","puuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riot_accounts" ADD CONSTRAINT "riot_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshots_user_kind_created_idx" ON "analysis_snapshots" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "jobs_user_state_idx" ON "ingestion_jobs" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "matches_started_at_idx" ON "matches" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "pmr_puuid_started_idx" ON "player_match_records" USING btree ("puuid","started_at");--> statement-breakpoint
CREATE INDEX "pmr_puuid_agent_idx" ON "player_match_records" USING btree ("puuid","agent_id");--> statement-breakpoint
CREATE INDEX "pmr_puuid_map_idx" ON "player_match_records" USING btree ("puuid","map_id");--> statement-breakpoint
CREATE INDEX "raw_payloads_kind_source_idx" ON "raw_payloads" USING btree ("kind","source_key");--> statement-breakpoint
CREATE INDEX "raw_payloads_expires_idx" ON "raw_payloads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");