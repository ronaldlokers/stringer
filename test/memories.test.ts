/**
 * On this day.
 *
 * The selection is the only part with judgement in it: six photographs from one
 * afternoon in 2019 is a worse morning than one from each of six years, so the
 * choice is a round-robin across years rather than the best of the pile.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SHOWN, choose, summarise, yearsOf, type Photo } from "../src/copy/immich/memories.js";
import { collageSheet } from "../src/press/immich/sheet.js";
import { HEIGHT, WIDTH } from "../src/press/tokens.js";

function photo(year: number, hour = 12): Photo {
  return { id: `${year}-${hour}`, year, at: Date.UTC(year, 7, 14, hour) };
}

describe("choosing what to show", () => {
  it("takes one from each year before taking a second from any", () => {
    const photos = [photo(2019, 9), photo(2019, 10), photo(2019, 11), photo(2021, 9)];
    assert.deepEqual(choose(photos, 2).map((p) => p.year), [2021, 2019]);
  });

  it("fills from the years it has when there are fewer than six", () => {
    const photos = [photo(2019, 9), photo(2019, 10), photo(2021, 9)];
    assert.equal(choose(photos).length, 3);
  });

  it("never returns more than the grid holds", () => {
    const photos = Array.from({ length: 40 }, (_, i) => photo(2015 + (i % 8), i));
    assert.equal(choose(photos).length, SHOWN);
  });

  it("puts the most recent year first, because it is the one you recognise", () => {
    const chosen = choose([photo(2017), photo(2024), photo(2020)]);
    assert.equal(chosen[0]!.year, 2024);
  });

  it("orders within a year by when it was taken", () => {
    const chosen = choose([photo(2019, 18), photo(2019, 8)], 2);
    assert.deepEqual(chosen.map((p) => p.at), [Date.UTC(2019, 7, 14, 8), Date.UTC(2019, 7, 14, 18)]);
  });

  it("returns nothing for a day with nothing", () => {
    assert.deepEqual(choose([]), []);
    assert.deepEqual(yearsOf([]), []);
  });
});

describe("the log line", () => {
  // Not the sheet: it carried "26 photographs, from 6 years" and read as an
  // inventory of something that is not an inventory. Every photograph already
  // wears its year.
  it("counts photographs and years", () => {
    assert.equal(summarise(26, [2024, 2017]), "26 photographs across 2 years");
  });

  it("does not pluralise one of either", () => {
    assert.equal(summarise(1, [2019]), "1 photograph across 1 year");
  });
});

describe("the sheet", () => {
  // A one-pixel JPEG is enough: what is being checked is the markup around it.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  it("embeds each photograph and crops it to fill its cell", () => {
    const svg = collageSheet([{ photo: photo(2019), jpeg }], new Date(Date.UTC(2026, 7, 14)));
    assert.match(svg, /href="data:image\/jpeg;base64,/);
    assert.match(svg, /preserveAspectRatio="xMidYMid slice"/);
  });

  it("names the day in words and the year on each photograph", () => {
    const svg = collageSheet([{ photo: photo(2019), jpeg }], new Date(Date.UTC(2026, 7, 14)));
    assert.match(svg, /14 august, in other years/);
    assert.match(svg, />2019</);
  });

  it("draws only what the grid holds, however many are handed over", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ photo: photo(2010 + i), jpeg }));
    const svg = collageSheet(many, new Date(Date.UTC(2026, 7, 14)));
    assert.equal([...svg.matchAll(/<image /g)].length, 6);
  });

  it("stays inside the canvas", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ photo: photo(2010 + i), jpeg }));
    const svg = collageSheet(many, new Date(Date.UTC(2026, 7, 14)));
    for (const match of svg.matchAll(/<image x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      assert.ok(Number(match[1]) + Number(match[3]) <= WIDTH, "a photograph runs off the side");
      assert.ok(Number(match[2]) + Number(match[4]) <= HEIGHT, "a photograph runs off the bottom");
    }
  });
});
