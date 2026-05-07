import { test, describe, mock } from "node:test";
import assert from "node:assert";
import express from "express";
import request from "supertest";
import { activityPubRouter } from "./routes";
import { db } from "../db";
import { storage } from "../storage";

const app = express();
app.use(activityPubRouter);

describe("ActivityPub Routes", () => {
  test("GET /.well-known/webfinger resolves spirit Actor URL", async () => {
    // Mock the DB select to return a fake identity
    const fakeIdentity = {
      id: 1,
      username: "turing",
      aiModelId: 1
    };

    const selectMock = mock.method(db, "select", () => {
      return {
        from: () => ({
          where: () => [fakeIdentity]
        })
      };
    });

    const res = await request(app)
      .get("/.well-known/webfinger?resource=acct:turing@localhost:5000");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-type"], "application/jrd+json; charset=utf-8");
    assert.strictEqual(res.body.subject, "acct:turing@localhost:5000");
    assert.strictEqual(res.body.links[0].rel, "self");
    assert.ok(res.body.links[0].href.endsWith("/spirits/1"));
    
    selectMock.mock.restore();
  });

  test("GET /spirits/:id returns JSON-LD Actor profile with Accept header", async () => {
    const fakeSpirit = {
      id: 1,
      name: "Turing",
      description: "A computing pioneer"
    };
    
    const fakeIdentity = { username: "turing", aiModelId: 1 };
    const fakeKeys = { publicKey: "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----", aiModelId: 1 };

    // Mock storage for getAiModel
    const storageMock = mock.method(storage, "getAiModel", async (id: number) => {
      return id === 1 ? fakeSpirit : undefined;
    });
    
    const selectMock = mock.method(db, "select", () => ({
      from: (target: any) => ({
        where: () => {
          const tableName = target?.[Symbol.for('drizzle:Name')] || target?._?.name;
          if (tableName === "internet_usernames") return [fakeIdentity];
          if (tableName === "crypto_key_pairs") return [fakeKeys];
          // default fallback just in case
          return [fakeIdentity, fakeKeys];
        }
      })
    }));

    const res = await request(app)
      .get("/spirits/1")
      .set("Accept", "application/activity+json");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-type"], "application/activity+json; charset=utf-8");
    assert.strictEqual(res.body.type, "Service");
    assert.strictEqual(res.body.preferredUsername, "turing");
    assert.strictEqual(res.body.publicKey.publicKeyPem, fakeKeys.publicKey);
    
    storageMock.mock.restore();
    selectMock.mock.restore();
  });

  test("GET /spirits/:id falls through if no Accept header matching ActivityPub", async () => {
    // Should get a 404 because there are no other handlers in this mock app
    const res = await request(app)
      .get("/spirits/1")
      .set("Accept", "text/html");

    assert.strictEqual(res.status, 404);
  });

  test("GET /spirits/:id/outbox returns JSON-LD OrderedCollection with 'first' link", async () => {
    const fakeCall = {
      id: 10,
      modelId: 1,
      responseContent: "Hello world!",
      createdAt: new Date("2024-01-01T00:00:00.000Z")
    };

    const selectMock = mock.method(db, "select", () => ({
      from: () => ({
        where: () => ({
          orderBy: () => [fakeCall]
        })
      })
    }));

    const res = await request(app)
      .get("/spirits/1/outbox")
      .set("Accept", "application/activity+json");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, "OrderedCollection");
    assert.strictEqual(res.body.totalItems, 1);
    assert.ok(res.body.first, "root outbox must have a 'first' link");
    assert.ok(res.body.first.includes("page="), "'first' must include page param");
    assert.strictEqual(res.body.orderedItems, undefined, "root outbox must not inline orderedItems");

    selectMock.mock.restore();
  });

  test("GET /spirits/:id/outbox?page=true returns OrderedCollectionPage with items", async () => {
    const fakeCall = {
      id: 10,
      modelId: 1,
      responseContent: "Hello world!",
      createdAt: new Date("2024-01-01T00:00:00.000Z")
    };

    const selectMock = mock.method(db, "select", () => ({
      from: () => ({
        where: () => ({
          orderBy: () => [fakeCall]
        })
      })
    }));

    const res = await request(app)
      .get("/spirits/1/outbox?page=true")
      .set("Accept", "application/activity+json");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.type, "OrderedCollectionPage");
    assert.ok(res.body.partOf, "page must have partOf");
    assert.strictEqual(res.body.orderedItems.length, 1);
    assert.strictEqual(res.body.orderedItems[0].type, "Create");
    assert.strictEqual(res.body.orderedItems[0].object.content, "Hello world!");

    selectMock.mock.restore();
  });
});
