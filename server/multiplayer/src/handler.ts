import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { parseClientMessage, type ServerMessage } from "./protocol";
import { disconnect, emptyRoom, join, move, rematch, roleOf } from "./room";
import { DynamoRoomStore, type RoomStore } from "./store";
import { verifySession } from "./session";
import { DynamoUserGamesWriter, recordFinishedGame, type UserGamesWriter } from "./record";

export interface WsEvent {
  requestContext: {
    routeKey: string;
    connectionId: string;
    domainName?: string;
    stage?: string;
  };
  queryStringParameters?: Record<string, string | undefined>;
  body?: string | null;
}

export interface HandlerOptions {
  /** Returns the userId for a valid session token; absent ⇒ sessions disabled. */
  verifySession?: (token: string) => Promise<string>;
  /** Absent ⇒ game recording disabled. */
  games?: UserGamesWriter;
}

export interface Broadcaster {
  send(connectionId: string, message: ServerMessage): Promise<void>;
}

const OK = { statusCode: 200, body: "" };

async function sendAll(
  broadcaster: Broadcaster,
  out: { connId: string; message: ServerMessage }[]
): Promise<void> {
  await Promise.all(
    out.map((o) =>
      broadcaster.send(o.connId, o.message).catch(() => {
        /* a gone/late connection must not fail the whole batch */
      })
    )
  );
}

/** Pure-ish core: all I/O goes through `store` and `broadcaster` so it is testable. */
export async function handleEvent(
  event: WsEvent,
  store: RoomStore,
  broadcaster: Broadcaster,
  now: number,
  opts: HandlerOptions = {}
): Promise<{ statusCode: number; body: string }> {
  const { routeKey, connectionId } = event.requestContext;

  if (routeKey === "$connect") {
    const session = event.queryStringParameters?.session;
    if (session && opts.verifySession) {
      try {
        const userId = await opts.verifySession(session);
        await store.putConnectionUser(connectionId, userId);
      } catch {
        // Invalid/expired session ⇒ guest seat (today's behavior); never reject.
      }
    }
    return OK;
  }

  if (routeKey === "$disconnect") {
    const rec = await store.getConnection(connectionId);
    if (rec) {
      const room = await store.getRoom(rec.roomId);
      if (room) {
        const { state, out } = disconnect(room, connectionId, now);
        await store.putRoom(state);
        await sendAll(broadcaster, out);
      }
    }
    await store.deleteConnection(connectionId);
    return OK;
  }

  // $default — a typed client message.
  const msg = parseClientMessage(event.body ?? "");
  if (!msg) {
    await broadcaster.send(connectionId, { type: "error", message: "Unrecognized message." });
    return OK;
  }

  if (msg.type === "join") {
    const room = (await store.getRoom(msg.roomId)) ?? emptyRoom(msg.roomId, now);
    const userId = await store.getConnectionUser(connectionId);
    const { state, out } = join(room, connectionId, msg.token, msg.name, now, userId);
    await store.putRoom(state);
    await store.putConnection({
      connectionId,
      roomId: msg.roomId,
      role: roleOf(state, connectionId) ?? "spectator",
    });
    await sendAll(broadcaster, out);
    return OK;
  }

  const rec = await store.getConnection(connectionId);
  if (!rec) {
    await broadcaster.send(connectionId, { type: "error", message: "Join a room first." });
    return OK;
  }
  const room = await store.getRoom(rec.roomId);
  if (!room) {
    await broadcaster.send(connectionId, { type: "error", message: "Room not found." });
    return OK;
  }

  if (msg.type === "move") {
    const wasFinished = room.status === "finished";
    const result = move(room, connectionId, msg.uci, now);
    await store.putRoom(result.state);
    await sendAll(broadcaster, result.out);
    if (!wasFinished && result.state.status === "finished" && opts.games) {
      try {
        await recordFinishedGame(opts.games, result.state, now);
      } catch (err) {
        console.error("recordFinishedGame failed", err); // never fails the move
      }
    }
    return OK;
  }

  const result = rematch(room, connectionId, now);
  await store.putRoom(result.state);
  await sendAll(broadcaster, result.out);
  return OK;
}

class ApiGatewayBroadcaster implements Broadcaster {
  private readonly client: ApiGatewayManagementApiClient;
  constructor(endpoint: string) {
    this.client = new ApiGatewayManagementApiClient({ endpoint });
  }
  async send(connectionId: string, message: ServerMessage): Promise<void> {
    try {
      await this.client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify(message)),
        })
      );
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 410) return; // connection gone — ignore
      throw err;
    }
  }
}

let store: RoomStore | null = null;
let games: UserGamesWriter | null = null;

export async function handler(event: WsEvent): Promise<{ statusCode: number; body: string }> {
  store ??= new DynamoRoomStore(process.env.TABLE_NAME ?? "");
  const usersTable = process.env.USERS_TABLE_NAME ?? "";
  if (usersTable && !games) games = new DynamoUserGamesWriter(usersTable);
  const secret = process.env.SESSION_JWT_SECRET ?? "";
  const endpoint =
    process.env.WS_ENDPOINT ||
    `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  return handleEvent(event, store, new ApiGatewayBroadcaster(endpoint), Date.now(), {
    verifySession: secret ? (t) => verifySession(secret, t) : undefined,
    games: games ?? undefined,
  });
}
