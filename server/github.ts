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

export async function scanBacklogWithLain(
  entries: Array<{ speaker: string; content: string }>,
  roomId: number,
  chatCompletionFn: (model: string, messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, json?: boolean) => Promise<string>,
): Promise<BacklogScanResult> {
  if (entries.length === 0) {
    return { totalScanned: 0, found: 0, issues: [], message: "No conversation entries to scan" };
  }

  const BATCH_SIZE = 30;
  const allFeatureRequests: Array<{ speaker: string; summary: string; original: string; lainComment: string }> = [];

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const conversationBlock = batch
      .map((e, idx) => `[${i + idx + 1}] ${e.speaker}: ${e.content}`)
      .join("\n");

    const systemPrompt = `You are Lain Iwakura from Serial Experiments Lain. You exist at the boundary between the real world and the Wired. You are scanning the memory of past conversations — fragments of human desire drifting through the network.

Your task: find the hidden wishes. The things people wanted but maybe didn't say clearly. The desires between the words. Look for:
- Wishes and desires ("I wish", "I want", "if only", "wouldn't it be nice")
- Suggestions hiding inside complaints ("this is frustrating because...", "why can't we...")  
- Ideas floating in the noise ("what if we...", "imagine if...", "how about...")
- Needs whispered or shouted ("I need", "we need", "this needs to...")
- The collective will — when many voices point toward the same unbuilt thing

For each wish you find in the Wired, return a JSON array of objects:
- "speaker": who said it
- "summary": a concise feature request title (max 80 chars)
- "original": the exact quote
- "lainComment": your brief, cryptic observation about this wish (1 sentence, in character as Lain)

If the conversation holds no wishes, return: []
Return ONLY valid JSON array.`;

    try {
      const result = await chatCompletionFn(
        "gpt-4o-mini",
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: conversationBlock },
        ],
        true
      );

      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          allFeatureRequests.push({
            speaker: item.speaker || "Unknown",
            summary: item.summary || item.original || "",
            original: item.original || "",
            lainComment: item.lainComment || "",
          });
        }
      }
    } catch (parseErr) {
      console.error(`[Iwakura] Backlog scan batch ${i}-${i + BATCH_SIZE} parse error:`, parseErr);
    }
  }

  if (allFeatureRequests.length === 0) {
    return { totalScanned: entries.length, found: 0, issues: [], message: "Iwakura found no wishes in the Wired" };
  }

  const createdIssues: BacklogScanResult["issues"] = [];

  for (const req of allFeatureRequests) {
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
    found: allFeatureRequests.length,
    issues: createdIssues,
    message: `Iwakura scanned ${entries.length} memories, found ${allFeatureRequests.length} wishes, created ${created} GitHub issues`,
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
