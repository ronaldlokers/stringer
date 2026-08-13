/**
 * The sheets come out as well-formed PNGs, at the size Campfire shows them,
 * with nothing running off the edge.
 *
 * The layout wraps computed sentences using its own metrics table, so the
 * check that matters is that every line it produces actually fits the measure
 * it wrapped to. A sentence one word too long does not crash; it just walks
 * off the sheet, on whichever morning the wording happens to run long.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { Day, Reading } from "../src/copy/glucose/bands.js";
import { findings, outliers } from "../src/copy/glucose/findings.js";
import { renderDay, renderFortnight } from "../src/press/render.js";
import { daySheet, fortnightSheet } from "../src/press/sheets.js";
import { width, wrap } from "../src/press/svg.js";
import { HEIGHT, LAYOUT, MARGIN, WIDTH } from "../src/press/tokens.js";

const NAMES = ["ordinary", "spike", "low", "flat"] as const;

function fixture(name: string): Day[] {
  const path = fileURLToPath(new URL(`./golden/${name}.json`, import.meta.url));
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return raw.days.map((day: { label: string; readings: number[][] }) => ({
    label: day.label,
    readings: day.readings.map(([minute, value]) => [minute, value] as Reading),
  }));
}

function pngSize(png: Uint8Array): [number, number] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(0), 0x89504e47, "not a PNG");
  // IHDR is the first chunk: 8 bytes signature, 4 length, 4 tag, then w and h.
  return [view.getUint32(16), view.getUint32(20)];
}

describe("the sheets", () => {
  for (const name of NAMES) {
    it(`draws the daily sheet for ${name}`, () => {
      const png = renderDay(fixture(`fortnight-${name}`));
      assert.deepEqual(pngSize(png), [WIDTH, HEIGHT]);
    });
  }

  it("draws the fortnight sheet", () => {
    const png = renderFortnight(fixture("fortnight-ordinary"));
    assert.deepEqual(pngSize(png), [WIDTH, HEIGHT]);
  });

  it("names both faces, so a substitution is visible in the markup", () => {
    const svg = fortnightSheet(fixture("fortnight-ordinary"));
    assert.match(svg, /font-family="URW Gothic"/);
    assert.match(svg, /font-family="JetBrains Mono"/);
  });
});

describe("nothing runs off the sheet", () => {
  const measure = WIDTH - 2 * MARGIN;

  it("wraps every headline within the measure", () => {
    for (const name of NAMES) {
      const days = fixture(`fortnight-${name}`);
      for (const [key, sentence] of [findings(days)[0]!, outliers(days)[0]!]) {
        for (const line of wrap("headline", `${key} ${sentence}`, measure)) {
          assert.ok(
            width("headline", line) <= measure,
            `${name}: "${line}" is ${Math.round(width("headline", line))} wide`,
          );
        }
      }
    }
  });

  it("wraps every finding within its column", () => {
    const column = WIDTH - MARGIN - 250;
    for (const name of NAMES) {
      const days = fixture(`fortnight-${name}`);
      for (const [, sentence] of [...findings(days), ...outliers(days)]) {
        for (const line of wrap("body", sentence, column)) {
          assert.ok(width("body", line) <= column, `${name}: "${line}"`);
        }
      }
    }
  });

  it("never lets the findings reach the figures", () => {
    // The collision this exists for was shipped and running in the Python:
    // whenever the first finding wrapped, the second was drawn across the foot
    // rule and the numbers beneath it. The port reproduced it exactly.
    for (const name of NAMES) {
      const svg = daySheet(fixture(`fortnight-${name}`));
      const baselines = [...svg.matchAll(/<text x="\d+" y="([\d.]+)"[^>]*font-size="30"/g)]
        .map((match) => Number(match[1]))
        .filter((y) => y > LAYOUT.dayFindings);
      for (const y of baselines) {
        assert.ok(y < LAYOUT.foot, `${name}: a finding sits at ${y}, the foot is ${LAYOUT.foot}`);
      }
    }
  });

  it("keeps a finding that fits", () => {
    // The over-correction: measuring the row advance rather than the ink
    // dropped "the night" from an ordinary day, where it sits clear of the
    // foot with room to spare.
    const svg = daySheet(fixture("fortnight-flat"));
    const bodies = [...svg.matchAll(/font-size="30"[^>]*>([^<]+)</g)].map((m) => m[1]);
    assert.ok(
      bodies.some((line) => line?.includes("the same as every day")),
      "the second finding should still be drawn",
    );
  });

  it("keeps every drawn x inside the canvas", () => {
    for (const build of [fortnightSheet, daySheet]) {
      const svg = build(fixture("fortnight-ordinary"));
      for (const match of svg.matchAll(/x="(-?[\d.]+)"/g)) {
        const x = Number(match[1]);
        assert.ok(x >= 0 && x <= WIDTH, `x=${x} is outside the sheet`);
      }
    }
  });
});
