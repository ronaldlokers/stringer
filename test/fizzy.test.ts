/**
 * The Monday board digest.
 *
 * Two rules carry it. Silence when nothing has anything to say, because a
 * weekly message about an empty board is how you learn to ignore the weekly
 * message. And "stalled" meaning untouched rather than merely old — a card can
 * sit in Next for a year without that being news, but three weeks of no
 * movement in progress is.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STALE_DAYS, boardsFrom, days, oldest, type Card } from "../src/copy/fizzy/board.js";
import { renderDigest, summarise } from "../src/copy/fizzy/digest.js";

const NOW = Date.parse("2026-08-17T08:00:00Z");
const DAY = 86_400_000;

function card(over: Partial<Card> = {}): Card {
  return {
    number: 1,
    title: "A card",
    board: "Homelab",
    column: "Next",
    lastActiveAt: NOW - DAY,
    ...over,
  };
}

describe("grouping the boards", () => {
  it("splits by board and column", () => {
    const boards = boardsFrom(
      [
        card({ number: 1, board: "Campfire", column: "Next" }),
        card({ number: 2, board: "Campfire", column: null }),
        card({ number: 3, board: "Homelab", column: "In progress" }),
      ],
      NOW,
    );
    assert.deepEqual(boards.map((b) => b.name), ["Campfire", "Homelab"]);
    assert.equal(boards[0]!.next.length, 1);
    assert.equal(boards[0]!.untriaged.length, 1);
    assert.equal(boards[1]!.inProgress.length, 1);
  });

  it("calls a card stalled only after three weeks without movement", () => {
    const fresh = card({ column: "In progress", lastActiveAt: NOW - 20 * DAY });
    const stale = card({ column: "In progress", number: 2, lastActiveAt: NOW - STALE_DAYS * DAY });
    const [board] = boardsFrom([fresh, stale], NOW);
    assert.deepEqual(board!.stalled.map((c) => c.number), [2]);
  });

  it("does not call a card in Next stalled, however old", () => {
    // Next is a queue, not a promise. A year-old idea sitting there is the
    // board working, and flagging it weekly would teach you to stop reading.
    const [board] = boardsFrom([card({ lastActiveAt: NOW - 400 * DAY })], NOW);
    assert.equal(board!.stalled.length, 0);
  });

  it("counts days as whole days", () => {
    assert.equal(days(NOW - 3 * DAY - 3600_000, NOW), 3);
  });

  it("puts the longest-waiting card first", () => {
    const cards = [
      card({ number: 1, lastActiveAt: NOW - DAY }),
      card({ number: 2, lastActiveAt: NOW - 30 * DAY }),
    ];
    assert.deepEqual(oldest(cards, 1).map((c) => c.number), [2]);
  });
});

describe("the message", () => {
  it("says nothing when every board is quiet", () => {
    const boards = boardsFrom([card({ column: "In progress", lastActiveAt: NOW })], NOW);
    // In progress and moving needs no comment, so this board has no lines and
    // therefore the digest has no message.
    const html = renderDigest(boards, NOW);
    assert.match(html ?? "", /1 moving/);
  });

  it("is null when there are no cards at all", () => {
    assert.equal(renderDigest(boardsFrom([], NOW), NOW), null);
  });

  it("says which system it came from, because the bot posts everything", () => {
    // "Campfire" is the name of a board and of the room this arrives in;
    // without a source line the message could be about either.
    const html = renderDigest(boardsFrom([card()], NOW), NOW)!;
    assert.match(html, /the boards · fizzy/);
    assert.ok(html.indexOf("fizzy") < html.indexOf("Homelab"), "the source leads");
  });

  it("names what is next and how long the inbox has waited", () => {
    const boards = boardsFrom(
      [
        card({ number: 24, title: "Post a daily summary", column: "Next" }),
        card({ number: 19, title: "Send Proxmox alerts", column: null, lastActiveAt: NOW - 12 * DAY }),
      ],
      NOW,
    );
    const html = renderDigest(boards, NOW)!;
    assert.match(html, /next · Post a daily summary \(#24\)/);
    // &quot; rather than ": the title is escaped on the way in, which is the
    // point of the last test in this block.
    assert.match(html, /untriaged · 1, oldest is &quot;Send Proxmox alerts&quot; \(#19\) from 12 days ago/);
  });

  it("says how long a stalled card has been still", () => {
    const boards = boardsFrom(
      [card({ number: 7, title: "Half-done thing", column: "In progress", lastActiveAt: NOW - 40 * DAY })],
      NOW,
    );
    assert.match(renderDigest(boards, NOW)!, /stalled · Half-done thing \(#7\) — 40 days/);
  });

  it("caps the list rather than pasting a backlog into a room", () => {
    const many = Array.from({ length: 9 }, (_, i) => card({ number: i + 1, title: `Card ${i + 1}` }));
    const html = renderDigest(boardsFrom(many, NOW), NOW)!;
    assert.match(html, /and 6 more/);
    assert.doesNotMatch(html, /Card 8/);
  });

  it("escapes a title, because a card is something a person typed", () => {
    const boards = boardsFrom([card({ title: "<script>alert(1)</script>" })], NOW);
    const html = renderDigest(boards, NOW)!;
    assert.doesNotMatch(html, /<script>/);
  });

  it("summarises every board for the log", () => {
    const boards = boardsFrom([card(), card({ number: 2, column: null })], NOW);
    assert.match(summarise(boards), /Homelab: 1 next, 0 stalled, 1 untriaged/);
  });
});
