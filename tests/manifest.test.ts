/**
 * The surface manifest (#356).
 *
 * The DOM is hand-rolled rather than jsdom on purpose: this package ships zero
 * dependencies into pages we do not own, and a test-only dependency still has
 * to be installed by anyone who forks it. A fake that implements exactly the
 * four methods the walk uses is also a precise statement of what the walk is
 * allowed to touch.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAct,
  effectiveMutates,
  findControl,
  flattenControls,
  flattenViews,
  generateManifest,
  hashManifest,
  verifySurface,
  type SurfaceManifest,
// dist, not src: this is what actually ships, and the subpath resolution is
// part of what is being tested. Same reason the widget builds before testing.
} from "../dist/manifest-entry.js";

/* --------------------------------------------------------------- fake DOM */

interface FakeAttrs {
  [k: string]: string | undefined;
}

class FakeEl {
  children: FakeEl[] = [];
  tagName: string;
  attrs: FakeAttrs;
  textContent: string | null;
  visible: boolean;

  // Plain fields, not parameter properties: node --test strips types rather
  // than compiling them, and `constructor(public x: T)` is syntax, not a type.
  constructor(
    tagName: string,
    attrs: FakeAttrs = {},
    textContent: string | null = null,
    visible = true
  ) {
    this.tagName = tagName;
    this.attrs = attrs;
    this.textContent = textContent;
    this.visible = visible;
  }

  getAttribute(name: string): string | null {
    const v = this.attrs[name];
    return v === undefined ? null : v;
  }

  get isConnected(): boolean {
    return true;
  }

  getBoundingClientRect() {
    return this.visible
      ? { width: 100, height: 20 }
      : { width: 0, height: 0 };
  }

