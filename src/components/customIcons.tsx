// Glyphs drawn for SkyTrace where Font Awesome Free has no fitting shape (or
// none worth a dependency on a full download). Same createIcon contract as
// the generated icons.tsx, which scripts/build-icons.mjs overwrites.
import { createIcon } from "./Icon";

export const Plus = createIcon("Plus", "0 0 448 512", ["M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z"]);
export const Minus = createIcon("Minus", "0 0 448 512", ["M432 256c0 17.7-14.3 32-32 32L48 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l352 0c17.7 0 32 14.3 32 32z"]);
/** Two stops joined by a winding path. */
export const Route = createIcon("Route", "0 0 512 512", [
  "M96 336a56 56 0 1 1 0 112 56 56 0 1 1 0-112z",
  "M416 64a56 56 0 1 1 0 112 56 56 0 1 1 0-112z",
  "M152 376h128a40 40 0 0 0 0-80h-48a88 88 0 0 1 0-176h96v48h-96a40 40 0 0 0 0 80h48a88 88 0 0 1 0 176H152z",
]);
export const Sliders = createIcon("Sliders", "0 0 512 512", [
  "M32 80h128v48H32zM224 56a48 48 0 1 0 0 96 48 48 0 1 0 0-96zM272 80h208v48H272z",
  "M32 232h240v48H32zM320 208a48 48 0 1 0 0 96 48 48 0 1 0 0-96zM368 232h112v48H368z",
  "M32 384h80v48H32zM160 360a48 48 0 1 0 0 96 48 48 0 1 0 0-96zM208 384h272v48H208z",
]);
export const List = createIcon("List", "0 0 512 512", [
  "M32 88a40 40 0 1 1 80 0 40 40 0 1 1-80 0zM160 64h320v48H160zM32 256a40 40 0 1 1 80 0 40 40 0 1 1-80 0zM160 232h320v48H160zM32 424a40 40 0 1 1 80 0 40 40 0 1 1-80 0zM160 400h320v48H160z",
]);
/** Points down (towards the south): rotated by the METAR wind direction it shows where the wind blows. */
export const WindArrow = createIcon("WindArrow", "0 0 384 512", [
  "M192 480 32 304h112V32h96v272h112z",
]);
/** A runway seen from above, threshold bars at each end. */
export const RunwayIcon = createIcon("RunwayIcon", "0 0 512 512", [
  "M200 16h112l40 480H160zM240 64v48h32V64zm0 112v64h32v-64zm0 128v64h32v-64zm0 128v32h32v-32z",
]);
