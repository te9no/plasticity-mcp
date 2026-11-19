// Checks of the SVG drawing builder on made-up projections. No live Plasticity needed.
// Run with: npx tsx src/drawing.test.ts
import { buildDrawing, ProjectedView } from "./drawing.js";

let failures = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const view = (positions: number[], segments: ProjectedView["segments"]): ProjectedView => ({
  view: "front",
  positions,
  segments,
  mmPerPixel: 1,
});
const visible = "Edge-Visible-NotSmooth";
const hidden = "Edge-Hidden-NotSmooth";

{
  console.log("[polyline]");
  const drawing = buildDrawing([view([0, 0, 10, 0, 10, 5], [{ category: visible, type: 3006, offset: 0, count: 3 }])], true);
  check("drawn as a polyline", drawing.svg.includes('<polyline class="visible" points="0,0 10,0 10,5"/>'));
  check("size from its points", drawing.views[0].sizeMm[0] === 10 && drawing.views[0].sizeMm[1] === 5);
}

{
  console.log("[Bezier]");
  // One quadratic piece: start, control, end. The control point is not on the curve.
  const quadratic = buildDrawing([view([0, 0, 10, 20, 20, 0], [{ category: visible, type: 3009, offset: 0, count: 3 }])], true);
  check("three points: a quadratic piece", quadratic.svg.includes('d="M 0 0 Q 10 20 20 0"'), quadratic.svg.match(/d="[^"]*"/)?.[0]);
  check(
    "measured on the curve, not on the control point",
    quadratic.views[0].sizeMm[0] === 20 && quadratic.views[0].sizeMm[1] === 10,
    quadratic.views[0].sizeMm.join(" x "),
  );

  // Two cubic pieces, the end of the first repeated as the start of the second.
  const chain = [0, 0, 0, 10, 10, 10, 10, 0, 10, 0, 10, -10, 20, -10, 20, 0];
  const cubic = buildDrawing([view(chain, [{ category: hidden, type: 3009, offset: 0, count: 8 }])], true);
  check(
    "a multiple of four: a chain of cubic pieces in one path",
    cubic.svg.includes('<path class="hidden" d="M 0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0"/>'),
    cubic.svg.match(/d="[^"]*"/)?.[0],
  );
  check("counted as one hidden line", cubic.views[0].hiddenLines === 1 && cubic.views[0].visibleLines === 0);
  check("left out with the hidden lines off", (() => {
    try {
      buildDrawing([view(chain, [{ category: hidden, type: 3009, offset: 0, count: 8 }])], false);
      return false;
    } catch (err) {
      return (err as Error).message.includes("no lines to draw");
    }
  })());

  // Pieces that do not meet start a new sub-path.
  const apart = [0, 0, 0, 1, 1, 1, 1, 0, 5, 0, 5, 1, 6, 1, 6, 0];
  const split = buildDrawing([view(apart, [{ category: visible, type: 3009, offset: 0, count: 8 }])], true);
  check("pieces that do not meet: a new start", split.svg.includes('d="M 0 0 C 0 1 1 1 1 0 M 5 0 C 5 1 6 1 6 0"'));

  const fallback = buildDrawing([view([0, 0, 1, 1, 2, 0, 3, 1, 4, 0], [
    { category: visible, type: 3009, offset: 0, count: 5 },
  ])], true);
  check("five control points use the polyline fallback", fallback.svg.includes('d="M 0 0 L 1 1 L 2 0 L 3 1 L 4 0"'));
  check("fallback bounds include the first point", fallback.views[0].sizeMm.join(",") === "4,1");
}

{
  console.log("[unknown type]");
  let refused = "";
  try {
    buildDrawing([view([0, 0, 1, 1], [{ category: visible, type: 3999, offset: 0, count: 2 }])], true);
  } catch (err) {
    refused = (err as Error).message;
  }
  check("refused with its code", refused.includes("3999"), refused);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll drawing checks passed.");
