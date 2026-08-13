/**
 * The desk contract, and who is allowed to spend money.
 *
 * The rules under test are Campfire's, not ours: the answer is the response
 * body, a non-200 carrying a Content-Type is uploaded into the room as an
 * attachment, and there are seven seconds before Campfire posts its own
 * failure notice over the top.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redact } from "../src/copy/cluster/redact.js";
import { renderWhy } from "../src/copy/cluster/triage.js";
import { CampfireDesk, questionFrom } from "../src/desks/campfire.js";

const BASE = "http://campfire.test";

function payload(plain: string, userId: number | string = 1) {
  return {
    user: { id: userId, name: "ronald" },
    room: { name: "Kubernetes", path: "/rooms/1/9-Ab3dEf9hIj2k/messages" },
    message: { body: { plain } },
  };
}

describe("reading a mention", () => {
  it("takes the verb and its arguments, mention already stripped", () => {
    const question = questionFrom(payload("Restart database/pgadmin"), BASE);
    assert.deepEqual(question.words, ["restart", "database/pgadmin"]);
    assert.equal(question.asker.id, "1");
    assert.equal(question.room, "Kubernetes");
  });

  it("offers a way back, built from the room path in the payload", () => {
    // The path already embeds the bot key, so the asynchronous reply needs no
    // credential of its own and can only reach the room that asked.
    assert.ok(questionFrom(payload("why"), BASE).later);
  });

  it("offers none when the payload carries no room path", () => {
    const question = questionFrom({ user: { id: 1 }, message: { body: { plain: "why" } } }, BASE);
    assert.equal(question.later, null);
  });

  it("treats an empty mention as the default verb", () => {
    assert.deepEqual(questionFrom(payload(""), BASE).words, []);
  });
});

describe("the desk", () => {
  async function serving(answer: (q: unknown) => Promise<string>) {
    const desk = new CampfireDesk(0, BASE);
    return desk.serve(answer as never);
  }

  it("puts the answer in the response body", async () => {
    const desk = await serving(async () => "<div>hello</div>");
    try {
      const response = await fetch(`http://127.0.0.1:${desk.port}/`, {
        method: "POST",
        body: JSON.stringify(payload("status")),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/html/);
      assert.equal(await response.text(), "<div>hello</div>");
    } finally {
      await desk.close();
    }
  });

  it("answers 200 even when the bot throws, so nothing is uploaded as an attachment", async () => {
    const desk = await serving(async () => {
      throw new Error("boom");
    });
    try {
      const response = await fetch(`http://127.0.0.1:${desk.port}/`, {
        method: "POST",
        body: JSON.stringify(payload("status")),
      });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /could not answer/);
    } finally {
      await desk.close();
    }
  });

  it("says nothing at all — no Content-Type — for a body it cannot read", async () => {
    const desk = await serving(async () => "<div>never</div>");
    try {
      const response = await fetch(`http://127.0.0.1:${desk.port}/`, {
        method: "POST",
        body: "not json",
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), null);
      assert.equal(await response.text(), "");
    } finally {
      await desk.close();
    }
  });

  it("is alive without reading the cluster to prove it", async () => {
    const desk = await serving(async () => "");
    try {
      assert.equal((await fetch(`http://127.0.0.1:${desk.port}/healthz`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${desk.port}/other`)).status, 404);
    } finally {
      await desk.close();
    }
  });

  it("knows the budget it is answering inside", () => {
    assert.equal(new CampfireDesk(0, BASE).budgetMs, 7_000);
  });
});

describe("redaction", () => {
  it("removes the shapes a credential actually takes", () => {
    assert.match(redact("sk-ant-api03-abcdefghijklmnopqrstuvwxyz12"), /sk-ant-<redacted>/);
    assert.match(redact("postgres://u:hunter2@db/x"), /u:<redacted>@db/);
    assert.match(redact("token=supersecretvalue"), /token=<redacted>/);
    assert.match(redact("/rooms/1/12345-Ab3dEf9hIj2k/messages"), /<bot key redacted>/);
  });

  it("leaves ordinary log text alone", () => {
    const line = "level=info msg=\"reconciled Kustomization apps in 1.2s\"";
    assert.equal(redact(line), line);
  });
});

describe("rendering an answer", () => {
  it("marks anything below high confidence", () => {
    const answer = { summary: "s", evidence: [], commands: [], confidence: "low" };
    assert.match(renderWhy(answer), /low confidence/);
    assert.ok(!renderWhy({ ...answer, confidence: "high" }).includes("confidence</em>"));
  });

  it("escapes what the model produced", () => {
    const html = renderWhy({
      summary: "<script>x</script>",
      evidence: ["a & b"],
      commands: ["kubectl get pods -n <ns>"],
      confidence: "high",
    });
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&amp; b/);
    assert.match(html, /&lt;ns&gt;/);
  });
});
