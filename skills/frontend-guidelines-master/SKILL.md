---
name: "frontend-guidelines-master"
description: "Opinionated, terse principles for writing clean HTML, CSS, and JavaScript — semantics, accessibility, performance, low-specificity CSS, transform-only animation, and stateless/functional JS. Use when authoring or reviewing frontend code, untangling CSS specificity, or replacing imperative loops and bind/apply with native and functional patterns."
trigger: "/frontend-guidelines-master"
---

# Frontend Guidelines

> Adapted from Ben Delarre's frontend-guidelines (https://github.com/bendc/frontend-guidelines).
> The principles below are paraphrased and re-illustrated with original examples; no text or code
> from the source is reproduced verbatim.

A compact rulebook for hand-written HTML, CSS, and JavaScript. Each rule states the intent, then
shows a weaker form against a preferred form. Optimize for clarity and maintainability first.

## HTML

### Use the right element for the job

The element vocabulary describes meaning, not just layout. Reach for the tag that names what the
content _is_ before falling back to a generic container.

```html
<!-- weak: every box is a div -->
<div class="post">
  <div class="meta">
    <h2>Release notes</h2>
    <span>Mar 4, 2026</span>
  </div>
  <div class="body">…</div>
</div>

<!-- preferred: structure carries meaning -->
<article class="post">
  <header class="meta">
    <h2>Release notes</h2>
    <time datetime="2026-03-04">Mar 4, 2026</time>
  </header>
  <div class="body">…</div>
</article>
```

A misapplied semantic element is worse than a neutral container. If a tag's meaning doesn't match
the content, don't force it.

```html
<!-- weak: a logo is not a paragraph of emphasis -->
<strong><img src="brand.svg" alt="Acme" /></strong>

<!-- preferred: just the image, with a real alt -->
<img src="brand.svg" alt="Acme" />
```

### Keep the markup lean

Drop boilerplate the parser doesn't need. Modern HTML lets you omit redundant attributes and some
closing tags; quoting and explicit types are optional where they add nothing.

```html
<!-- weak: ceremony left over from XHTML -->
<input type="text" required="required" autocomplete="off" />

<!-- preferred -->
<input type="text" required autocomplete="off" />
```

### Treat accessibility as table stakes

You don't need to memorize the spec to make real gains. A few habits cover most cases:

- write `alt` text that conveys purpose, not "image of …"
- use real `<button>` and `<a>` so keyboard and screen-reader behavior comes for free
- never encode meaning in color alone — pair it with text, shape, or an icon
- bind every form control to a label

```html
<!-- weak: a clickable div has no role, no focus, no keyboard -->
<div class="btn" onclick="save()">Save</div>

<!-- preferred -->
<button type="button" onclick="save()">Save</button>
```

### Declare language and encoding

Set the document language on the root element and declare UTF-8 at the top of the document, even
when a server header also sends it. Both belong on the page itself.

```html
<!doctype html>
<html lang="en">
  <meta charset="utf-8" />
  <title>Status</title>
</html>
```

### Don't let scripts block first paint

Content should reach the user before non-essential scripts run. Put deferred or analytics-style
scripts after the content (or use `defer`), and inline only the styles needed for the first view.

```html
<!-- weak: analytics blocks the page -->
<head>
  <script src="analytics.js"></script>
  <title>Status</title>
</head>
<body>
  <p>…</p>
</body>

<!-- preferred: content first, script last -->
<head>
  <title>Status</title>
</head>
<body>
  <p>…</p>
  <script src="analytics.js" defer></script>
</body>
```

## CSS

### Set the box model once, globally

Pick one box model for the whole document with a single universal rule, then stop fiddling with it
per element. Per-element overrides make sizing unpredictable.

```css
/* once, at the top of the sheet */
*,
*::before,
*::after {
  box-sizing: border-box;
}

/* then just author padding without re-declaring the model */
.card {
  padding: 1rem;
}
```

### Stay in the normal flow

Default display and positioning are usually what you want. Don't change `display` or pull elements
out with absolute positioning unless the layout genuinely requires it.

```css
/* weak: absolute positioning to push right */
.badge {
  position: absolute;
  right: 0;
}

/* preferred: let auto margins do it in flow */
.badge {
  margin-left: auto;
}
```

Prefer Flexbox and Grid for layout over taking elements off the flow.

### Keep selectors shallow and decoupled

Long chains of combinators and structural pseudo-classes tie your CSS to a fragile DOM shape. When
a selector grows past a few combinators, add a class to the target instead.

```css
/* weak: brittle, coupled to structure */
section > ul li:first-child > a ~ span { … }

/* preferred: name the thing you mean */
.nav-label { … }
```

Don't over-qualify when the extra specificity buys nothing.

```css
/* weak */
ul > li:first-child { … }

/* preferred */
ul > :first-child { … }
```

### Keep specificity low and overridable

Avoid `!important` and `#id` selectors — they make later styles hard to override and turn debugging
into a fight. Reach the weight you need by combining classes, not by escalating.

```css
/* weak: now everything below has to shout louder */
.cta {
  color: green !important;
}

/* preferred: a more specific class composition */
.btn.cta {
  color: green;
}
.btn {
  color: gray;
}
```

