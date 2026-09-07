/**
 * THE SURFACE MANIFEST — what is here, and what may be touched.
 *
 * An assistant driving a page needs two things: where it can go, and what it
 * can touch. The first is usually DECLARED — a hand-written list of routes —
 * and it works. The second is usually DERIVED: an element is reachable if
 * somebody happened to give it an `id` or an `aria-label`, and invisible if
 * they did not. Derived that way, the overwhelming majority of controls in a
 * real application are unreachable, by nobody's decision. What the assistant
 * can touch becomes a side effect of accessibility hygiene.
 *
 * This module is the declared half, generalised past "path = page". A modal, an
 * editor, a tab, a settings screen, a chat panel's own history view: all are
 * addressable states, and none of them are URLs.
 *
 * TWO RULES HOLD THE WHOLE THING UP.
 *
 * 1. THE MANIFEST DECLARES; THE DOM CONFIRMS. A manifest describes; the page
 *    IS. When it lists a control that is not there — a feature flag, a
 *    permission, a page changed since it was written — acting on it is acting
 *    on fiction. `verifySurface` is not an optional extra; it is the half of
 *    the design that keeps the other half honest.
 *
 * 2. A MANIFEST FROM SOMEONE ELSE IS DATA, NEVER INSTRUCTION. A customer site
 *    supplies its own, and `mutates: false` on a delete button is then a claim,
 *    not a fact. `effectiveMutates` fails CLOSED for anything not ours: an
 *    untrusted manifest can add friction, never remove it.
 *
 * Zero dependencies, no framework, and it must stay that way — this package is
 * loaded into pages its authors do not own.
 */

/** Schema version of the manifest format itself, not of any surface. */
export const MANIFEST_VERSION = "1" as const;

/**
 * WHERE A MANIFEST CAME FROM, WHICH DECIDES WHAT IT MAY ASSERT.
 *
 * `owned`      shipped by us, versioned with the code it describes.
 * `generated`  produced by the DOM walk. Structurally ours, but nothing in it
 *              was decided by a person, so its `mutates` is a guess.
 * `untrusted`  supplied by a customer site. Useful, and never load-bearing for
 *              a safety decision.
 */
export type ManifestTrust = "owned" | "generated" | "untrusted";

/** What kind of thing a control is — a hint for phrasing, not for gating. */
export type ControlKind =
  | "button"
  | "link"
  | "input"
  | "select"
  | "textarea"
  | "toggle"
  | "other";

/**
 * WHAT KIND OF THING IS ON THE PAGE. Not what it depicts.
 */
export type MediaKind = "image" | "video" | "audio" | "embed";

/**
 * ONE PIECE OF MEDIA ON A SURFACE — A REFERENCE, NOT PERCEPTION.
 *
 * This is the distinction the whole type hangs on, and getting it wrong is
 * worse than having no media at all.
 *
 * An assistant holding this entry knows that an image EXISTS, where it sits,
 * what the page's own alt text calls it, and how big it is. It can therefore
 * name it, swap it, reuse it, or point a person at it. It CANNOT see it. A
 * filename and an alt string are not the picture, and treating them as one is
 * how an assistant ends up confidently describing a photograph nobody showed
 * it — the same failure as narrating a page's data from its structure.
 *
 * `alt` is the page's own words about the image, written by a person for a
 * screen reader. It is evidence of intent, and often wrong or empty. Repeating
 * it as a description is quoting; inventing beyond it is not.
 *
 * Looking at an image is a separate capability with its own cost and its own
 * consent, and nothing here grants it.
 */
export interface ManifestMedia {
  /** Stable handle. A declared id where one exists, otherwise the source. */
  id: string;
  kind: MediaKind;
  /** Where it comes from. May be relative, and may be a temporary URL. */
  src?: string;
  /** The alt text the PAGE carries. Absent means the page gave none — worth
   *  saying out loud, since that is an accessibility gap as well as a gap in
   *  what anything can know about the image. */
  alt?: string;
  /** Intrinsic size where the page declares it. Null when unknown, which is
   *  not the same as zero. */
  width?: number | null;
  height?: number | null;
  /** Set when this came from an asset library, so it can be reused or
   *  replaced without uploading it again. */
  assetId?: string;
  /** True when nothing decided this — a DOM walk found it. */
  inferred?: boolean;
}

