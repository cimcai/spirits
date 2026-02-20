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

export async function createFeatureRequestIssue(speaker: string, content: string, roomId: number): Promise<{ issueUrl: string; issueNumber: number } | null> {
  try {
    const octokit = await getUncachableGitHubClient();

    const title = `[Feature Request] ${content.length > 80 ? content.slice(0, 77) + "..." : content}`;
    const body = `## Feature Request from Conversation\n\n**Speaker:** ${speaker}\n**Room:** ${roomId}\n**Detected phrase:** "${content}"\n**Timestamp:** ${new Date().toISOString()}\n\n---\n\n_Automatically created by CIMC Spirits from a live conversation._`;

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
