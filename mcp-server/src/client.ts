import WebSocket from "ws";
import {
  DecodedMessage,
  MessageType,
  PlasticityObject,
  PutGroup,
  PutItem,
  RefacetParams,
  Transaction,
  decodeMessage,
  encodeHandshake,
  encodeListAll,
  encodeListVisible,
  encodePutSome,
  encodeRefacetSome,
  encodeSubscribeAll,
  encodeSubscribeSome,
  encodeUnsubscribeAll,
} from "./protocol.js";

export interface ClientOptions {
  server?: string; // host:port, default localhost:8980
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (msg: DecodedMessage) => void;
  reject: (err: Error) => void;
  expectedKinds: DecodedMessage["kind"][];
  timer: NodeJS.Timeout;
}

export interface SceneEvent {
  at: number; // ms timestamp
  kind: "add" | "update" | "delete" | "newFile" | "newVersion";
  filename?: string;
  version?: number;
  objectIds?: number[];
}

const MAX_EVENT_BUFFER = 500;

export class PlasticityClient {
  private ws: WebSocket | null = null;
  private nextMsgId = 1;
  private pending = new Map<number, PendingRequest>();
  private readonly server: string;
  private readonly handshakeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private supported: Set<number> = new Set();
  private currentFilename: string | null = null;
  private currentVersion = 0;
  private events: SceneEvent[] = [];
  private subscribed = false;

  constructor(opts: ClientOptions = {}) {
    this.server = opts.server ?? "localhost:8980";
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? 5000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  supports(opcode: MessageType): boolean {
    return this.supported.has(opcode);
  }

  getServer(): string {
    return this.server;
  }

  getFilename(): string | null {
    return this.currentFilename;
  }

  getVersion(): number {
    return this.currentVersion;
  }

  pendingEventCount(): number {
    return this.events.length;
  }

  drainEvents(limit?: number): SceneEvent[] {
    if (limit === undefined || limit >= this.events.length) {
      const out = this.events;
      this.events = [];
      return out;
    }
    return this.events.splice(0, limit);
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    const url = `ws://${this.server}`;
    this.ws = new WebSocket(url, { maxPayload: 2 ** 32 - 1, handshakeTimeout: this.handshakeTimeoutMs });

    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      const onOpen = () => {
        ws.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        ws.off("open", onOpen);
        this.ws = null;
        reject(new Error(`Cannot connect to ${url}. Enable Plasticity's Blender bridge server, or use native_windows/native_connect for the CDP adapter. ${err.message || err.name}`));
      };
      ws.once("open", onOpen);
      ws.once("error", onError);
    });

    this.ws.on("message", (data) => this.onMessage(data as Buffer));
    this.ws.on("close", () => this.onClose());
    this.ws.on("error", (err) => {
      // Keep noise low; surface via console but don't throw — pending will time out.
      console.error("[plasticity-mcp] ws error:", err.message);
    });

