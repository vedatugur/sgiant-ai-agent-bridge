/**
 * The TRANSPORT — the parent (controlling) side of the bridge. Given an <iframe>
 * whose page runs `mountAiAgent`, it: collects the page's target catalog, sends
 * `act` commands, and resolves each with the agent's result. The AI chat widget
 * uses this in "advanced view" to drive the app shown in the frame.
 *
 * Navigation is deliberately NOT here — the parent owns the frame's URL, so it
 * navigates by setting `iframe.src` (or the embed URL for a path) directly. This
 * transport only carries the on-page actions (highlight / scroll / focus / fill
 * / click) that must run inside the frame's own document.
 */
import type { AiTargetInfo } from "./dom-control";
import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  isBridgeMessage,
  originAllowed,
  type ActMsg,
  type AgentMessage,
  type BridgeAction,
} from "./protocol";

export interface FrameTransportOptions {
  /** Origin to post commands to / accept messages from. Defaults to the current
   *  origin (same-origin embedding). Set for a cross-origin frame. */
  targetOrigin?: string;
  /** Also accept these origins on inbound messages (defaults to [targetOrigin]). */
  allowedOrigins?: string[] | "*";
  /** Called whenever the agent (re)publishes its catalog. */
  onTargets?: (targets: AiTargetInfo[], path: string) => void;
  /** Called once the agent announces it's ready. */
  onReady?: (path: string) => void;
  /** Per-action timeout before rejecting (ms). */
  actTimeoutMs?: number;
}

export interface ActResult {
  ok: boolean;
  message?: string;
}

export interface FrameTransport {
  /** Run one on-page action inside the frame; resolves with the agent's result. */
  act(
    action: BridgeAction,
    data: { target: string; value?: string }
  ): Promise<ActResult>;
  /** Ask the agent to re-publish its catalog. */
  requestScan(): void;
  /** The most recently published catalog. */
  getTargets(): AiTargetInfo[];
  /** The frame's most recently reported path. */
  getPath(): string | null;
  /** True once the agent has said hello. */
  isReady(): boolean;
  destroy(): void;
}

/**
 * Wire a transport to an iframe running the agent. Safe to create before the
 * frame has loaded — it buffers nothing but starts listening immediately and
 * connects when the agent says hello.
 */
export function createFrameTransport(
  iframe: HTMLIFrameElement,
  opts: FrameTransportOptions = {}
): FrameTransport {
  const targetOrigin =
    opts.targetOrigin ??
    (typeof location !== "undefined" ? location.origin : "*");
  const allowed: string[] | "*" =
    opts.allowedOrigins ?? (targetOrigin === "*" ? "*" : [targetOrigin]);

  let targets: AiTargetInfo[] = [];
  let path: string | null = null;
  let ready = false;
  let seq = 0;
  const pending = new Map<
    number,
    { resolve: (r: ActResult) => void; timer: number }
  >();

  const post = (
    msg: ActMsg | { ch: string; v: number; type: string }
  ): void => {
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      win.postMessage(msg, targetOrigin);
    } catch {
      /* frame not ready / cross-origin race */
    }
  };

  const onMessage = (ev: MessageEvent): void => {
    if (ev.source !== iframe.contentWindow) return;
    if (!originAllowed(ev.origin, allowed)) return;
    const data = ev.data;
    if (!isBridgeMessage(data)) return;
    const msg = data as AgentMessage;
    if (msg.type === "hello") {
      ready = true;
      path = msg.path;
      opts.onReady?.(msg.path);
      // Pull a fresh catalog on connect.
      requestScan();
    } else if (msg.type === "targets") {
      targets = msg.targets;
      path = msg.path;
      opts.onTargets?.(msg.targets, msg.path);
    } else if (msg.type === "result") {
      const p = pending.get(msg.id);
      if (p) {
        window.clearTimeout(p.timer);
        pending.delete(msg.id);
        p.resolve({ ok: msg.ok, message: msg.message });
      }
    }
  };
  window.addEventListener("message", onMessage);

  const requestScan = (): void =>
    post({ ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: "scan" });

  const act = (
    action: BridgeAction,
    data: { target: string; value?: string }
  ): Promise<ActResult> =>
    new Promise<ActResult>((resolve) => {
      const id = ++seq;
      const timer = window.setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, message: "the page didn't respond in time" });
      }, opts.actTimeoutMs ?? 8000);
      pending.set(id, { resolve, timer });
      post({
        ch: BRIDGE_CHANNEL,
        v: BRIDGE_VERSION,
        type: "act",
        id,
        action,
        target: data.target,
        ...(data.value !== undefined ? { value: data.value } : {}),
      });
    });

  return {
    act,
    requestScan,
    getTargets: () => targets,
    getPath: () => path,
    isReady: () => ready,
    destroy: () => {
      window.removeEventListener("message", onMessage);
      for (const { timer } of pending.values()) window.clearTimeout(timer);
      pending.clear();
    },
  };
}
