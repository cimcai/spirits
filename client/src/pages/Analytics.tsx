import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Clock, Zap, AlertTriangle, Activity, DollarSign, Download, FileText, FileJson, Sparkles, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { LatencyLog } from "@shared/schema";
import { useWebLLM, WEBLLM_MODELS } from "@/hooks/use-webllm";

interface LatencySummary {
  byOperation: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; errors: number; estimatedCost: number }>;
  byModel: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; estimatedCost: number }>;
  byService: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; estimatedCost: number }>;
  totalLogs: number;
  totalEstimatedCost: number;
}

const OPERATION_LABELS: Record<string, string> = {
  transcription: "Audio Transcription",
  analysis: "Philosopher Analysis",
  dialogue_generation: "Dialogue Generation",
  tts: "Text-to-Speech",
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString();
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<"summary" | "costs" | "logs" | "export">("summary");

  const { data: summary, isLoading: summaryLoading } = useQuery<LatencySummary>({
    queryKey: ["/api/latency/summary"],
    refetchInterval: 10000,
  });

  const { data: logs, isLoading: logsLoading } = useQuery<LatencyLog[]>({
    queryKey: ["/api/latency"],
    refetchInterval: 10000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-dashboard">
              <ArrowLeft />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-analytics-title">Analytics</h1>
            <p className="text-sm text-muted-foreground">API usage, costs & performance</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant={activeTab === "summary" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("summary")}
              data-testid="button-tab-summary"
            >
              Performance
            </Button>
            <Button
              variant={activeTab === "costs" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("costs")}
              data-testid="button-tab-costs"
            >
              Costs
            </Button>
            <Button
              variant={activeTab === "export" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("export")}
              data-testid="button-tab-export"
            >
              Export
            </Button>
            <Button
              variant={activeTab === "logs" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("logs")}
              data-testid="button-tab-logs"
            >
              Recent Logs
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto space-y-6">
        {activeTab === "summary" ? (
          <SummaryView summary={summary} isLoading={summaryLoading} />
        ) : activeTab === "costs" ? (
          <CostsView summary={summary} isLoading={summaryLoading} />
        ) : activeTab === "export" ? (
          <ExportView />
        ) : (
          <LogsView logs={logs} isLoading={logsLoading} />
        )}
      </main>
    </div>
  );
}

function SummaryView({ summary, isLoading }: { summary?: LatencySummary; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    );
  }

  if (!summary || summary.totalLogs === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground" data-testid="text-no-data">No data yet. Use the app to start collecting analytics.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Total Calls</p>
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-calls">{summary.totalLogs.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Est. Total Cost</p>
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-cost">{formatCost(summary.totalEstimatedCost)}</p>
          </CardContent>
        </Card>
        {Object.entries(summary.byOperation).slice(0, 3).map(([op, stats]) => (
          <Card key={op}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground truncate">{OPERATION_LABELS[op] || op}</p>
              </div>
              <p className="text-2xl font-bold">{formatMs(stats.avgMs)}</p>
              <p className="text-xs text-muted-foreground">{stats.count} calls avg</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By Operation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(summary.byOperation).map(([op, stats]) => (
              <div key={op} className="flex items-center gap-4 flex-wrap">
                <span className="text-sm font-medium w-40">{OPERATION_LABELS[op] || op}</span>
                <div className="flex-1 min-w-[200px]">
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-foreground/60 rounded-full"
                      style={{ width: `${Math.min((stats.avgMs / Math.max(...Object.values(summary.byOperation).map(s => s.avgMs))) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>avg {formatMs(stats.avgMs)}</span>
                  <span>min {formatMs(stats.minMs)}</span>
                  <span>max {formatMs(stats.maxMs)}</span>
                  <span>{stats.count} calls</span>
                  <span>{formatCost(stats.estimatedCost)}</span>
                  {stats.errors > 0 && (
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {stats.errors} errors
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Model</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(summary.byModel)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([model, stats]) => (
                <div key={model} className="flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-sm font-mono truncate max-w-[200px]">{model}</span>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>avg {formatMs(stats.avgMs)}</span>
                    <span>{stats.count} calls</span>
                    <span>{formatCost(stats.estimatedCost)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Service</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(summary.byService)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([service, stats]) => (
                <div key={service} className="flex items-center justify-between gap-4 flex-wrap">
                  <Badge variant="outline">{service}</Badge>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>avg {formatMs(stats.avgMs)}</span>
                    <span>{stats.count} calls</span>
                    <span>{formatCost(stats.estimatedCost)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CostsView({ summary, isLoading }: { summary?: LatencySummary; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    );
  }

  if (!summary || summary.totalLogs === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <DollarSign className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No cost data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const operationEntries = Object.entries(summary.byOperation).sort((a, b) => b[1].estimatedCost - a[1].estimatedCost);
  const modelEntries = Object.entries(summary.byModel).sort((a, b) => b[1].estimatedCost - a[1].estimatedCost);
  const maxOpCost = Math.max(...operationEntries.map(([, s]) => s.estimatedCost), 0.001);
  const maxModelCost = Math.max(...modelEntries.map(([, s]) => s.estimatedCost), 0.001);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Total Estimated Cost</p>
            </div>
            <p className="text-3xl font-bold" data-testid="text-costs-total">{formatCost(summary.totalEstimatedCost)}</p>
            <p className="text-xs text-muted-foreground mt-1">across {summary.totalLogs.toLocaleString()} API calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Avg Cost Per Call</p>
            </div>
            <p className="text-3xl font-bold" data-testid="text-costs-avg">
              {summary.totalLogs > 0 ? formatCost(summary.totalEstimatedCost / summary.totalLogs) : "$0.00"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Highest Cost Operation</p>
            </div>
            <p className="text-lg font-bold" data-testid="text-costs-highest-op">
              {operationEntries.length > 0 ? (OPERATION_LABELS[operationEntries[0][0]] || operationEntries[0][0]) : "N/A"}
            </p>
            <p className="text-xs text-muted-foreground">
              {operationEntries.length > 0 ? formatCost(operationEntries[0][1].estimatedCost) : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost by Operation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {operationEntries.map(([op, stats]) => (
              <div key={op} className="space-y-1">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-sm font-medium">{OPERATION_LABELS[op] || op}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{stats.count} calls</span>
                    <span className="font-mono font-medium text-foreground">{formatCost(stats.estimatedCost)}</span>
                  </div>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground/60 rounded-full transition-all"
                    style={{ width: `${(stats.estimatedCost / maxOpCost) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  ~{stats.count > 0 ? formatCost(stats.estimatedCost / stats.count) : "$0"} per call
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost by Model</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {modelEntries.map(([model, stats]) => (
              <div key={model} className="space-y-1">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-sm font-mono">{model}</span>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{stats.count} calls</span>
                    <span className="font-mono font-medium text-foreground">{formatCost(stats.estimatedCost)}</span>
                  </div>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground/60 rounded-full transition-all"
                    style={{ width: `${(stats.estimatedCost / maxModelCost) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">
            Costs are estimated based on published API pricing. Actual costs may vary based on token usage, audio duration, and provider-specific billing.
            Estimates use approximate per-call averages: gpt-4o-mini analysis ~$0.0003, transcription ~$0.003, TTS ~$0.015 per call.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ExportView() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: room } = useQuery<{ id: number; name: string }>({
    queryKey: ["/api/rooms/active"],
  });
  const roomId = room?.id ?? 1;
  
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState(yesterday.toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(yesterday.toISOString().slice(0, 10));
  const [endTime, setEndTime] = useState("12:00");
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [analysisModel, setAnalysisModel] = useState("claude-sonnet-4-5");
  const [insight, setInsight] = useState<any>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [artData, setArtData] = useState<any>(null);
  const [artLoading, setArtLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const webllm = useWebLLM();
  const isLocalModel = WEBLLM_MODELS.some(m => m.id === analysisModel);

  const buildUrl = useCallback((format: string) => {
    const start = new Date(`${startDate}T${startTime}:00`).toISOString();
    const end = new Date(`${endDate}T${endTime}:00`).toISOString();
    const params = new URLSearchParams({ start, end, format });
    if (label) params.set("label", label);
    return `/api/rooms/${roomId}/export/timerange?${params.toString()}`;
  }, [startDate, startTime, endDate, endTime, label, roomId]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const resp = await fetch(buildUrl("json"));
      const data = await resp.json();
      setPreview(data);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [buildUrl]);

  const quickSelect = useCallback((hoursAgo: number, duration: number, presetLabel: string) => {
    const end = new Date(now.getTime() - hoursAgo * 3600000);
    const start = new Date(end.getTime() - duration * 3600000);
    setStartDate(start.toISOString().slice(0, 10));
    setStartTime(start.toISOString().slice(11, 16));
    setEndDate(end.toISOString().slice(0, 10));
    setEndTime(end.toISOString().slice(11, 16));
    setLabel(presetLabel);
    setPreview(null);
    setInsight(null);
  }, [now]);

  const analyzeChunk = useCallback(async () => {
    setInsightLoading(true);
    setInsight(null);
    setStreamedText("");
    setArtData(null);
    setSaved(false);

    const startISO = new Date(`${startDate}T${startTime}:00`).toISOString();
    const endISO = new Date(`${endDate}T${endTime}:00`).toISOString();

    if (isLocalModel) {
      try {
        const previewResp = await fetch(buildUrl("json"));
        const previewData = await previewResp.json();

        if (!previewData.conversation || previewData.conversation.length === 0) {
          setInsight({ error: "No conversation entries found in this time range." });
          setInsightLoading(false);
          return;
        }

        const transcript = previewData.conversation.map((e: any) => {
          const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "";
          return `[${time}] ${e.speaker}: ${e.content}`;
        }).join("\n");

        const speakers = previewData.summary?.uniqueSpeakers || [];
        const durationHours = previewData.timeRange?.durationHours || 0;

        const systemPrompt = `You are a brilliant interdisciplinary thinker. You have been given a transcript of a ${durationHours}-hour conversation between: ${speakers.join(", ")}.

Read the conversation carefully and produce your single most profound, insightful observation. Connect threads the speakers didn't see, reveal hidden assumptions, or crystallize the essence of what was really being discussed.

Be specific — reference actual moments or phrases from the conversation. Keep your response to 2-3 focused paragraphs.`;

        const result = await webllm.chatCompletion(analysisModel, [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here is the conversation transcript:\n\n${transcript}` },
        ], (token) => {
          setStreamedText(prev => prev + token);
        });

        setInsight({
          insight: result,
          model: analysisModel,
          entryCount: previewData.conversation.length,
          durationHours,
          speakers,
          local: true,
        });
      } catch (err: any) {
        setInsight({ error: err?.message || "Local analysis failed" });
      } finally {
        setInsightLoading(false);
        setStreamedText("");
      }
    } else {
      try {
        const resp = await fetch(`/api/rooms/${roomId}/analyze-chunk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start: startISO, end: endISO, model: analysisModel }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setInsight({ error: data.error || "Analysis failed" });
        } else {
          setInsight(data);
        }
      } catch {
        setInsight({ error: "Failed to analyze chunk" });
      } finally {
        setInsightLoading(false);
      }
    }
  }, [startDate, startTime, endDate, endTime, roomId, analysisModel, isLocalModel, buildUrl, webllm]);

  const generateArt = useCallback(async () => {
    setArtLoading(true);
    setArtData(null);
    try {
      const start = new Date(`${startDate}T${startTime}:00`).toISOString();
      const end = new Date(`${endDate}T${endTime}:00`).toISOString();
      const resp = await fetch(`/api/rooms/${roomId}/generate-art`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end, insight: insight?.insight }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setArtData({ error: data.error || "Art generation failed" });
      } else {
        setArtData(data);
      }
    } catch {
      setArtData({ error: "Failed to generate art" });
    } finally {
      setArtLoading(false);
    }
  }, [startDate, startTime, endDate, endTime, roomId, insight]);

  const saveInsightToStream = useCallback(async () => {
    if (!insight?.insight || insight.savedEntryId || saved) return;
    setSaveLoading(true);
    try {
      const resp = await fetch(`/api/rooms/${roomId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: `AI Insight (${insight.model})`,
          content: insight.insight,
        }),
      });
      if (resp.ok) setSaved(true);
    } catch { /* ignore */ }
    finally { setSaveLoading(false); }
  }, [insight, roomId, saved]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">Quick Select</Label>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => quickSelect(0, 1, "Last Hour")} data-testid="button-quick-1h">
                Last 1h
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickSelect(0, 3, "Last 3 Hours")} data-testid="button-quick-3h">
                Last 3h
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickSelect(0, 6, "Last 6 Hours")} data-testid="button-quick-6h">
                Last 6h
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickSelect(0, 24, "Last 24 Hours")} data-testid="button-quick-24h">
                Last 24h
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                const y = new Date(now.getTime() - 24 * 3600000);
                setStartDate(y.toISOString().slice(0, 10));
                setStartTime("00:00");
                setEndDate(y.toISOString().slice(0, 10));
                setEndTime("23:59");
                setLabel("Yesterday");
                setPreview(null);
              }} data-testid="button-quick-yesterday">
                Yesterday (Full Day)
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">Start</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setPreview(null); }}
                  data-testid="input-start-date"
                />
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setPreview(null); }}
                  data-testid="input-start-time"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">End</Label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setPreview(null); }}
                  data-testid="input-end-date"
                />
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => { setEndTime(e.target.value); setPreview(null); }}
                  data-testid="input-end-time"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Session Label (optional)</Label>
            <Input
              placeholder="e.g. Hackathon Day 1, Evening Discussion..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="input-session-label"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={loadPreview} disabled={previewLoading} data-testid="button-preview">
              {previewLoading ? "Loading..." : "Preview"}
            </Button>
            <a href={buildUrl("json")} download>
              <Button data-testid="button-export-json">
                <FileJson className="w-4 h-4 mr-2" />
                Export JSON
              </Button>
            </a>
            <a href={buildUrl("txt")} download>
              <Button variant="outline" data-testid="button-export-txt">
                <FileText className="w-4 h-4 mr-2" />
                Export Text
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Analyze with AI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Feed the selected time range into a pro AI model for its most insightful response about the conversation.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Model</Label>
              <Select value={analysisModel} onValueChange={setAnalysisModel}>
                <SelectTrigger className="w-56" data-testid="select-analysis-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5</SelectItem>
                  <SelectItem value="claude-opus-4-5">Claude Opus 4.5</SelectItem>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                  <SelectItem value="o3">o3</SelectItem>
                  <SelectItem value="deepseek/deepseek-r1">DeepSeek R1</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="pt-5">
              <Button onClick={analyzeChunk} disabled={insightLoading} data-testid="button-analyze-chunk">
                {insightLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Get Insight
                  </>
                )}
              </Button>
            </div>
          </div>

          {insightLoading && isLocalModel && streamedText && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Generating locally...</span>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
                {streamedText}
              </div>
            </div>
          )}

          {insight && !insight.error && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <Badge variant="secondary">{insight.model}</Badge>
                {insight.local && <Badge variant="outline">Local</Badge>}
                <span>{insight.entryCount} entries</span>
                <span>{insight.durationHours}h</span>
                {insight.speakers?.length > 0 && <span>{insight.speakers.join(", ")}</span>}
                {(insight.savedEntryId || saved) && <Badge variant="secondary">Saved</Badge>}
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="text-ai-insight">
                {insight.insight.split("\n").map((paragraph: string, i: number) => (
                  paragraph.trim() ? <p key={i}>{paragraph}</p> : null
                ))}
              </div>
              <div className="flex gap-2 flex-wrap pt-1">
                {insight.local && !saved && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={saveInsightToStream}
                    disabled={saveLoading}
                    data-testid="button-save-insight"
                  >
                    {saveLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Download className="w-3 h-3 mr-1" />}
                    Save to Stream
                  </Button>
                )}
                {!insight.savedEntryId && !insight.local && (
                  <Badge variant="secondary">Auto-saved</Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateArt}
                  disabled={artLoading}
                  data-testid="button-generate-art"
                >
                  {artLoading ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Generating Art...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 mr-1" />
                      Generate Art
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {insight?.error && (
            <p className="text-sm text-destructive" data-testid="text-insight-error">{insight.error}</p>
          )}
        </CardContent>
      </Card>

      {artData && !artData.error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{artData.title || "Generated Art"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative rounded-md overflow-hidden bg-black">
              <img
                src={artData.image}
                alt={artData.title}
                className="w-full max-w-2xl mx-auto block"
                data-testid="img-generated-art"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                <p className="text-white text-lg font-light italic text-center" data-testid="text-art-quote">
                  "{artData.quote}"
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <a href={artData.image} download={`${artData.title || "art"}.png`}>
                <Button variant="outline" size="sm" data-testid="button-download-art">
                  <Download className="w-3 h-3 mr-1" />
                  Download Image
                </Button>
              </a>
              <span className="text-xs text-muted-foreground">Saved to conversation stream</span>
            </div>
          </CardContent>
        </Card>
      )}

      {artData?.error && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive" data-testid="text-art-error">{artData.error}</p>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{preview.label || "Export Preview"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Duration</p>
                <p className="text-lg font-bold" data-testid="text-preview-duration">{preview.timeRange?.durationHours}h</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Conversation Entries</p>
                <p className="text-lg font-bold" data-testid="text-preview-entries">{preview.summary?.conversationEntries}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Philosopher Responses</p>
                <p className="text-lg font-bold" data-testid="text-preview-responses">{preview.summary?.philosopherResponses}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Est. Cost</p>
                <p className="text-lg font-bold" data-testid="text-preview-cost">{formatCost(preview.summary?.estimatedCost || 0)}</p>
              </div>
            </div>

            {preview.summary?.uniqueSpeakers?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Speakers</p>
                <div className="flex gap-1 flex-wrap">
                  {preview.summary.uniqueSpeakers.map((s: string) => (
                    <Badge key={s} variant="secondary">{s}</Badge>
                  ))}
                </div>
              </div>
            )}

            {preview.summary?.costByOperation && Object.keys(preview.summary.costByOperation).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">API Calls by Type</p>
                <div className="flex gap-3 flex-wrap text-xs">
                  {Object.entries(preview.summary.costByOperation as Record<string, { count: number; cost: number }>).map(([op, data]) => (
                    <span key={op} className="text-muted-foreground">
                      {OPERATION_LABELS[op] || op}: {data.count} calls ({formatCost(data.cost)})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {preview.conversation?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Recent Entries (first 10)</p>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {preview.conversation.slice(0, 10).map((e: any, i: number) => (
                    <div key={i} className="text-xs">
                      <span className="text-muted-foreground">[{new Date(e.timestamp).toLocaleTimeString()}]</span>{" "}
                      <span className="font-medium">{e.speaker}:</span> {e.content}
                    </div>
                  ))}
                  {preview.conversation.length > 10 && (
                    <p className="text-xs text-muted-foreground">...and {preview.conversation.length - 10} more entries</p>
                  )}
                </div>
              </div>
            )}

            {preview.conversation?.length === 0 && (
              <p className="text-sm text-muted-foreground">No conversation entries found in this time range. Try adjusting the dates.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogsView({ logs, isLoading }: { logs?: LatencyLog[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No logs yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent API Calls</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-latency-logs">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-medium text-muted-foreground">Time</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground">Operation</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground">Model</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground">Service</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Latency</th>
                <th className="pb-2 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const meta = log.metadata ? JSON.parse(log.metadata) : {};
                return (
                  <tr key={log.id} className="border-b border-border/50" data-testid={`row-log-${log.id}`}>
                    <td className="py-2 pr-4 text-muted-foreground text-xs">{formatTime(log.createdAt as any)}</td>
                    <td className="py-2 pr-4">
                      <span className="text-xs">{OPERATION_LABELS[log.operation] || log.operation}</span>
                      {meta.philosopherName && (
                        <span className="text-xs text-muted-foreground ml-1">({meta.philosopherName})</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{log.model}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className="text-xs">{log.service}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className="font-mono flex items-center justify-end gap-1">
                        <Zap className="w-3 h-3" />
                        {formatMs(log.latencyMs)}
                      </span>
                    </td>
                    <td className="py-2">
                      {log.success ? (
                        <Badge variant="secondary" className="text-xs">OK</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Error</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