    try {await this.handshake();} catch(err) {await this.disconnect();throw err;}
  }

  async disconnect(): Promise<void> {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    if(ws.readyState === WebSocket.CLOSED)return;
    return new Promise((resolve) => {
      const timer=setTimeout(()=>{ws.terminate();resolve()},1000);
      ws.once("close", () => {clearTimeout(timer);resolve()});
      try {
        ws.close();
      } catch {
        resolve();
      }
    });
  }

  private onClose(): void {
    this.ws = null;
    this.subscribed = false;
    this.supported = new Set();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("WebSocket closed"));
    }
    this.pending.clear();
  }

  private onMessage(data: Buffer): void {
    let decoded: DecodedMessage;
    try {
      decoded = decodeMessage(data);
    } catch (err) {
      console.error("[plasticity-mcp] decode error:", (err as Error).message);
      return;
    }

    // Track file state from any message that carries it.
    if (decoded.kind === "newFile") {
      this.currentFilename = decoded.filename;
      this.currentVersion = 0;
      this.subscribed = false;
      this.recordEvent({ kind: "newFile", filename: decoded.filename });
      return;
    }
    if (decoded.kind === "newVersion") {
      this.currentFilename = decoded.filename;
      this.currentVersion = decoded.version;
      this.recordEvent({
        kind: "newVersion",
        filename: decoded.filename,
        version: decoded.version,
      });
      return;
    }
    if (decoded.kind === "transaction") {
      const tx = decoded.data;
      this.currentFilename = tx.filename;
      this.currentVersion = tx.version;
      this.recordTransaction(tx);
      return;
    }

    // Response messages with msgId — match against pending requests.
    const msgId = "data" in decoded && "msgId" in decoded.data ? decoded.data.msgId : null;
    if (msgId !== null) {
      const p = this.pending.get(msgId);
      if (p && p.expectedKinds.includes(decoded.kind)) {
        clearTimeout(p.timer);
        this.pending.delete(msgId);
        if (decoded.kind === "list") {
          this.currentFilename = decoded.data.filename;
          this.currentVersion = decoded.data.version;
        }
        if (decoded.kind === "handshake") {
          this.supported = decoded.data.supportedOpcodes;
        }
        p.resolve(decoded);
        return;
      }
    }
  }

  private recordTransaction(tx: Transaction): void {
    if (tx.delete.length > 0) {
      this.recordEvent({
        kind: "delete",
        filename: tx.filename,
        version: tx.version,
        objectIds: tx.delete,
      });
    }
    if (tx.add.length > 0) {
      this.recordEvent({
        kind: "add",
        filename: tx.filename,
        version: tx.version,
        objectIds: tx.add.map((o) => o.id),
      });
    }
    if (tx.update.length > 0) {
      this.recordEvent({
        kind: "update",
        filename: tx.filename,
        version: tx.version,
        objectIds: tx.update.map((o) => o.id),
      });
    }
  }

  private recordEvent(e: Omit<SceneEvent, "at">): void {
    this.events.push({ at: Date.now(), ...e });
    if (this.events.length > MAX_EVENT_BUFFER) {
      this.events.splice(0, this.events.length - MAX_EVENT_BUFFER);
    }
  }

  private send(buf: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to Plasticity");
    }
    this.ws.send(buf);
  }

  private request<K extends DecodedMessage["kind"]>(
    msgId: number,
    expectedKinds: K[],
    timeoutMs: number,
  ): Promise<Extract<DecodedMessage, { kind: K }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error(`Request ${msgId} (${expectedKinds.join("|")}) timed out`));
      }, timeoutMs);
      this.pending.set(msgId, {
        resolve: (msg) => resolve(msg as Extract<DecodedMessage, { kind: K }>),
        reject,
        expectedKinds,
        timer,
      });
    });
  }

  private newMsgId(): number {
    return this.nextMsgId++;
  }

  private async handshake(): Promise<void> {
    const id = this.newMsgId();
    this.send(encodeHandshake(id));
    await this.request(id, ["handshake"], this.handshakeTimeoutMs);
  }

  async listAll(visibleOnly = false): Promise<PlasticityObject[]> {
    const id = this.newMsgId();
    this.send(visibleOnly ? encodeListVisible(id) : encodeListAll(id));
    const resp = await this.request(id, ["list"], this.requestTimeoutMs);
    if (resp.data.code !== 200) {
      throw new Error(`List failed: code ${resp.data.code}`);
    }
    return resp.data.objects;
  }

  async subscribeAll(): Promise<void> {
    const id = this.newMsgId();
    this.send(encodeSubscribeAll(id));
    this.subscribed = true;
  }

  async unsubscribeAll(): Promise<void> {
    const id = this.newMsgId();
    this.send(encodeUnsubscribeAll(id));
    this.subscribed = false;
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }

  async subscribeSome(filename: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const id = this.newMsgId();
    this.send(encodeSubscribeSome(id, filename, ids));
  }

  async refacetSome(
    filename: string,
    ids: number[],
    params: RefacetParams = {},
  ): Promise<Extract<DecodedMessage, { kind: "refacet" }>["data"]> {
    if (ids.length === 0) {
      return { msgId: 0, code: 200, filename, fileVersion: 0, items: [] };
    }
    const id = this.newMsgId();
    this.send(encodeRefacetSome(id, filename, ids, params));
    const resp = await this.request(id, ["refacet"], this.requestTimeoutMs);
    return resp.data;
  }

  async putSome(
    filename: string,
    groups: PutGroup[],
    items: PutItem[],
  ): Promise<Extract<DecodedMessage, { kind: "putSome" }>["data"]> {
    const id = this.newMsgId();
    this.send(encodePutSome(id, filename, groups, items));
    const resp = await this.request(id, ["putSome"], this.requestTimeoutMs);
    return resp.data;
  }
}