### Write rules so you rarely override them

Structure your selectors so the common case is the rule and the exception is small, instead of
setting a value everywhere and clawing it back.

```css
/* weak: set on all, then undo the first */
li {
  display: none;
}
li:first-child {
  display: block;
}

/* preferred: target only the ones you mean to hide */
li + li {
  display: none;
}
```

### Lean on inheritance

If a property inherits, declare it once on a common ancestor rather than repeating it on each child.

```css
/* weak */
.card h2,
.card p {
  font-family: Inter, sans-serif;
}

/* preferred */
.card {
  font-family: Inter, sans-serif;
}
```

### Be terse: shorthands and computed values

Use shorthand properties and compute related values inline instead of stacking longhand
declarations or extra helper offsets.

```css
/* weak */
.box {
  padding-top: 4px;
  padding-right: 8px;
  padding-bottom: 16px;
  padding-left: 8px;
  top: 50%;
  margin-top: -10px;
}

/* preferred */
.box {
  padding: 4px 8px 16px;
  top: calc(50% - 10px);
}
```

### Say what you mean

Use the readable form of a value when one exists — keyword selectors, named rotations — over the
equivalent arithmetic.

```css
/* weak */
:nth-child(2n + 1) {
  transform: rotate(360deg);
}

/* preferred */
:nth-child(odd) {
  transform: rotate(1turn);
}
```

### Prune dead vendor prefixes

Drop prefixes that no current browser needs. When a prefix is still required, write it before the
standard property so the standard one wins.

```css
/* preferred: prefixed first, standard last, nothing obsolete */
.scale {
  -webkit-mask-image: linear-gradient(black, transparent);
  mask-image: linear-gradient(black, transparent);
}
```

### Animate only what's cheap to animate

Prefer transitions to keyframe animations, and restrict what you animate to `opacity` and
`transform`. Animating layout properties forces reflow and stutters.

```css
/* weak: animating margin reflows the page */
.panel:hover {
  animation: slide 0.3s forwards;
}
@keyframes slide {
  to {
    margin-left: 120px;
  }
}

/* preferred: transform is composited, no reflow */
.panel {
  transition: transform 0.3s;
}
.panel:hover {
  transform: translateX(120px);
}
```

### Prefer sensible units

Drop the unit on zero. For relative sizing favor `rem`; for line height a unitless multiplier; for
durations seconds read more naturally than milliseconds.

```css
/* weak */
.t {
  margin: 0px;
  font-size: 14px;
  line-height: 20px;
  transition: 300ms;
}

/* preferred */
.t {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  transition: 0.3s;
}
```

### Color format

Use a hex value for opaque colors and `rgb()` with an alpha channel only when you need
transparency.

```css
/* opaque */
.ok {
  color: #4caf50;
}

/* needs transparency */
.veil {
  background: rgb(0 0 0 / 0.5);
}
```

### Draw simple shapes in CSS, don't fetch them

A circle, dot, or triangle is cheaper to draw with a pseudo-element than to download as an image.
Save the HTTP request.

```css
/* weak: a network request for a dot */
.status::before {
  content: url(dot.svg);
}

/* preferred */
.status::before {
  content: "";
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: currentColor;
}
```

### Avoid hacks

Skip magic declarations whose only job is to trip a rendering quirk. If you need a compositing hint,
say so explicitly, and use real CSS comments.

```css
/* weak: opaque trick + JS-style comment */
.layer {
  // bump to its own layer
  transform: translateZ(0);
}

/* preferred: intent is stated, comment is valid CSS */
.layer {
  /* promote to its own compositing layer */
  will-change: transform;
}
```

## JavaScript

### Readability beats micro-performance

JS is almost never the bottleneck — network, images, and DOM reflow are. Write the clear version;
optimize bytes on the wire and layout thrash instead. If you take one rule from here, take this one.

```javascript
// weak: hand-rolled loop chasing speed nobody will notice
function evenSquares(nums) {
  let out = [];
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] % 2 === 0) out.push(nums[i] * nums[i]);
  }
  return out;
}

// preferred: intent is obvious
const evenSquares = (nums) => nums.filter((n) => n % 2 === 0).map((n) => n * n);
```

### Keep functions pure

Aim for functions with no side effects: don't read hidden outside state, and return fresh values
instead of mutating the inputs.

```javascript
// weak: mutates the first argument
const apply = (state, patch) => Object.assign(state, patch);

// preferred: returns a new object
const apply = (state, patch) => ({ ...state, ...patch });
```

### Reach for native methods first

The standard library covers most of what you'd otherwise hand-write. Use it before reinventing it.

```javascript
// weak: manual array-like conversion
const toArray = (nodeList) => Array.prototype.slice.call(nodeList);

// preferred
const toArray = (nodeList) => Array.from(nodeList);
```

### Use coercion deliberately

Implicit coercion is fine when it reads clearly and dangerous when it surprises. A loose equality
check against `null` catches both `null` and `undefined`; reserve the trick for cases where that's
exactly the intent.

