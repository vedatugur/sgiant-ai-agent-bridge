# sgiant-ai-agent-bridge

Make any web page **AI-operable**: let an assistant see the controls on a page
and drive them — highlight, scroll, focus, fill, click — while the user watches
each action happen.

Zero dependencies. No React, no framework, ~730 lines of TypeScript. Works
same-origin or cross-origin.

```bash
npm install sgiant-ai-agent-bridge
```

## The idea

An AI that can only talk is stuck describing where a button is. This library
lets it press the button — without ever handing the model a CSS selector.

There are two halves, and they talk over `postMessage`:

| half                        | runs in                | job                                          |
| --------------------------- | ---------------------- | -------------------------------------------- |
| `mountAiAgent()`            | the page being driven  | publish what's operable, execute the actions |
| `createFrameTransport(el)`  | the parent embedding it | read the catalog, send actions               |

## Mark what the AI may touch

One attribute. That's the whole authoring surface:

```html
<button data-ai-target="save-profile">Save</button>
<input data-ai-target="hotel-name" aria-label="Hotel name" />
```

Anything without `data-ai-target` is invisible to the bridge and cannot be
acted on.

## In the page

```js
import { mountAiAgent } from "sgiant-ai-agent-bridge";

mountAiAgent();
```

That's it. It re-scans as the DOM changes and republishes the catalog.

**It is a no-op when the page is not framed** — it returns an inert handle and
installs nothing — so it is safe to call unconditionally at startup rather than
guarding it behind "am I embedded?".

By default only the page's **own origin** may drive it. To let an external
embedder in, say so explicitly:

```js
mountAiAgent({ allowedOrigins: ["https://app.example.com"] });
```

## In the parent

```js
import { createFrameTransport } from "sgiant-ai-agent-bridge";

const bridge = createFrameTransport(iframeEl, {
  targetOrigin: "https://site.example.com",
  onTargets: (targets) => console.log("operable now:", targets),
});

await bridge.act("fill",  { target: "hotel-name", value: "Seaside Inn" });
await bridge.act("click", { target: "save-profile" });
```

`act()` resolves with `{ ok, message? }` — the agent's own result, not a guess
— so a model can be told whether what it tried actually worked.

### The five actions

`highlight` · `scroll-to` · `focus-field` · `fill` · `click`

Navigation is deliberately **not** one of them: the parent owns the frame's
URL, so it changes the page itself rather than asking the page to move.

## Security

The design assumption is that the driven page does not trust the embedder, and
the embedder does not trust the page.

- **Selectors never cross the wire.** A parent sends a `data-ai-target` id and
  nothing else. There is no message that can express "click the third div" —
  so a compromised parent, or a model that has been talked into something,
  cannot reach a control the page never marked.
- **Origins are allow-listed on both sides,** and default to same-origin. An
  external embedder is opt-in, and granting it is granting page control.
- **Every message is channel- and version-tagged,** so unrelated `postMessage`
  traffic is ignored rather than parsed.

## Using it without an iframe

If your parent is same-origin, you can skip the `postMessage` hop entirely and
call the DOM primitives directly — `scanAiTargets()`, `runUiControl()`,
`runOperateAction()`, `clearHighlight()`. They are exported for exactly that.

## Browsers

The published ESM carries fully-extensioned relative imports, so it loads in a
browser directly from `dist/index.js` with no bundler and no import map. It
also works as an ordinary npm dependency in Vite, Next, webpack, or esbuild.

## Licence

MIT © Vedat Aydın Uğur
