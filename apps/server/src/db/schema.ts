import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  uniqueIndex,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const tableModes = ["live", "async"] as const;
const tableStatuses = ["lobby", "active", "finished"] as const;
const gameStatuses = ["active", "finished"] as const;

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const gameTable = pgTable(
  "game_table",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    gameId: text("game_id").notNull(),
    config: jsonb("config").notNull(),
    mode: text("mode", { enum: tableModes }).notNull().default("live"),
    status: text("status", { enum: tableStatuses }).notNull(),
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    softSeatCap: integer("soft_seat_cap").notNull().default(4),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("game_table_host_user_id_idx").on(table.hostUserId)],
);

export const tablePlayer = pgTable(
  "table_player",
  {
    tableId: text("table_id")
      .notNull()
      .references(() => gameTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seatIndex: integer("seat_index").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tableId, table.userId] }),
    index("table_player_table_id_idx").on(table.tableId),
    uniqueIndex("table_player_table_id_seat_index_idx").on(
      table.tableId,
      table.seatIndex,
    ),
  ],
);

export const game = pgTable(
  "game",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id")
      .notNull()
      .references(() => gameTable.id, { onDelete: "cascade" }),
    gameId: text("game_id").notNull(),
    state: jsonb("state").notNull(),
    seq: integer("seq").notNull().default(0),
    status: text("status", { enum: gameStatuses }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("game_table_id_idx").on(table.tableId)],
);

export const gameEvent = pgTable(
  "game_event",
  {
    id: text("id").primaryKey(),
    gameRowId: text("game_row_id")
      .notNull()
      .references(() => game.id, { onDelete: "cascade" }),
    tableId: text("table_id")
      .notNull()
      .references(() => gameTable.id, { onDelete: "cascade" }),
    gameId: text("game_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("game_event_game_row_id_idx").on(table.gameRowId),
    index("game_event_table_id_idx").on(table.tableId),
    uniqueIndex("game_event_game_row_id_seq_idx").on(
      table.gameRowId,
      table.seq,
    ),
  ],
);

export const chatMessage = pgTable(
  "chat_message",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id")
      .notNull()
      .references(() => gameTable.id, { onDelete: "cascade" }),
    gameRowId: text("game_row_id").references(() => game.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("chat_message_table_id_idx").on(table.tableId),
    index("chat_message_game_row_id_idx").on(table.gameRowId),
    index("chat_message_user_id_idx").on(table.userId),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  hostedTables: many(gameTable),
  tablePlayers: many(tablePlayer),
  events: many(gameEvent),
  messages: many(chatMessage),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const gameTableRelations = relations(gameTable, ({ one, many }) => ({
  hostUser: one(user, {
    fields: [gameTable.hostUserId],
    references: [user.id],
  }),
  players: many(tablePlayer),
  games: many(game),
  events: many(gameEvent),
  messages: many(chatMessage),
}));

export const tablePlayerRelations = relations(tablePlayer, ({ one }) => ({
  table: one(gameTable, {
    fields: [tablePlayer.tableId],
    references: [gameTable.id],
  }),
  user: one(user, {
    fields: [tablePlayer.userId],
    references: [user.id],
  }),
}));

export const gameRelations = relations(game, ({ one, many }) => ({
  table: one(gameTable, {
    fields: [game.tableId],
    references: [gameTable.id],
  }),
  events: many(gameEvent),
  messages: many(chatMessage),
}));

export const gameEventRelations = relations(gameEvent, ({ one }) => ({
  game: one(game, {
    fields: [gameEvent.gameRowId],
    references: [game.id],
  }),
  table: one(gameTable, {
    fields: [gameEvent.tableId],
    references: [gameTable.id],
  }),
  actor: one(user, {
    fields: [gameEvent.actorId],
    references: [user.id],
  }),
}));

export const chatMessageRelations = relations(chatMessage, ({ one }) => ({
  table: one(gameTable, {
    fields: [chatMessage.tableId],
    references: [gameTable.id],
  }),
  game: one(game, {
    fields: [chatMessage.gameRowId],
    references: [game.id],
  }),
  user: one(user, {
    fields: [chatMessage.userId],
    references: [user.id],
  }),
}));

export const schema = {
  user,
  session,
  account,
  verification,
  gameTable,
  tablePlayer,
  game,
  gameEvent,
  chatMessage,
};