/** One control the assistant may point at or operate. */
export interface ManifestControl {
  /** The `data-ai-target` id. Never a selector: the resolver owns id→element,
   *  so a controlling parent can only ever reach what a page opted in. */
  id: string;
  /** Human label, so the model picks the right one. */
  label: string;
  /** What it does, in words. Worth writing for anything non-obvious. */
  purpose?: string;
  kind?: ControlKind;
  /**
   * DOES USING THIS CHANGE ANYTHING?
   *
   * Being data is the point. The alternative is a hardcoded list of action
   * names, which is wrong in both directions: it gates switching to a filter
   * tab exactly as hard as "Delete account", and it does not gate a
   * destructive control reached by any other means.
   */
  mutates: boolean;
  /** Only meaningful when `mutates`. `destructive` means the user cannot
   *  simply do it again backwards — the difference between renaming a report
   *  and deleting one. */
  severity?: "reversible" | "destructive";
  /** True when nothing decided this — the generator inferred it. A human
   *  reviewing a draft looks here first. */
  inferred?: boolean;
}

/**
 * An addressable state. A page is one; so is a modal, a tab, a pane.
 *
 * `path` is OPTIONAL, and that is the whole generalisation. Today's
 * `PageManifestEntry` assumes path = page, which is why the widget can drive
 * the page it is embedded in but not itself.
 */
export interface ManifestView {
  /** Stable id, unique within the surface. */
  id: string;
  title: string;
  purpose?: string;
  /** Set only when this view IS a route. A modal has none. */
  path?: string;
  /** Named action to open it, when the host prefers one over a raw path. */
  action?: string;
  /** Areas on it, for describing structure. */
  sections?: string[];
  controls?: ManifestControl[];
  /** Pictures, video and embeds on this view. References only — see
   *  `ManifestMedia`, which explains at length why that word matters. */
  media?: ManifestMedia[];
  /** Nested states: a dialog within a page, a tab within a dialog. */
  views?: ManifestView[];
  /** Page-aware starter questions, as today's manifest carries. */
  suggestions?: string[];
}

/** Everything known about one surface. */
export interface SurfaceManifest {
  /** Names the thing this describes — a panel, an app, an origin. Two
   *  manifests coexist when an embedded panel's and its host page's both
   *  apply, and the name is what tells them apart. */
  surface: string;
  /** Schema version. A manifest whose version this build does not know is
   *  refused rather than half-read. */
  version: string;
  trust: ManifestTrust;
  /** Content hash of the surface as generated. A mismatch says "the page moved
   *  on"; it does not say what changed, which is what `verifySurface` is for. */
  hash?: string;
  generatedAt?: string;
  views: ManifestView[];
}

/* ------------------------------------------------------------------------- *
 * Reading
 * ------------------------------------------------------------------------- */

/** Every view in the tree, depth-first, parents before children. */
export function flattenViews(manifest: SurfaceManifest): ManifestView[] {
  const out: ManifestView[] = [];
  const walk = (views: ManifestView[]): void => {
    for (const v of views) {
      out.push(v);
      if (v.views?.length) walk(v.views);
    }
  };
  walk(manifest.views);
  return out;
}

/** Every control in the surface, in view order. */
export function flattenControls(
  manifest: SurfaceManifest
): Array<ManifestControl & { viewId: string }> {
  const out: Array<ManifestControl & { viewId: string }> = [];
  for (const v of flattenViews(manifest)) {
    for (const c of v.controls ?? []) out.push({ ...c, viewId: v.id });
  }
  return out;
}

/** Every piece of media on the surface, in view order. */
export function flattenMedia(
  manifest: SurfaceManifest
): Array<ManifestMedia & { viewId: string }> {
  const out: Array<ManifestMedia & { viewId: string }> = [];
  for (const v of flattenViews(manifest))
    for (const m of v.media ?? []) out.push({ ...m, viewId: v.id });
  return out;
}

/** Find one control by id, wherever it sits in the tree. */
export function findControl(
  manifest: SurfaceManifest,
  id: string
): ManifestControl | undefined {
  return flattenControls(manifest).find((c) => c.id === id);
}

/**
 * DOES THIS NEED A CONFIRMATION? — the one question the gate should ask.
 *
 * FAILS CLOSED, twice over:
 *
 *  - a control nobody declared is treated as mutating, because the alternative
 *    is that anything the manifest forgot becomes freely clickable;
 *  - `mutates: false` from an `untrusted` manifest is IGNORED. A customer site
 *    saying its delete button is harmless is a claim about our safety model
 *    made by someone with an interest in fewer prompts. Untrusted input can
 *    add friction and never remove it.
 */