```javascript
// verbose
if (value === null || value === undefined) {
  /* … */
}

// concise, when the two-value check is the actual goal
if (value == null) {
  /* … */
}
```

### Replace loops with array methods

Imperative loops push you toward mutable accumulators. Most loops are really a `map`, `filter`, or
`reduce`.

```javascript
// weak
function total(nums) {
  let sum = 0;
  for (const n of nums) sum += n;
  return sum;
}

// preferred
const total = (nums) => nums.reduce((a, b) => a + b, 0);
```

When an array method would be a stretch, recursion is clearer than a mutable loop.

```javascript
// preferred: no mutable counter
const repeat = (fn, times) => {
  if (times <= 0) return;
  fn();
  repeat(fn, times - 1);
};
```

### Prefer rest parameters to `arguments`

The rest parameter is named (self-documenting) and is a genuine array, so array methods just work.

```javascript
// weak
function maxOf() {
  return Math.max.apply(null, Array.prototype.slice.call(arguments));
}

// preferred
const maxOf = (...nums) => Math.max(...nums);
```

### Spread instead of `apply`

Spreading an array into a call is clearer than threading it through `apply`.

```javascript
const point = [3, 7];
const place = (x, y) => `${x},${y}`;

// weak
place.apply(null, point);

// preferred
place(...point);
```

### Avoid `bind` when an idiom exists

Arrow functions capture `this` lexically, so you rarely need `bind` to preserve context inside a
method.

```javascript
// weak
const counter = {
  count: 0,
  start() {
    const tick = function () {
      this.count++;
    }.bind(this);
    setInterval(tick, 1000);
  },
};

// preferred
const counter = {
  count: 0,
  start() {
    setInterval(() => {
      this.count++;
    }, 1000);
  },
};
```

### Don't wrap a function that's already the function you want

If a callback just forwards its argument to another function with the same shape, pass that
function directly.

```javascript
// weak
["1", "2", "3"].map((s) => Number(s));

// preferred
["1", "2", "3"].map(Number);
```

### Compose instead of nesting calls

Deeply nested calls read inside-out. A small composition helper reads left-to-right.

```javascript
const inc = (n) => n + 1;
const double = (n) => n * 2;

// weak
double(inc(5)); // 12

// preferred
const pipe =
  (...fns) =>
  (x) =>
    fns.reduce((acc, fn) => fn(acc), x);
const incThenDouble = pipe(inc, double);
incThenDouble(5); // 12
```

### Cache expensive work

Feature checks, big lookups, and other costly setup should run once and be reused, not repeated on
every call.

```javascript
// weak: probes support on every call
const supportsClipboard = () => "clipboard" in navigator;

// preferred: resolve once
const supportsClipboard = (() => "clipboard" in navigator)();
```

### Prefer `const`, then `let`, never `var`

Default to `const`. Use `let` only when you must reassign. `var` has no place in new code.

```javascript
// preferred
const ids = new Set();
let attempts = 0;
```

### Prefer expressions to statement ladders

An IIFE with early returns reads better than a mutable variable threaded through `if/else if/else`.

```javascript
// weak
let tier;
if (score < 50) tier = "low";
else if (score < 90) tier = "mid";
else tier = "high";

// preferred
const tier = (() => {
  if (score < 50) return "low";
  if (score < 90) return "mid";
  return "high";
})();
```

### Avoid `for...in` for own properties

`for...in` walks the prototype chain. Iterate the keys you actually own.

```javascript
// weak
for (const key in obj) {
  if (Object.hasOwn(obj, key)) handle(key);
}

// preferred
Object.keys(obj).forEach(handle);
```

### Use a `Map` for dynamic key/value data

When keys are added, removed, or counted at runtime, `Map` is clearer than poking properties onto a
plain object — and `.size` is built in.

```javascript
// weak
const seen = {};
seen["a"] = 1;
Object.keys(seen).length; // 1

// preferred
const seen = new Map();
seen.set("a", 1);
seen.size; // 1
```

### Don't over-curry

Currying has its place, but those places are uncommon. Don't split arguments into a chain of
single-argument functions out of habit.

```javascript
// weak
const add = (a) => (b) => a + b;
add(2)(3);

// preferred
const add = (a, b) => a + b;
add(2, 3);
```

### Write the obvious form, not the clever one

Short-circuit side effects, bitwise floor tricks, and similar cleverness hide intent. Spell it out.

```javascript
// weak
ready && init();
const n = ~~3.9;

// preferred
if (ready) init();
const n = Math.trunc(3.9);
```

### Build small, reusable functions

Tiny composable helpers beat repeated inline expressions. Name the operation once and reuse it.

```javascript
// weak
const lastItem = list[list.length - 1];

// preferred
const last = (arr) => arr[arr.length - 1];
last(list);
```

### Keep dependencies minimal

A third-party package is code you don't own. Don't pull in a whole library for a one-liner you can
write yourself.

```javascript
// weak
import uniq from "lodash/uniq";
uniq([1, 1, 2]);

// preferred
const uniq = (arr) => [...new Set(arr)];
uniq([1, 1, 2]);
```

---

Adapted from Ben Delarre's frontend-guidelines (https://github.com/bendc/frontend-guidelines).
