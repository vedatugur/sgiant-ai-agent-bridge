/**
 * The postMessage protocol spoken between a controlling parent (the AI chat
 * widget) and an agent running inside a framed page. This is the generic,
 * open-source contract: any page can install the agent (`mountAiAgent`) and any
 * embedder can drive it (`createFrameTransport`), same-origin OR cross-origin.
 *
 * Design notes:
 * - Every message is tagged with a channel + version so unrelated postMessage
 *   traffic (analytics, other embeds, wallets, dev tools) is ignored.
 * - The parent NEVER sends a selector or URL to run — only an allow-listed action
 *   verb + a `data-ai-target` id the page itself published. The agent owns
 *   id→element resolution, so a compromised/hostile parent can't reach arbitrary
 *   DOM or execute code.
 * - Origins are validated on BOTH ends (allow-lists), so a page can't be driven
 *   by an unexpected embedder and a parent won't accept spoofed results.
 */
import type { AiTargetInfo } from "./dom-control.js";

/**
 * Channel tag on every message — filters out unrelated postMessage traffic.
 *
 * This is a WIRE value and part of this package's public contract. A parent and
 * a page-side that disagree about it never see each other AT ALL: every
 * listener filters on the channel before `BRIDGE_VERSION` is consulted, so a
 * mismatch is silence rather than an error anything can catch — the parent
 * simply lists no targets. Keep both halves of a deployment on versions that
 * agree, and treat any change to it as breaking.
 */
export const BRIDGE_CHANNEL = "ai-agent-bridge";
/** Protocol version — bump on any breaking shape change. */
export const BRIDGE_VERSION = 1 as const;

/** The action verbs the parent may ask the agent to run. Navigation is handled
 *  by the parent itself (it owns the frame's URL), so it is NOT in this list. */
export const BRIDGE_ACTIONS = [
  "highlight",
  "scroll-to",
  "focus-field",
  "fill",
  "click",
] as const;
export type BridgeAction = (typeof BRIDGE_ACTIONS)[number];

export function isBridgeAction(name: string): name is BridgeAction {
  return (BRIDGE_ACTIONS as readonly string[]).includes(name);
}

/** Parent → agent: rescan the page and re-publish the target catalog. */
export interface ScanMsg {
  ch: typeof BRIDGE_CHANNEL;
  v: typeof BRIDGE_VERSION;
  type: "scan";
}
/** Parent → agent: perform one action against a published target id. */
export interface ActMsg {
  ch: typeof BRIDGE_CHANNEL;
  v: typeof BRIDGE_VERSION;
  type: "act";
  /** Correlation id so the parent can match the `result`. */
  id: number;
  action: BridgeAction;
  target: string;
  /** Value for `fill`. */
  value?: string;
}
/** Parent → agent: clear any active highlight. */
export interface ClearMsg {
  ch: typeof BRIDGE_CHANNEL;
  v: typeof BRIDGE_VERSION;
  type: "clear-highlight";
}
export type ParentMessage = ScanMsg | ActMsg | ClearMsg;

/** Agent → parent: mounted and ready to receive commands. */
export interface HelloMsg {
  ch: typeof BRIDGE_CHANNEL;
  v: typeof BRIDGE_VERSION;
  type: "hello";
  /** The framed page's current path (pathname + search). */
  path: string;
}
/** Agent → parent: the current catalog of controllable targets. */
export interface TargetsMsg {
  ch: typeof BRIDGE_CHANNEL;
  v: typeof BRIDGE_VERSION;
  type: "targets";
  targets: AiTargetInfo[];
  path: string;
}
/** Agent → parent: the outcome of one `act`. */
export interface ResultMsg {
  ch: typeof BRIDGE_CHANNEL;
  v: typeof BRIDGE_VERSION;
  type: "result";
  id: number;
  ok: boolean;
  message?: string;
}
export type AgentMessage = HelloMsg | TargetsMsg | ResultMsg;

/** Type-guard: is `data` a well-formed message on our channel+version? */
export function isBridgeMessage(data: unknown): data is { type: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { ch?: unknown }).ch === BRIDGE_CHANNEL &&
    (data as { v?: unknown }).v === BRIDGE_VERSION &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

/** Decide whether an incoming message's origin is permitted. `"*"` allows any
 *  (only sensible same-origin); otherwise the origin must be in the list. */
export function originAllowed(
  origin: string,
  allowed: string[] | "*"
): boolean {
  if (allowed === "*") return true;
  return allowed.includes(origin);
}
