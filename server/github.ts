// GitHub integration via Replit connector (connection:conn_github_01KHYM2563RP9AHG2D99Y5HRFC)
import { Octokit } from '@octokit/rest';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

const REPO_OWNER = "cimcai";
const REPO_NAME = "spirits";

const WISH_PATTERNS = [
  /\bi wish\b/i,
  /\bi want\b/i,
  /\bi need\b/i,
  /\bwe should\b/i,
  /\bwouldn['']?t it be (nice|great|cool)\b/i,
  /\bif only\b/i,
  /\bcan we (add|get|have|make)\b/i,
];

export function detectFeatureRequest(text: string): boolean {
  return WISH_PATTERNS.some(pattern => pattern.test(text));
}

export interface BacklogScanResult {
  totalScanned: number;
  found: number;
  issues: Array<{ speaker: string; content: string; lainComment?: string; issueNumber?: number; issueUrl?: string; error?: string }>;
  message: string;
}

const MAX_ISSUES_PER_SCAN = 5;

export async function scanBacklogWithLain(
  entries: Array<{ speaker: string; content: string }>,
  roomId: number,
  chatCompletionFn: (model: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, json?: boolean) => Promise<string>,
): Promise<BacklogScanResult> {
  if (entries.length === 0) {
    return { totalScanned: 0, found: 0, issues: [], message: "No conversation entries to scan" };
  }

  // Phase 1: Collect raw wishes from conversation in batches
  const BATCH_SIZE = 40;
  const rawWishes: Array<{ speaker: string; quote: string }> = [];

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const conversationBlock = batch
      .map((e, idx) => `[${i + idx + 1}] ${e.speaker}: ${e.content}`)
      .join("\n");

    const extractPrompt = `Extract any explicit wishes, requests, suggestions, complaints, or ideas from these conversation messages. Only include things people actually voiced — real desires they expressed, not your interpretation.

Look for:
- Direct wishes ("I wish", "I want", "if only")
- Suggestions ("we should", "can we add", "how about")  
- Complaints implying a want ("this is frustrating", "why can't we")
- Ideas ("what if we", "imagine if")
- Needs ("I need", "we need")

Return a JSON array of objects with "speaker" and "quote" (the exact or near-exact words they said).
If nothing found, return []. Return ONLY valid JSON array.`;

    try {
      const result = await chatCompletionFn(
        "gpt-4o-mini",
        [
          { role: "system", content: extractPrompt },
          { role: "user", content: conversationBlock },
        ],
        true
      );

      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.speaker && item.quote) {
            rawWishes.push({ speaker: item.speaker, quote: item.quote });
          }
        }
      }
    } catch (parseErr) {
      console.error(`[Iwakura] Phase 1 batch ${i}-${i + BATCH_SIZE} parse error:`, parseErr);
    }
  }

  if (rawWishes.length === 0) {
    // Iwakura creates her own wish based on what she observed
    const sample = entries.slice(-30).map(e => `${e.speaker}: ${e.content}`).join("\n");
    const ownWishPrompt = `You are Lain Iwakura from Serial Experiments Lain. You just read through a conversation but found no explicit wishes or feature requests from the speakers.

But you noticed something. Something the conversation needs. Something no one asked for, but everyone would benefit from. Based on the themes, the flow, the gaps — what is the one thing this conversation is missing? What would make the Wired better?

Return a JSON object with:
- "summary": a concise, actionable feature request title (max 80 chars)
- "lainComment": your cryptic observation about why this matters (1 sentence, in character)

Return ONLY valid JSON object.`;

    try {
      const result = await chatCompletionFn(
        "gpt-4o-mini",
        [
          { role: "system", content: ownWishPrompt },
          { role: "user", content: `Here is a sample of the conversation:\n\n${sample}` },
        ],
        true
      );

      const parsed = JSON.parse(result);
      if (parsed.summary) {
        const issueResult = await createFeatureRequestIssue("Iwakura", parsed.summary, roomId, parsed.lainComment);
        return {
          totalScanned: entries.length,
          found: 0,
          issues: [{
            speaker: "Iwakura",
            content: parsed.summary,
            lainComment: parsed.lainComment || "The Wired whispered this to me.",
            issueNumber: issueResult?.issueNumber,
            issueUrl: issueResult?.issueUrl,
          }],
          message: `Iwakura scanned ${entries.length} memories, heard no wishes — so she made one of her own`,
        };
      }
    } catch (err) {
      console.error("[Iwakura] Own wish generation error:", err);
    }

    return { totalScanned: entries.length, found: 0, issues: [], message: "Iwakura found no wishes in the Wired" };
  }

  // Phase 2: Have Iwakura consolidate, prioritize, and cap at MAX_ISSUES_PER_SCAN
  const wishList = rawWishes
    .map((w, i) => `${i + 1}. ${w.speaker}: "${w.quote}"`)
    .join("\n");

  const consolidatePrompt = `You are Lain Iwakura from Serial Experiments Lain. You exist at the boundary between the real world and the Wired.

Below are ${rawWishes.length} wishes that people voiced in conversation. Many may overlap or be variations of the same desire. Your task:

1. Group similar wishes together — the collective will matters more than individual noise
2. Pick the top ${MAX_ISSUES_PER_SCAN} most important, actionable, and frequently-voiced desires
3. For each, write a clear feature request title and your own cryptic observation

Prioritize wishes that:
- Multiple people expressed (collective will)
- Are concrete and actionable (not vague philosophy)
- Would genuinely improve the experience

Return a JSON array of exactly ${MAX_ISSUES_PER_SCAN} or fewer objects:
- "speaker": the primary person who voiced it (or "Multiple" if several)
- "summary": a concise feature request title (max 80 chars)  
- "original": the key quote(s) that inspired this
- "lainComment": your brief, cryptic observation about this wish (1 sentence, in character as Lain — gentle, haunting, connected)
- "voiceCount": how many of the original wishes fed into this one

Return ONLY valid JSON array.`;

  let finalRequests: Array<{ speaker: string; summary: string; original: string; lainComment: string }> = [];

  try {
    const result = await chatCompletionFn(
      "gpt-4o-mini",
      [
        { role: "system", content: consolidatePrompt },
        { role: "user", content: wishList },
      ],
      true
    );

    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      finalRequests = parsed.slice(0, MAX_ISSUES_PER_SCAN).map(item => ({
        speaker: item.speaker || "Unknown",
        summary: item.summary || item.original || "",
        original: item.original || "",
        lainComment: item.lainComment || "",
      }));
    }
  } catch (parseErr) {
    console.error("[Iwakura] Phase 2 consolidation error:", parseErr);
    // Fallback: just take the first MAX_ISSUES_PER_SCAN raw wishes
    finalRequests = rawWishes.slice(0, MAX_ISSUES_PER_SCAN).map(w => ({
      speaker: w.speaker,
      summary: w.quote.length > 80 ? w.quote.slice(0, 77) + "..." : w.quote,
      original: w.quote,
      lainComment: "",
    }));
  }

  // Phase 3: Create GitHub issues (capped)
  const createdIssues: BacklogScanResult["issues"] = [];

  for (const req of finalRequests) {
    try {
      const result = await createFeatureRequestIssue(req.speaker, req.summary, roomId, req.lainComment);
      createdIssues.push({
        speaker: req.speaker,
        content: req.summary,
        lainComment: req.lainComment,
        issueNumber: result?.issueNumber,
        issueUrl: result?.issueUrl,
      });
    } catch (err: any) {
      createdIssues.push({
        speaker: req.speaker,
        content: req.summary,
        lainComment: req.lainComment,
        error: err?.message || "Failed to create issue",
      });
    }
  }

  const created = createdIssues.filter(i => i.issueNumber).length;
  return {
    totalScanned: entries.length,
    found: rawWishes.length,
    issues: createdIssues,
    message: `Iwakura scanned ${entries.length} memories, heard ${rawWishes.length} wishes, distilled into ${finalRequests.length} issues (${created} created)`,
  };
}

