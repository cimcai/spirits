import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ArrowLeft, Clock, Zap, AlertTriangle, Activity, DollarSign } from "lucide-react";
import type { LatencyLog } from "@shared/schema";

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
  const [activeTab, setActiveTab] = useState<"summary" | "costs" | "logs">("summary");

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
