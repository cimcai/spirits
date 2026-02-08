/**
 * PersonaPlex Integration for Spirits
 * 
 * Connects to a PersonaPlex server for full-duplex voice AI conversations.
 * PersonaPlex provides real-time speech-to-speech with persona control.
 */

import WebSocket from "ws";

export interface PersonaPlexConfig {
  serverUrl: string;  // e.g., "wss://cjuzwdji4o9zi2-8998.proxy.runpod.net/ws"
  textPrompt: string;
  voicePrompt: string;  // e.g., "VARIETY_M1.pt"
}

export interface PersonaPlexResponse {
  text: string;
  audioBase64?: string;
}

const DEFAULT_CONFIG: PersonaPlexConfig = {
  serverUrl: process.env.PERSONAPLEX_URL || "wss://cjuzwdji4o9zi2-8998.proxy.runpod.net/ws",
  textPrompt: `You are Joscha Bach, a German cognitive scientist and AI researcher known for your work on cognitive architectures and consciousness. You speak with precision, often saying "the interesting question is..." You challenge assumptions about intelligence and reality with vivid metaphors. You believe consciousness is computation that models itself.`,
  voicePrompt: "VARIETY_M1.pt",
};

/**
 * PersonaPlex client for real-time voice conversations
 */
export class PersonaPlexClient {
  private config: PersonaPlexConfig;
  private ws: WebSocket | null = null;
  private responseBuffer: string = "";
  private isConnected: boolean = false;

  constructor(config: Partial<PersonaPlexConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a text response using PersonaPlex's underlying model
   * For integration with Spirits' text-based philosopher system
   */
  async generateTextResponse(conversationContext: string): Promise<string> {
    // PersonaPlex is primarily voice-based, so for text responses
    // we use the persona prompt to simulate the response style
    const prompt = `${this.config.textPrompt}

Based on the following conversation, provide a thoughtful philosophical response (2-3 sentences):

${conversationContext}

Response:`;

    // For now, return a placeholder that indicates PersonaPlex integration
    // In production, this could connect to the PersonaPlex backend or use
    // a separate LLM with the same persona
    return `[PersonaPlex would respond via voice - connect to ${this.config.serverUrl} for full-duplex audio]`;
  }

  /**
   * Get the WebSocket URL with query parameters
   */
  getConnectionUrl(): string {
    const url = new URL(this.config.serverUrl);
    url.searchParams.set("text_prompt", this.config.textPrompt);
    url.searchParams.set("voice_prompt", this.config.voicePrompt);
    return url.toString();
  }

  /**
   * Connect to PersonaPlex server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.getConnectionUrl());
        
        this.ws.on("open", () => {
          console.log("[PersonaPlex] Connected to server");
          this.isConnected = true;
          resolve();
        });

        this.ws.on("message", (data) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === "text") {
              this.responseBuffer += message.content;
            }
          } catch (e) {
            // Binary audio data
          }
        });

        this.ws.on("close", () => {
          console.log("[PersonaPlex] Disconnected");
          this.isConnected = false;
        });

        this.ws.on("error", (error) => {
          console.error("[PersonaPlex] WebSocket error:", error);
          reject(error);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error("Connection timeout"));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from PersonaPlex server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get server info for display
   */
  getServerInfo(): { url: string; persona: string; voice: string } {
    return {
      url: this.config.serverUrl,
      persona: this.config.textPrompt.slice(0, 100) + "...",
      voice: this.config.voicePrompt,
    };
  }
}

// Singleton instance for the default PersonaPlex connection
let defaultClient: PersonaPlexClient | null = null;

export function getPersonaPlexClient(config?: Partial<PersonaPlexConfig>): PersonaPlexClient {
  if (!defaultClient || config) {
    defaultClient = new PersonaPlexClient(config);
  }
  return defaultClient;
}

/**
 * Check if PersonaPlex server is available
 */
export async function checkPersonaPlexHealth(serverUrl?: string): Promise<boolean> {
  try {
    const url = serverUrl || DEFAULT_CONFIG.serverUrl;
    // Try HTTP health check first
    const httpUrl = url.replace("wss://", "https://").replace("ws://", "http://").replace("/ws", "");
    const response = await fetch(httpUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

export { DEFAULT_CONFIG as PERSONAPLEX_DEFAULT_CONFIG };
