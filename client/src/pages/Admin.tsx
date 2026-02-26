import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, Check, X, Clock, Pencil, Lock, Shield, Download, FileText, Table, FileJson } from "lucide-react";
import type { PendingSubmission } from "@shared/schema";

type FilterStatus = "pending" | "approved" | "rejected" | "all";
type AdminTab = "moderation" | "export";

function SubmissionCard({
  submission,
  onApprove,
  onReject,
  isPending,
}: {
  submission: PendingSubmission;
  onApprove: (id: number, editedSpeaker?: string, editedContent?: string, reviewNote?: string) => void;
  onReject: (id: number, reviewNote?: string) => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editedSpeaker, setEditedSpeaker] = useState(submission.speaker);
  const [editedContent, setEditedContent] = useState(submission.content);
  const [reviewNote, setReviewNote] = useState("");

  const statusColor = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    approved: "bg-green-500/20 text-green-400 border-green-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  }[submission.status] || "";

  return (
    <Card className="border-border" data-testid={`card-submission-${submission.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm" data-testid={`text-speaker-${submission.id}`}>{submission.speaker}</span>
              <Badge variant="outline" className={`text-xs ${statusColor}`}>{submission.status}</Badge>
              <span className="text-xs text-muted-foreground">via {submission.source}</span>
            </div>
            <p className="text-sm text-muted-foreground break-words" data-testid={`text-content-${submission.id}`}>{submission.content}</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {new Date(submission.createdAt).toLocaleString()}
            </p>
            {submission.reviewNote && (
              <p className="text-xs text-muted-foreground mt-1 italic">Note: {submission.reviewNote}</p>
            )}
          </div>
        </div>

        {submission.status === "pending" && (
          <div className="mt-3 space-y-2">
            {editing ? (
              <div className="space-y-2 p-2 bg-muted rounded">
                <Input
                  value={editedSpeaker}
                  onChange={e => setEditedSpeaker(e.target.value)}
                  placeholder="Speaker name"
                  className="text-sm"
                  data-testid={`input-edit-speaker-${submission.id}`}
                />
                <Textarea
                  value={editedContent}
                  onChange={e => setEditedContent(e.target.value)}
                  placeholder="Content"
                  className="text-sm"
                  rows={2}
                  data-testid={`input-edit-content-${submission.id}`}
                />
                <Input
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  placeholder="Review note (optional)"
                  className="text-sm"
                  data-testid={`input-review-note-${submission.id}`}
                />
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(!editing)}
                className="gap-1"
                data-testid={`button-edit-${submission.id}`}
              >
                <Pencil className="w-3 h-3" />
                {editing ? "Cancel Edit" : "Edit"}
              </Button>
              <Button
                size="sm"
                onClick={() => onApprove(
                  submission.id,
                  editing ? editedSpeaker : undefined,
                  editing ? editedContent : undefined,
                  reviewNote || undefined
                )}
                disabled={isPending}
                className="gap-1 bg-green-600 hover:bg-green-700"
                data-testid={`button-approve-${submission.id}`}
              >
                <Check className="w-3 h-3" /> Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onReject(submission.id, reviewNote || undefined)}
                disabled={isPending}
                className="gap-1"
                data-testid={`button-reject-${submission.id}`}
              >
                <X className="w-3 h-3" /> Reject
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModerationTab() {
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const { toast } = useToast();

  const { data: submissions = [], isLoading } = useQuery<PendingSubmission[]>({
    queryKey: ["/api/admin/queue", filter === "all" ? undefined : filter],
    queryFn: async () => {
      const params = filter !== "all" ? `?status=${filter}` : "";
      const res = await fetch(`/api/admin/queue${params}`);
      if (!res.ok) throw new Error("Failed to fetch queue");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, editedSpeaker, editedContent, reviewNote }: {
      id: number; editedSpeaker?: string; editedContent?: string; reviewNote?: string;
    }) => {
      const res = await apiRequest("POST", `/api/admin/queue/${id}/approve`, {
        editedSpeaker, editedContent, reviewNote,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms"] });
      toast({ title: "Approved", description: data.message });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reviewNote }: { id: number; reviewNote?: string }) => {
      const res = await apiRequest("POST", `/api/admin/queue/${id}/reject`, { reviewNote });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queue"] });
      toast({ title: "Rejected", description: data.message });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
    },
  });

  const pendingCount = submissions.filter(s => s.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {(["pending", "approved", "rejected", "all"] as FilterStatus[]).map(status => (
          <Button
            key={status}
            variant={filter === status ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(status)}
            data-testid={`button-filter-${status}`}
          >
            {status === "pending" && pendingCount > 0 ? `Pending (${pendingCount})` : status.charAt(0).toUpperCase() + status.slice(1)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : submissions.length === 0 ? (
        <Card className="border-border">
          <CardContent className="p-6 text-center text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No {filter !== "all" ? filter : ""} submissions</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {submissions.map(sub => (
            <SubmissionCard
              key={sub.id}
              submission={sub}
              onApprove={(id, es, ec, rn) => approveMutation.mutate({ id, editedSpeaker: es, editedContent: ec, reviewNote: rn })}
              onReject={(id, rn) => rejectMutation.mutate({ id, reviewNote: rn })}
              isPending={approveMutation.isPending || rejectMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExportTab() {
  const [format, setFormat] = useState<"txt" | "csv" | "json">("txt");
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [roomId] = useState(1);

  const { data: speakers } = useQuery<string[]>({
    queryKey: ["/api/rooms", roomId, "speakers"],
    queryFn: async () => {
      const res = await fetch(`/api/rooms/${roomId}/speakers`);
      return res.json();
    },
  });

  const toggleSpeaker = (speaker: string) => {
    setSelectedSpeakers(prev =>
      prev.includes(speaker) ? prev.filter(s => s !== speaker) : [...prev, speaker]
    );
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    params.set("format", format);
    if (selectedSpeakers.length > 0) params.set("speakers", selectedSpeakers.join(","));
    if (startDate) params.set("start", new Date(startDate).toISOString());
    if (endDate) params.set("end", new Date(endDate + "T23:59:59").toISOString());
    const url = `/api/rooms/${roomId}/export?${params.toString()}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatOptions = [
    { value: "txt" as const, label: "Text", icon: FileText },
    { value: "csv" as const, label: "CSV", icon: Table },
    { value: "json" as const, label: "JSON", icon: FileJson },
  ];

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium text-muted-foreground mb-2 block">Format</label>
        <div className="flex gap-2">
          {formatOptions.map(opt => (
            <Button
              key={opt.value}
              variant={format === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setFormat(opt.value)}
              className="flex-1 gap-1.5"
              data-testid={`button-format-${opt.value}`}
            >
              <opt.icon className="w-3.5 h-3.5" />
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-muted-foreground mb-2 block">
          Time Period <span className="text-xs text-muted-foreground/60">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="flex-1 bg-muted border border-border rounded px-2 py-1.5 text-sm"
            data-testid="input-start-date"
          />
          <span className="text-muted-foreground self-center text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="flex-1 bg-muted border border-border rounded px-2 py-1.5 text-sm"
            data-testid="input-end-date"
          />
        </div>
      </div>

      {speakers && speakers.length > 0 && (
        <div>
          <label className="text-sm font-medium text-muted-foreground mb-2 block">
            Speakers <span className="text-xs text-muted-foreground/60">({selectedSpeakers.length === 0 ? "all" : `${selectedSpeakers.length} selected`})</span>
          </label>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1" data-testid="speaker-filter-list">
            {speakers.map(speaker => (
              <button
                key={speaker}
                onClick={() => toggleSpeaker(speaker)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  selectedSpeakers.includes(speaker)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:border-primary/50"
                }`}
                data-testid={`button-speaker-${speaker}`}
              >
                {speaker}
              </button>
            ))}
          </div>
        </div>
      )}

      <Button onClick={handleExport} className="w-full gap-2" data-testid="button-export-download">
        <Download className="w-4 h-4" />
        Export {format.toUpperCase()}
      </Button>
    </div>
  );
}

export default function Admin() {
  const [authenticated, setAuthenticated] = useState(() => {
    return sessionStorage.getItem("adminAuth") === "true";
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("moderation");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthenticated(true);
        sessionStorage.setItem("adminAuth", "true");
      } else {
        setError("Invalid password");
      }
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  };

  const handleLogout = () => {
    setAuthenticated(false);
    sessionStorage.removeItem("adminAuth");
    setPassword("");
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" data-testid="page-admin-login">
        <Card className="w-full max-w-sm mx-4">
          <CardHeader className="text-center pb-4">
            <Lock className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <CardTitle className="text-lg">Admin Access</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-3">
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter admin password"
                autoFocus
                data-testid="input-admin-password"
              />
              {error && <p className="text-sm text-destructive" data-testid="text-auth-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || !password} data-testid="button-admin-login">
                {loading ? "Checking..." : "Enter"}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Link href="/">
                <Button variant="ghost" size="sm" className="text-muted-foreground gap-1" data-testid="button-back">
                  <ArrowLeft className="w-3 h-3" /> Back
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="page-admin">
      <header className="border-b sticky top-0 z-50 bg-background">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            </Link>
            <h1 className="text-lg font-semibold flex items-center gap-2" data-testid="text-admin-title">
              <Shield className="w-4 h-4" /> Admin
            </h1>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground" data-testid="button-logout">
            Logout
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === "moderation" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("moderation")}
            className="gap-1.5"
            data-testid="button-tab-moderation"
          >
            <Shield className="w-3.5 h-3.5" /> Moderation Queue
          </Button>
          <Button
            variant={activeTab === "export" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("export")}
            className="gap-1.5"
            data-testid="button-tab-export"
          >
            <Download className="w-3.5 h-3.5" /> Export Transcripts
          </Button>
        </div>

        {activeTab === "moderation" ? <ModerationTab /> : <ExportTab />}
      </main>
    </div>
  );
}
