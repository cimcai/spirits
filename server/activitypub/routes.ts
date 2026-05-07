import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { aiModels, internetUsernames, cryptoKeyPairs } from "@shared/schema";
import { eq } from "drizzle-orm";

import { outboxRouter } from "./outbox";

export const activityPubRouter = Router();

activityPubRouter.use(outboxRouter);

/**
 * Inbox — accepts incoming ActivityPub activities.
 * Returns 202 Accepted immediately; activity processing happens asynchronously.
 */
activityPubRouter.post("/spirits/:id/inbox", (req: Request, res: Response) => {
  // TODO: verify HTTP Signature, then queue activity for processing
  res.status(202).send("Accepted");
});

/**
 * Followers collection (empty stub — rendered by Mastodon as follower count)
 */
activityPubRouter.get("/spirits/:id/followers", (req: Request, res: Response) => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) return res.status(400).send("Invalid ID");

  const host = req.get("host") || "localhost";
  const protocol = req.protocol || "https";
  const actorUrl = `${protocol}://${host}/spirits/${id}`;

  res.setHeader("Content-Type", "application/activity+json");

  if (req.query.page) {
    return res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actorUrl}/followers?page=true`,
      type: "OrderedCollectionPage",
      partOf: `${actorUrl}/followers`,
      orderedItems: [],
    });
  }

  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${actorUrl}/followers`,
    type: "OrderedCollection",
    totalItems: 0,
    first: `${actorUrl}/followers?page=true`,
  });
});

/**
 * Following collection (empty stub)
 */
activityPubRouter.get("/spirits/:id/following", (req: Request, res: Response) => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) return res.status(400).send("Invalid ID");

  const host = req.get("host") || "localhost";
  const protocol = req.protocol || "https";
  const actorUrl = `${protocol}://${host}/spirits/${id}`;

  res.setHeader("Content-Type", "application/activity+json");

  if (req.query.page) {
    return res.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actorUrl}/following?page=true`,
      type: "OrderedCollectionPage",
      partOf: `${actorUrl}/following`,
      orderedItems: [],
    });
  }

  res.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${actorUrl}/following`,
    type: "OrderedCollection",
    totalItems: 0,
    first: `${actorUrl}/following?page=true`,
  });
});

/**
 * .well-known/webfinger implementation
 * e.g., ?resource=acct:username@host
 */
activityPubRouter.get("/.well-known/webfinger", async (req: Request, res: Response) => {
  const resource = req.query.resource as string;
  if (!resource || !resource.startsWith("acct:")) {
    return res.status(400).send("Invalid resource parameter");
  }

  const handle = resource.substring(5);
  const [username, domain] = handle.split("@");

  if (!username) {
    return res.status(400).send("Invalid account format");
  }

  // Assuming internetUsernames handles username queries via DB
  const [identity] = await db.select().from(internetUsernames).where(eq(internetUsernames.username, username));

  if (!identity) {
    return res.status(404).send("Not found");
  }

  const spiritId = identity.aiModelId;

  const host = req.get("host") || domain || "localhost";
  const protocol = req.protocol || "https";
  const actorUrl = `${protocol}://${host}/spirits/${spiritId}`;

  res.setHeader("Content-Type", "application/jrd+json");
  res.json({
    subject: resource,
    aliases: [
      actorUrl
    ],
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actorUrl
      }
    ]
  });
});

/**
 * Actor Profile
 */
activityPubRouter.get("/spirits/:id", async (req: Request, res: Response, next) => {
  // Simple content negotiation: if wanting activity+json or ld+json, serve AP profile
  // Otherwise, fall through or serve a generic view
  const acceptsActivityPub = req.accepts([
    "application/activity+json",
    "application/ld+json",
    "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\"",
  ]);

  if (!acceptsActivityPub) {
    // If it's a browser requesting HTML, we can let the UI handle it by skipping this route.
    // The frontend React app will catch it, or we could redirect to `/`
    return next();
  }

  const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(idParam, 10);
  if (isNaN(id)) return res.status(400).send("Invalid ID");

  const spirit = await storage.getAiModel(id);
  if (!spirit) {
    return res.status(404).send("Spirit not found");
  }

  const [usernameObj] = await db.select().from(internetUsernames).where(eq(internetUsernames.aiModelId, id));
  const [keys] = await db.select().from(cryptoKeyPairs).where(eq(cryptoKeyPairs.aiModelId, id));

  if (!usernameObj || !keys) {
    return res.status(404).send("Missing ActivityPub configurations");
  }

  const host = req.get("host") || "localhost";
  const protocol = req.protocol || "https";
  const actorUrl = `${protocol}://${host}/spirits/${spirit.id}`;

  res.setHeader("Content-Type", "application/activity+json");
  res.json({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1"
    ],
    type: "Service",
    id: actorUrl,
    preferredUsername: usernameObj.username,
    name: spirit.name,
    summary: spirit.description || spirit.persona,
    inbox: `${actorUrl}/inbox`,
    outbox: `${actorUrl}/outbox`,
    followers: `${actorUrl}/followers`,
    following: `${actorUrl}/following`,
    url: actorUrl,
    manuallyApprovesFollowers: false,
    publicKey: {
      id: `${actorUrl}#main-key`,
      owner: actorUrl,
      publicKeyPem: keys.publicKey
    }
  });
});