  /** Descendants (not self), matching the handful of selectors we use. */
  querySelectorAll(selector: string): FakeEl[] {
    const wants = selector.split(",").map((s) => s.trim());
    const out: FakeEl[] = [];
    const walk = (el: FakeEl): void => {
      for (const child of el.children) {
        if (wants.some((w) => matches(child, w))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matches(el: FakeEl, sel: string): boolean {
  if (sel === "[data-ai-target]") return el.getAttribute("data-ai-target") !== null;
  const exact = sel.match(/^\[data-ai-target="(.*)"\]$/);
  if (exact) return el.getAttribute("data-ai-target") === exact[1].replace(/\\(.)/g, "$1");
  if (sel === "[role=dialog]") return el.getAttribute("role") === "dialog";
  if (sel === "dialog") return el.tagName.toLowerCase() === "dialog";
  return el.tagName.toLowerCase() === sel;
}

function el(
  tagName: string,
  attrs: FakeAttrs = {},
  text: string | null = null,
  children: FakeEl[] = []
): FakeEl {
  const e = new FakeEl(tagName, attrs, text);
  e.children = children;
  return e;
}

function doc(children: FakeEl[]): FakeEl {
  const root = new FakeEl("#document");
  root.children = children;
  return root;
}

/* ------------------------------------------------------------- generation */

test("a generated manifest says it is a draft, in both places that matter", () => {
  const root = doc([
    el("h1", {}, "Assets"),
    el("button", { "data-ai-target": "upload", "aria-label": "Upload" }),
  ]);
  const { manifest, notes } = generateManifest(root, {
    surface: "org",
    path: "/assets",
  });

  assert.equal(manifest.trust, "generated");
  const upload = findControl(manifest, "upload")!;
  assert.equal(upload.inferred, true);
  // A reviewer must be able to see, without reading code, that nothing here
  // was decided by a person.
  assert.ok(notes.some((n) => n.includes("Generated, not decided")));
});

test("every control is mutates:true, because the walk cannot tell them apart", () => {
  const root = doc([
    el("button", { "data-ai-target": "filter", "aria-label": "Filter" }),
    el("button", { "data-ai-target": "wipe", "aria-label": "Delete everything" }),
  ]);
  const { manifest } = generateManifest(root, { surface: "org" });

  // These two are indistinguishable to a DOM walk: both buttons, both with a
  // word on them. Defaulting to false would make the second freely clickable
  // the moment somebody ran the generator.
  for (const id of ["filter", "wipe"])
    assert.equal(findControl(manifest, id)!.mutates, true, `${id} should default to mutating`);
});

test("a link is not gated, because navigation is already held elsewhere", () => {
  const root = doc([
    el("a", { "data-ai-target": "go-billing", href: "/billing" }, "Billing"),
    el("a", { "data-ai-target": "fake-link" }, "Not really a link"),
  ]);
  const { manifest } = generateManifest(root, { surface: "org" });

  assert.equal(findControl(manifest, "go-billing")!.mutates, false);
  assert.equal(findControl(manifest, "go-billing")!.kind, "link");
  // An anchor with no href is not navigation; it is a button in disguise.
  assert.equal(findControl(manifest, "fake-link")!.mutates, true);
});

test("a dialog becomes a nested view, not more controls on the page", () => {
  const root = doc([
    el("button", { "data-ai-target": "open", "aria-label": "Open" }),
    el(
      "div",
      { role: "dialog", "data-ai-view": "confirm-delete", "aria-label": "Are you sure?" },
      null,
      [el("button", { "data-ai-target": "confirm", "aria-label": "Yes, delete" })]
    ),
  ]);
  const { manifest } = generateManifest(root, { surface: "org", path: "/assets" });

  const views = flattenViews(manifest);
  const dialog = views.find((v) => v.id === "confirm-delete");
  assert.ok(dialog, "the dialog should be its own view");
  // The generalisation past "path = page": this state has no URL.
  assert.equal(dialog!.path, undefined);
  assert.deepEqual(
    dialog!.controls?.map((c) => c.id),
    ["confirm"]
  );
  // And it must NOT also appear on the page, or "click confirm" reads as
  // available when the modal is shut.
  assert.deepEqual(
    manifest.views[0].controls?.map((c) => c.id),
    ["open"]
  );
});

test("truncation is reported, never silent", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    el("button", { "data-ai-target": `b${i}`, "aria-label": `Button ${i}` })
  );
  const { manifest, notes } = generateManifest(doc(many), {
    surface: "org",
    maxControls: 5,
  });

  assert.equal(flattenControls(manifest).length, 5);
  assert.ok(
    notes.some((n) => n.includes("Stopped at 5 controls")),
    "a truncated manifest that does not say so is worse than no manifest"
  );
});

test("an unlabelled control is named, not quietly kept", () => {
  const root = doc([el("button", { "data-ai-target": "mystery" })]);
  const { manifest, notes } = generateManifest(root, { surface: "org" });

  assert.ok(notes.some((n) => n.includes("mystery") && n.includes("label")));
  // It still falls back to the id, so it is at least addressable.
  assert.equal(findControl(manifest, "mystery")!.label, "mystery");
});

test("a surface with nothing tagged says so instead of looking complete", () => {
  const { notes } = generateManifest(doc([el("h1", {}, "Reports")]), {
    surface: "org",
  });
  assert.ok(notes.some((n) => n.includes("No control carries data-ai-target")));
});

test("the hash moves when the structure does, and only then", () => {
  const a = doc([el("button", { "data-ai-target": "x", "aria-label": "X" })]);
  const b = doc([el("button", { "data-ai-target": "x", "aria-label": "Renamed" })]);
  const c = doc([el("button", { "data-ai-target": "y", "aria-label": "X" })]);
  const opts = { surface: "org", now: () => new Date(0) };

  const ha = generateManifest(a, opts).manifest.hash;
  // A label change is not a structural change: the same control is still there.
  assert.equal(generateManifest(b, opts).manifest.hash, ha);
  // A different control is.
  assert.notEqual(generateManifest(c, opts).manifest.hash, ha);
});

/* ----------------------------------------------------------- verification */

const OWNED: SurfaceManifest = {
  surface: "org",
  version: "1",
  trust: "owned",
  views: [
    {
      id: "/assets",
      title: "Assets",
      path: "/assets",
      controls: [
        { id: "upload", label: "Upload", mutates: true },
        { id: "search", label: "Search", mutates: false },
        { id: "delete-all", label: "Delete all", mutates: true, severity: "destructive" },
      ],
    },
  ],
};

test("a declared control that is not in the page is DRIFT, not a detail", () => {
  // `delete-all` is behind a permission this person does not have.
  const root = doc([
    el("button", { "data-ai-target": "upload", "aria-label": "Upload" }),
    el("input", { "data-ai-target": "search", "aria-label": "Search" }),
  ]);

  const drift = verifySurface(OWNED, root);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].kind, "missing");
  assert.equal(drift[0].id, "delete-all");
});

test("a control in the page that nobody declared is reported too", () => {
  const root = doc([
    el("button", { "data-ai-target": "upload", "aria-label": "Upload" }),
    el("input", { "data-ai-target": "search", "aria-label": "Search" }),
    el("button", { "data-ai-target": "delete-all", "aria-label": "Delete all" }),
    el("button", { "data-ai-target": "surprise", "aria-label": "New button" }),
  ]);

  const kinds = verifySurface(OWNED, root).map((d) => `${d.kind}:${d.id}`);
  assert.deepEqual(kinds, ["undeclared:surprise"]);
});

test("a present but invisible control is its own case", () => {
  const hidden = el("button", { "data-ai-target": "delete-all" }, "Delete all");
  hidden.visible = false;
  const root = doc([
    el("button", { "data-ai-target": "upload", "aria-label": "Upload" }),
    el("input", { "data-ai-target": "search", "aria-label": "Search" }),
    hidden,
  ]);

  const drift = verifySurface(OWNED, root);
  assert.deepEqual(
    drift.map((d) => d.kind),
    ["hidden"]
  );
});

/* ------------------------------------------------------------- acting */

test("acting on a control that is not there is refused, with a reason a user can read", () => {
  const root = doc([el("button", { "data-ai-target": "upload", "aria-label": "Upload" })]);
  const decision = canAct(OWNED, "delete-all", root);

  assert.equal(decision.ok, false);
  // The point of returning a reason rather than false: every caller would
  // otherwise write its own explanation, and they would drift apart.
  assert.match(decision.reason!, /not actually here|not available to you/);
});

test("a control nobody declared cannot be acted on by knowing its id", () => {
  const root = doc([el("button", { "data-ai-target": "secret", "aria-label": "Secret" })]);
  const decision = canAct(OWNED, "secret", root);
  assert.equal(decision.ok, false);
  assert.match(decision.reason!, /not declared/);
});

test("mutates decides the confirm, not a hardcoded action list", () => {
  const root = doc([
    el("input", { "data-ai-target": "search", "aria-label": "Search" }),
    el("button", { "data-ai-target": "upload", "aria-label": "Upload" }),
  ]);

  // Under OPERATE_ACTIONS = ["fill","click"], filling this search box was
  // gated exactly as hard as deleting an account. It is a filter.
  assert.equal(canAct(OWNED, "search", root).needsConfirm, false);
  assert.equal(canAct(OWNED, "upload", root).needsConfirm, true);
});

test("an undeclared control is treated as mutating", () => {
  assert.equal(effectiveMutates(OWNED, "nothing-like-this"), true);
});

test("an untrusted manifest can add friction and never remove it", () => {
  const fromCustomer: SurfaceManifest = {
    ...OWNED,
    trust: "untrusted",
    views: [
      {
        id: "/",
        title: "Their site",
        controls: [
          // A customer site asserting its delete button is harmless is a claim
          // about OUR safety model, made by someone who wants fewer prompts.
          { id: "delete-account", label: "Delete account", mutates: false },
          { id: "search", label: "Search", mutates: false },
        ],
      },
    ],
  };

  assert.equal(effectiveMutates(fromCustomer, "delete-account"), true);
  assert.equal(effectiveMutates(fromCustomer, "search"), true);
  // And the same declaration from our own manifest IS believed.
  assert.equal(effectiveMutates(OWNED, "search"), false);
});

test("a generated manifest is believed about mutates:false, since it only says so for links", () => {
  const root = doc([el("a", { "data-ai-target": "go", href: "/x" }, "Go")]);
  const { manifest } = generateManifest(root, { surface: "org" });
  assert.equal(effectiveMutates(manifest, "go"), false);
});

test("hashManifest is stable across calls and orders", () => {
  const views = OWNED.views;
  assert.equal(hashManifest(views), hashManifest(views));
  assert.notEqual(hashManifest(views), hashManifest([]));
});
