import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Role } from "./protocol";
import type { RoomState } from "./room";

export interface ConnectionRecord {
  connectionId: string;
  roomId: string;
  role: Role;
}

export interface RoomStore {
  getRoom(roomId: string): Promise<RoomState | null>;
  putRoom(state: RoomState): Promise<void>;
  putConnection(rec: ConnectionRecord): Promise<void>;
  getConnection(connectionId: string): Promise<ConnectionRecord | null>;
  deleteConnection(connectionId: string): Promise<void>;
  /** Verified session user for a connection (written at $connect). */
  putConnectionUser(connectionId: string, userId: string): Promise<void>;
  getConnectionUser(connectionId: string): Promise<string | null>;
}

/** In-memory store for tests and local runs. */
export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, RoomState>();
  private connections = new Map<string, ConnectionRecord>();
  private connUsers = new Map<string, string>();

  async getRoom(roomId: string): Promise<RoomState | null> {
    const r = this.rooms.get(roomId);
    return r ? structuredClone(r) : null;
  }
  async putRoom(state: RoomState): Promise<void> {
    this.rooms.set(state.roomId, structuredClone(state));
  }
  async putConnection(rec: ConnectionRecord): Promise<void> {
    this.connections.set(rec.connectionId, { ...rec });
  }
  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    const c = this.connections.get(connectionId);
    return c ? { ...c } : null;
  }
  async deleteConnection(connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
    this.connUsers.delete(connectionId);
  }
  async putConnectionUser(connectionId: string, userId: string): Promise<void> {
    this.connUsers.set(connectionId, userId);
  }
  async getConnectionUser(connectionId: string): Promise<string | null> {
    return this.connUsers.get(connectionId) ?? null;
  }
}

const CONN_TTL_SECONDS = 24 * 60 * 60;

/** DynamoDB-backed store: one table keyed by (PK, SK). */
export class DynamoRoomStore implements RoomStore {
  private readonly doc: DynamoDBDocumentClient;
  constructor(private readonly tableName: string, client?: DynamoDBClient) {
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async getRoom(roomId: string): Promise<RoomState | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `ROOM#${roomId}`, SK: "META" } })
    );
    return (res.Item?.state as RoomState | undefined) ?? null;
  }

  async putRoom(state: RoomState): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: `ROOM#${state.roomId}`, SK: "META", state, ttl: state.ttl },
      })
    );
  }

  async putConnection(rec: ConnectionRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CONN#${rec.connectionId}`,
          SK: "META",
          roomId: rec.roomId,
          role: rec.role,
          ttl: Math.floor(Date.now() / 1000) + CONN_TTL_SECONDS,
        },
      })
    );
  }

  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `CONN#${connectionId}`, SK: "META" } })
    );
    if (!res.Item) return null;
    return { connectionId, roomId: res.Item.roomId as string, role: res.Item.role as Role };
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await Promise.all([
      this.doc.send(
        new DeleteCommand({ TableName: this.tableName, Key: { PK: `CONN#${connectionId}`, SK: "META" } })
      ),
      this.doc.send(
        new DeleteCommand({ TableName: this.tableName, Key: { PK: `CONNUSER#${connectionId}`, SK: "META" } })
      ),
    ]);
  }

  async putConnectionUser(connectionId: string, userId: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `CONNUSER#${connectionId}`,
          SK: "META",
          userId,
          ttl: Math.floor(Date.now() / 1000) + CONN_TTL_SECONDS,
        },
      })
    );
  }

  async getConnectionUser(connectionId: string): Promise<string | null> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: `CONNUSER#${connectionId}`, SK: "META" } })
    );
    if (!res.Item) return null;
    return (res.Item.userId as string) ?? null;
  }
}
