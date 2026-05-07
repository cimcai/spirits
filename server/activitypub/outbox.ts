import { Router, Request, Response } from "express";
import { db } from "../db";
import { outboundCalls, aiModels } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export const outboxRouter = Router();

outboxRouter.get("/spirits/:id/outbox", async (req: Request, res: Response, next) => {
  const acceptsActivityPub = req.accepts([
    "application/activity+json",
    "application/ld+json",
    "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\"",
  ]);
  
  if (!acceptsActivityPub) {
    return next();
  }

  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).send("Invalid ID");

  const host = req.get("host") || "localhost";
  const protocol = req.protocol || "https";
  const actorUrl = `${protocol}://${host}/spirits/${id}`;
  const outboxUrl = `${actorUrl}/outbox`;

  const isPage = req.query.page !== undefined;

  if (!isPage) {
    // Root OrderedCollection — Mastodon reads 'first' to find the page
    const calls = await db.select()
      .from(outboundCalls)
      .where(eq(outboundCalls.modelId, id))
      .orderBy(desc(outboundCalls.createdAt));

    res.setHeader("Content-Type", "application/activity+json");
    return res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: outboxUrl,
      type: "OrderedCollection",
      totalItems: calls.length,
      first: `${outboxUrl}?page=true`,
    });
  }

  // CollectionPage — the actual items
  const calls = await db.select()
    .from(outboundCalls)
    .where(eq(outboundCalls.modelId, id))
    .orderBy(desc(outboundCalls.createdAt));

  const items = calls.map(call => ({
    type: "Create",
    id: `${outboxUrl}/${call.id}/activity`,
    actor: actorUrl,
    published: call.createdAt.toISOString(),
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    object: {
      type: "Note",
      id: `${outboxUrl}/${call.id}`,
      attributedTo: actorUrl,
      content: call.responseContent,
      published: call.createdAt.toISOString(),
      to: ["https://www.w3.org/ns/activitystreams#Public"]
    }
  }));

  res.setHeader("Content-Type", "application/activity+json");
  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${outboxUrl}?page=true`,
    type: "OrderedCollectionPage",
    partOf: outboxUrl,
    orderedItems: items,
  });
});
