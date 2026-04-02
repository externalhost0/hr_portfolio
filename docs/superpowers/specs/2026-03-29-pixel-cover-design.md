# PixelCover Component Design

## Overview

An Astro component that renders an overlay of colored tiles on top of its slotted children. Tiles can be revealed (disappear) or hidden (reappear) via an imperative handle, with configurable tile size, disappearance pattern, and per-tile animation duration.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tileSize` | `number` | required | Width and height of each square tile in px |
| `pattern` | `"random" \| "wave" \| "center"` | `"random"` | Order in which tiles disappear/reappear |
| `tileDuration` | `number` | `150` | Per-tile fade transition in ms. `0` = instant pop, no fade |
| `stagger` | `number` | `30` | Delay in ms between each tile starting its exit/entry |
| `color` | `string` | `"#000000"` | CSS color of the tiles |

## Handle Interface

Defined in `src/components/misc/PixelCover.ts` and attached to the overlay DOM element as `el._pixelCover`.

```ts
export interface PixelCoverHandle {
  reveal(): void;  // tiles disappear → content becomes visible
  hide(): void;    // tiles reappear → content becomes covered
}
```

## HTML Structure

```html
<div class="pixel-cover-wrapper">   <!-- position: relative -->
  <slot />
  <div class="pixel-cover-overlay"> <!-- position: absolute; inset: 0; overflow: hidden; pointer-events: none -->
    <!-- tile divs injected by JS -->
  </div>
</div>
```

The wrapper must have a defined height for the overlay to size correctly.

## Tile Grid

On mount, the script:
1. Measures the overlay's `clientWidth` / `clientHeight`
2. Calculates `cols = Math.ceil(w / tileSize)`, `rows = Math.ceil(h / tileSize)`
3. Creates `rows × cols` `<div>` tiles, each `position: absolute` placed at `left: col * tileSize`, `top: row * tileSize`, sized `tileSize × tileSize`
4. Tiles start fully visible (opacity 1)

## Pattern Logic

Each pattern produces an ordered array of tile indices. `reveal()` uses this order; `hide()` uses it reversed.

- **random**: Fisher-Yates shuffle of all tile indices
- **wave**: sort by column index ascending (left → right sweep)
- **center**: sort by Euclidean distance from grid center, ascending (center clears first)

## Animation

**`reveal()`** — tiles disappear in pattern order:
- If `tileDuration === 0`: hide all tiles synchronously in one frame per their stagger index (no CSS transition, just `opacity: 0` → `display: none` after a `stagger * index` timeout)
- If `tileDuration > 0`: each tile starts fading after `stagger * index` ms delay. Apply `transition: opacity ${tileDuration}ms`, set `opacity: 0`. After transition completes, set `display: none`.

**`hide()`** — tiles reappear in reversed pattern order:
- Restore all tiles (`display: block`, `opacity: 0`), then stagger `opacity → 1` in reversed pattern order using the same `stagger` interval and `tileDuration` transition.
- Calling `hide()` while `reveal()` is in progress (or vice versa) cancels any pending timeouts before starting.

## Files

- `src/components/misc/PixelCover.astro` — component
- `src/components/misc/PixelCover.ts` — `PixelCoverHandle` type export

## Usage Example

```astro
---
import PixelCover from "../misc/PixelCover.astro";
import type { PixelCoverHandle } from "../misc/PixelCover";
---

<PixelCover tileSize={32} pattern="random" tileDuration={150} color="#f53c20" id="cover">
  <div>Content revealed by tiles</div>
</PixelCover>

<script>
  import type { PixelCoverHandle } from "../misc/PixelCover";
  const overlay = document.querySelector(".pixel-cover-overlay") as HTMLElement & { _pixelCover: PixelCoverHandle };
  overlay._pixelCover.reveal();
</script>
```