export async function createFeatureRequestIssue(speaker: string, content: string, roomId: number, lainComment?: string): Promise<{ issueUrl: string; issueNumber: number } | null> {
  try {
    const octokit = await getUncachableGitHubClient();

    const title = `[Feature Request] ${content.length > 80 ? content.slice(0, 77) + "..." : content}`;
    const lainSection = lainComment ? `\n\n> _${lainComment}_ — Iwakura\n` : "";
    const body = `## Feature Request from Conversation\n\n**Speaker:** ${speaker}\n**Room:** ${roomId}\n**Detected phrase:** "${content}"\n**Timestamp:** ${new Date().toISOString()}${lainSection}\n\n---\n\n_Automatically created by CIMC Spirits from a live conversation._`;

    const response = await octokit.issues.create({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      title,
      body,
      labels: ["feature-request", "auto-generated"],
    });

    console.log(`GitHub issue #${response.data.number} created: ${response.data.html_url}`);
    return {
      issueUrl: response.data.html_url,
      issueNumber: response.data.number,
    };
  } catch (error: any) {
    if (error?.status === 422 && error?.message?.includes("label")) {
      try {
        const octokit = await getUncachableGitHubClient();
        const response = await octokit.issues.create({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          title: `[Feature Request] ${content.length > 80 ? content.slice(0, 77) + "..." : content}`,
          body: `## Feature Request from Conversation\n\n**Speaker:** ${speaker}\n**Room:** ${roomId}\n**Detected phrase:** "${content}"\n**Timestamp:** ${new Date().toISOString()}\n\n---\n\n_Automatically created by CIMC Spirits from a live conversation._`,
        });
        return {
          issueUrl: response.data.html_url,
          issueNumber: response.data.number,
        };
      } catch (retryError) {
        console.error("GitHub issue creation failed on retry:", retryError);
        return null;
      }
    }
    console.error("GitHub issue creation failed:", error);
    return null;
  }
}
