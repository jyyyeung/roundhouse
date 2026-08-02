CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"game_row_id" text,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"game_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "game_event" (
	"id" text PRIMARY KEY NOT NULL,
	"game_row_id" text NOT NULL,
	"table_id" text NOT NULL,
	"game_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_table" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"game_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"mode" text DEFAULT 'live' NOT NULL,
	"status" text NOT NULL,
	"host_user_id" text NOT NULL,
	"soft_seat_cap" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "game_table_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "table_player" (
	"table_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seat_index" integer NOT NULL,
	CONSTRAINT "table_player_table_id_user_id_pk" PRIMARY KEY("table_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_table_id_game_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."game_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_game_row_id_game_id_fk" FOREIGN KEY ("game_row_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_table_id_game_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."game_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_event" ADD CONSTRAINT "game_event_game_row_id_game_id_fk" FOREIGN KEY ("game_row_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_event" ADD CONSTRAINT "game_event_table_id_game_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."game_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_event" ADD CONSTRAINT "game_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_table" ADD CONSTRAINT "game_table_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_player" ADD CONSTRAINT "table_player_table_id_game_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."game_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_player" ADD CONSTRAINT "table_player_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_message_table_id_idx" ON "chat_message" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "chat_message_game_row_id_idx" ON "chat_message" USING btree ("game_row_id");--> statement-breakpoint
CREATE INDEX "chat_message_user_id_idx" ON "chat_message" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "game_table_id_idx" ON "game" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "game_event_game_row_id_idx" ON "game_event" USING btree ("game_row_id");--> statement-breakpoint
CREATE INDEX "game_event_table_id_idx" ON "game_event" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_event_game_row_id_seq_idx" ON "game_event" USING btree ("game_row_id","seq");--> statement-breakpoint
CREATE INDEX "game_table_host_user_id_idx" ON "game_table" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "table_player_table_id_idx" ON "table_player" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "table_player_table_id_seat_index_idx" ON "table_player" USING btree ("table_id","seat_index");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");