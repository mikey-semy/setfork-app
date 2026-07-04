CREATE TABLE "star_folder_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "star_folder_items_pair" UNIQUE("folder_id","template_id")
);
--> statement-breakpoint
CREATE TABLE "star_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "star_folders_user_name" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "star_folder_items" ADD CONSTRAINT "star_folder_items_folder_id_star_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."star_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "star_folder_items" ADD CONSTRAINT "star_folder_items_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "star_folders" ADD CONSTRAINT "star_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "star_folder_items_folder_idx" ON "star_folder_items" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "star_folders_user_idx" ON "star_folders" USING btree ("user_id");