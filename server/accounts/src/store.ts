import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Provider } from "./protocol";

export interface UserRecord {
  userId: string;
  email: string; // "" when the provider never disclosed one (Apple edge case)
  displayName: string;
  avatarUrl: string | null;
  createdAt: string; // ISO 8601
  /** Phase 3/4 placeholder — empty map for now. */
  stats: Record<string, never>;
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
}

/** In-memory store for tests. */
export class InMemoryUserStore implements UserStore {
  private users = new Map<string, UserRecord>();
  private idp = new Map<string, string>();
  private emails = new Map<string, string>();

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
      stats: (it.stats as Record<string, never>) ?? {},
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
}
