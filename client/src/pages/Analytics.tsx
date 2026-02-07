import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ArrowLeft, Clock, Zap, AlertTriangle, Activity } from "lucide-react";
import type { LatencyLog } from "@shared/schema";

interface LatencySummary {
  byOperation: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number; errors: number }>;
  byModel: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number }>;
  byService: Record<string, { count: number; totalMs: number; avgMs: number; minMs: number; maxMs: number }>;
  totalLogs: number;
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

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString();
}

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<"summary" | "logs">("summary");

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
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-analytics-title">Latency Analytics</h1>
            <p className="text-sm text-muted-foreground">AI service performance tracking</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant={activeTab === "summary" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("summary")}
              data-testid="button-tab-summary"
            >
              Summary
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
          <p className="text-muted-foreground" data-testid="text-no-data">No latency data yet. Generate some dialogue or use the app to start collecting data.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Total Calls</p>
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-calls">{summary.totalLogs}</p>
          </CardContent>
        </Card>
        {Object.entries(summary.byOperation).map(([op, stats]) => (
          <Card key={op}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{OPERATION_LABELS[op] || op}</p>
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
              {Object.entries(summary.byModel).map(([model, stats]) => (
                <div key={model} className="flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-sm font-mono">{model}</span>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>avg {formatMs(stats.avgMs)}</span>
                    <span>{stats.count} calls</span>
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
              {Object.entries(summary.byService).map(([service, stats]) => (
                <div key={service} className="flex items-center justify-between gap-4 flex-wrap">
                  <Badge variant="outline">{service}</Badge>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>avg {formatMs(stats.avgMs)}</span>
                    <span>min {formatMs(stats.minMs)}</span>
                    <span>max {formatMs(stats.maxMs)}</span>
                    <span>{stats.count} calls</span>
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
        <CardTitle className="text-base">Recent Latency Logs</CardTitle>
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