export function effectiveMutates(
  manifest: SurfaceManifest,
  controlId: string
): boolean {
  const control = findControl(manifest, controlId);
  if (!control) return true;
  if (control.mutates) return true;
  // Declared harmless — believed only from a manifest that is ours.
  return manifest.trust === "untrusted";
}

/* ------------------------------------------------------------------------- *
 * The manifest declares; the DOM confirms
 * ------------------------------------------------------------------------- */

export interface ManifestDrift {
  /** `missing`  declared but not in the DOM — NEVER act on it.
   *  `hidden`   present but not visible to the user.
   *  `undeclared` in the DOM carrying an id nobody declared. */
  kind: "missing" | "hidden" | "undeclared";
  id: string;
  detail: string;
}

/** Minimal shape needed to read a document — so this is testable without a
 *  browser, and so a detached widget root works exactly like a page. */
export interface ManifestRoot {
  querySelectorAll(selector: string): ArrayLike<ManifestElement>;
  querySelector(selector: string): ManifestElement | null;
}

export interface ManifestElement {
  getAttribute(name: string): string | null;
  isConnected?: boolean;
  tagName?: string;
  textContent?: string | null;
  getBoundingClientRect?: () => { width: number; height: number };
}

function isVisible(el: ManifestElement): boolean {
  if (el.isConnected === false) return false;
  const rect = el.getBoundingClientRect?.();
  // No geometry available (a test root, a detached document) is NOT evidence of
  // invisibility — reporting every control hidden would make drift meaningless.
  if (!rect) return true;
  return rect.width > 0 || rect.height > 0;
}

function attrEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

/**
 * Compare what the manifest claims against what the document actually has.
 *
 * This is the step that stops an assistant narrating what it cannot observe
 * from acquiring a click. A `missing` control is not a warning to
 * log and move past: it means the manifest and the page disagree, and the page
 * wins, because the page is what the user is looking at.
 */
export function verifySurface(
  manifest: SurfaceManifest,
  root: ManifestRoot
): ManifestDrift[] {
  const drift: ManifestDrift[] = [];
  const declared = flattenControls(manifest);
  const declaredIds = new Set(declared.map((c) => c.id));

  for (const c of declared) {
    const el = root.querySelector(`[data-ai-target="${attrEscape(c.id)}"]`);
    if (!el) {
      drift.push({
        kind: "missing",
        id: c.id,
        detail: `"${c.label}" is declared on this surface but is not in the page.`,
      });
      continue;
    }
    if (!isVisible(el)) {
      drift.push({
        kind: "hidden",
        id: c.id,
        detail: `"${c.label}" is present but not visible.`,
      });
    }
  }

  for (const el of Array.from(root.querySelectorAll("[data-ai-target]"))) {
    const id = el.getAttribute("data-ai-target");
    if (!id || declaredIds.has(id)) continue;
    drift.push({
      kind: "undeclared",
      id,
      detail: `"${id}" is in the page but not declared in the manifest.`,
    });
  }

  return drift;
}

/**
 * May the assistant act on this control, right now, on this document?
 *
 * Deliberately one call returning a REASON rather than a boolean. A caller
 * handed `false` writes its own explanation, and the explanations drift; a
 * caller handed the reason says the true thing without inventing it.
 */
export interface ActDecision {
  ok: boolean;
  needsConfirm: boolean;
  reason?: string;
}

export function canAct(
  manifest: SurfaceManifest,
  controlId: string,
  root: ManifestRoot
): ActDecision {
  const control = findControl(manifest, controlId);
  if (!control) {
    return {
      ok: false,
      needsConfirm: true,
      reason: `"${controlId}" is not declared on the ${manifest.surface} surface.`,
    };
  }
  const el = root.querySelector(`[data-ai-target="${attrEscape(controlId)}"]`);
  if (!el) {
    // Said out loud rather than guessed past: the manifest is stale, or this
    // person cannot see this control. Both are worth telling the user.
    return {
      ok: false,
      needsConfirm: true,
      reason: `"${control.label}" is described on this page but is not actually here — the page may have changed, or it may not be available to you.`,
    };
  }
  if (!isVisible(el)) {
    return {
      ok: false,
      needsConfirm: true,
      reason: `"${control.label}" is on the page but not visible right now.`,
    };
  }
  return { ok: true, needsConfirm: effectiveMutates(manifest, controlId) };
}
