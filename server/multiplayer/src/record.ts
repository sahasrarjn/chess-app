import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { RoomState, Seat } from "./room";

/** Game item written to the USERS table (shape mirrors the accounts GameRecord). */
export interface OnlineGameRecord {
  gameId: string;
  mode: "online";
  difficulty: null;
  playerColor: "white" | "black";
  opponent: string;
  moves: string[];
  resultType: "checkmate" | "stalemate" | "resignation" | "draw";
  winner: "white" | "black" | null;
  endedAt: string;
}

export interface UserGamesWriter {
  putGame(userId: string, game: OnlineGameRecord): Promise<void>;
  addStat(userId: string, key: string): Promise<void>;
}

/** Record a finished online game for each signed-in seat. Per-player failures
 *  are isolated; callers additionally guard the whole call (recording must
 *  never break a move). Resignation cannot occur online today (no resign
 *  message) but is handled for forward-compat. */
export async function recordFinishedGame(
  writer: UserGamesWriter,
  state: RoomState,
  nowMs: number
): Promise<void> {
  if (state.result.type === "ongoing") return;
  const resultType = state.result.type;
  const winner = "winner" in state.result ? state.result.winner : null;
  const endedAt = new Date(nowMs).toISOString();
  const gameId = randomUUID();

  const seats: { color: "white" | "black"; seat: Seat | null; other: Seat | null }[] = [
    { color: "white", seat: state.white, other: state.black },
    { color: "black", seat: state.black, other: state.white },
  ];
  for (const { color, seat, other } of seats) {
    if (!seat?.userId) continue;
    try {
      await writer.putGame(seat.userId, {
        gameId,
        mode: "online",
        difficulty: null,
        playerColor: color,
        opponent: other?.name ?? "Opponent",
        moves: [...state.moves],
        resultType,
        winner,
        endedAt,
      });
      const key = winner == null ? "online_d" : winner === color ? "online_w" : "online_l";
      await writer.addStat(seat.userId, key);
    } catch (err) {
      console.error(`recordFinishedGame: failed for ${color}`, err);
    }
  }
}

/** Writes directly to the accounts users table (USERS_TABLE_NAME).
 *  Item shapes deliberately duplicate server/accounts/src/store.ts —
 *  keep PK/SK and attribute names in sync. */
export class DynamoUserGamesWriter implements UserGamesWriter {
  private readonly doc: DynamoDBDocumentClient;
  constructor(private readonly tableName: string, client?: DynamoDBClient) {
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  async putGame(userId: string, game: OnlineGameRecord): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: `USER#${userId}`, SK: `GAME#${game.endedAt}#${game.gameId}`, ...game },
      })
    );
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
