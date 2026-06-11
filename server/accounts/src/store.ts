import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { GameRecord, Provider, RecordableMode } from "./protocol";

export interface UserRecord {
  userId: string;
  email: string; // "" when the provider never disclosed one (Apple edge case)
  displayName: string;
  avatarUrl: string | null;
  createdAt: string; // ISO 8601
  /** Flat counters: bot_<difficulty>_<w|l|d>, online_<w|l|d>. Phase 4 reads these. */
  stats: Record<string, number>;
}

/**
 * A stored game record. mode allows "online" in addition to RecordableMode
 * because online game items are written directly by the multiplayer Lambda.
 */
export type StoredGame = Omit<GameRecord, "mode"> & { mode: RecordableMode | "online" };

export interface GamePage {
  games: StoredGame[];
  nextCursor: string | null;
}

export interface UserStore {
  getUser(userId: string): Promise<UserRecord | null>;
  putUser(user: UserRecord): Promise<void>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;
  getUserIdByIdp(provider: Provider, sub: string): Promise<string | null>;
  /** Returns true if the mapping was written, false if it already existed (no clobber). */
  putIdpMapping(provider: Provider, sub: string, userId: string): Promise<boolean>;
  getUserIdByEmail(email: string): Promise<string | null>;
  /** Returns true if the mapping was written, false if it already existed (no clobber). */
  putEmailMapping(email: string, userId: string): Promise<boolean>;
  putGame(userId: string, game: StoredGame): Promise<void>;
  /** Newest-first by endedAt. cursor is opaque; invalid cursors yield the first page. */
  listGames(userId: string, limit: number, cursor: string | null): Promise<GamePage>;
  getGame(userId: string, gameId: string): Promise<StoredGame | null>;
  /** Increment a flat stats counter by 1. Throws if the user item is missing. */
  addStat(userId: string, key: string): Promise<void>;
}

/** In-memory store for tests. */
export class InMemoryUserStore implements UserStore {
  private users = new Map<string, UserRecord>();
  private idp = new Map<string, string>();
  private emails = new Map<string, string>();
  private games = new Map<string, StoredGame[]>();

  async getUser(userId: string): Promise<UserRecord | null> {
    const u = this.users.get(userId);
    return u ? structuredClone(u) : null;
  }
  async putUser(user: UserRecord): Promise<void> {
    this.users.set(user.userId, structuredClone(user));
  }
  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    const u = this.users.get(userId);
    if (!u) throw new Error(`User not found: ${userId}`);
    u.displayName = displayName;
  }
  async getUserIdByIdp(provider: Provider, sub: string): Promise<string | null> {
    return this.idp.get(`${provider}:${sub}`) ?? null;
  }
  async putIdpMapping(provider: Provider, sub: string, userId: string): Promise<boolean> {
    const key = `${provider}:${sub}`;
    if (this.idp.has(key)) return false;
    this.idp.set(key, userId);
    return true;
  }
  async getUserIdByEmail(email: string): Promise<string | null> {
    return this.emails.get(email) ?? null;
  }
  async putEmailMapping(email: string, userId: string): Promise<boolean> {
    if (this.emails.has(email)) return false;
    this.emails.set(email, userId);
    return true;
  }

  async putGame(userId: string, game: StoredGame): Promise<void> {
    const list = this.games.get(userId) ?? [];
    list.push(structuredClone(game));
    this.games.set(userId, list);
  }

  async listGames(userId: string, limit: number, cursor: string | null): Promise<GamePage> {
    const list = (this.games.get(userId) ?? []).slice();
    // Sort descending by sort key
    list.sort((a, b) => {
      const skA = gameSk(a);
      const skB = gameSk(b);
      return skA < skB ? 1 : skA > skB ? -1 : 0;
    });

    // Apply cursor: cursor is the SK of the last item returned on the previous page.
    // Return only items whose SK is strictly less than the cursor.
    // If cursor is invalid/garbage (doesn't match any item's SK), treat as first page.
    let filtered = list;
    if (cursor) {
      const anyMatch = list.some((g) => gameSk(g) === cursor);
      if (anyMatch) {
        filtered = list.filter((g) => gameSk(g) < cursor);
      }
      // else: garbage cursor → fall through with full list (first page)
    }

    const page = filtered.slice(0, limit);
    const nextCursor = filtered.length > limit ? gameSk(filtered[limit - 1]) : null;
    return { games: page.map((g) => structuredClone(g)), nextCursor };
  }

  async getGame(userId: string, gameId: string): Promise<StoredGame | null> {
    const list = this.games.get(userId) ?? [];
    const found = list.find((g) => g.gameId === gameId);
    return found ? structuredClone(found) : null;
  }

  async addStat(userId: string, key: string): Promise<void> {
    const u = this.users.get(userId);
    if (!u) throw new Error(`User not found: ${userId}`);
    u.stats[key] = (u.stats[key] ?? 0) + 1;
  }
}

/** DynamoDB-backed store: one table keyed by (PK, SK), mirroring DynamoRoomStore. */
export class DynamoUserStore implements UserStore {
  private readonly doc: DynamoDBDocumentClient;
  constructor(private readonly tableName: string, client?: DynamoDBClient) {
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `USER#${userId}`, SK: "META" } })
    );
    if (!res.Item) return null;
    const it = res.Item;
    return {
      userId,
      email: (it.email as string) ?? "",
      displayName: (it.displayName as string) ?? "Player",
      avatarUrl: (it.avatarUrl as string | null) ?? null,
      createdAt: (it.createdAt as string) ?? "",
      stats: (it.stats as Record<string, number>) ?? {},
    };
  }

  async putUser(user: UserRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `USER#${user.userId}`,
          SK: "META",
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          stats: user.stats,
        },
      })
    );
  }

  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${userId}`, SK: "META" },
        UpdateExpression: "SET displayName = :n",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeValues: { ":n": displayName },
      })
    );
  }

  async getUserIdByIdp(provider: Provider, sub: string): Promise<string | null> {
    return this.getMappedUserId(`IDP#${provider}:${sub}`);
  }
  async putIdpMapping(provider: Provider, sub: string, userId: string): Promise<boolean> {
    return this.putMappingIfAbsent(`IDP#${provider}:${sub}`, userId);
  }
  async getUserIdByEmail(email: string): Promise<string | null> {
    return this.getMappedUserId(`EMAIL#${email}`);
  }
  async putEmailMapping(email: string, userId: string): Promise<boolean> {
    return this.putMappingIfAbsent(`EMAIL#${email}`, userId);
  }

  private async getMappedUserId(pk: string): Promise<string | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: pk, SK: "META" } })
    );
    return (res.Item?.userId as string | undefined) ?? null;
  }
  /** Writes the mapping only if no item with that PK exists.
   *  Returns true if written, false if the item already existed. */
  private async putMappingIfAbsent(pk: string, userId: string): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { PK: pk, SK: "META", userId },
          ConditionExpression: "attribute_not_exists(PK)",
        })
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  async putGame(userId: string, game: StoredGame): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `USER#${userId}`,
          SK: `GAME#${game.endedAt}#${game.gameId}`,
          ...game,
        },
      })
    );
  }

  async listGames(userId: string, limit: number, cursor: string | null): Promise<GamePage> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :game)",
        ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":game": "GAME#" },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor, `USER#${userId}`),
      })
    );
    return {
      games: (res.Items ?? []).map(itemToStoredGame),
      nextCursor: res.LastEvaluatedKey ? encodeCursor(res.LastEvaluatedKey) : null,
    };
  }

  async getGame(userId: string, gameId: string): Promise<StoredGame | null> {
    // No GSI: filter-scan the user's GAME# partition slice. Bounded by per-user
    // game counts; revisit with a GSI if users accumulate thousands of games.
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :game)",
          FilterExpression: "gameId = :id",
          ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":game": "GAME#",
            ":id": gameId,
          },
          ExclusiveStartKey: startKey,
        })
      );
      if (res.Items && res.Items.length > 0) return itemToStoredGame(res.Items[0]);
      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
    return null;
  }

  async addStat(userId: string, key: string): Promise<void> {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `USER#${userId}`, SK: "META" },
        UpdateExpression: "ADD stats.#k :one",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#k": key },
        ExpressionAttributeValues: { ":one": 1 },
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gameSk(g: StoredGame): string {
  return `GAME#${g.endedAt}#${g.gameId}`;
}

function itemToStoredGame(it: Record<string, unknown>): StoredGame {
  return {
    gameId: it.gameId as string,
    mode: it.mode as StoredGame["mode"],
    difficulty: (it.difficulty as StoredGame["difficulty"]) ?? null,
    playerColor: (it.playerColor as StoredGame["playerColor"]) ?? null,
    opponent: (it.opponent as string) ?? "",
    moves: (it.moves as string[]) ?? [],
    resultType: it.resultType as StoredGame["resultType"],
    winner: (it.winner as StoredGame["winner"]) ?? null,
    endedAt: (it.endedAt as string) ?? "",
  };
}

/** base64url(JSON LastEvaluatedKey). Shape-validated on decode; bad cursors ⇒ first page. */
export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

export function decodeCursor(
  cursor: string | null,
  expectedPk: string
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (key.PK !== expectedPk || typeof key.SK !== "string") return undefined;
    return key;
  } catch {
    return undefined;
  }
}
