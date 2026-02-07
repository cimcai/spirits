import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { ArrowLeft, Check, X, Clock, MessageSquare, Send, Pencil } from "lucide-react";
import type { PendingSubmission } from "@shared/schema";

type FilterStatus = "pending" | "approved" | "rejected" | "all";

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

  const statusColors: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    approved: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const isActionable = submission.status === "pending";

  return (
    <Card data-testid={`card-submission-${submission.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${statusColors[submission.status] || ""} no-default-hover-elevate no-default-active-elevate text-xs`}>
              {submission.status === "pending" && <Clock className="w-3 h-3 mr-1" />}
              {submission.status === "approved" && <Check className="w-3 h-3 mr-1" />}
              {submission.status === "rejected" && <X className="w-3 h-3 mr-1" />}
              {submission.status}
            </Badge>
            <Badge variant="outline" className="text-xs font-mono">{submission.source}</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(submission.createdAt).toLocaleString()}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Speaker</label>
              <Input
                value={editedSpeaker}
                onChange={(e) => setEditedSpeaker(e.target.value)}
                data-testid={`input-edit-speaker-${submission.id}`}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Content</label>
              <Textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                rows={4}
                data-testid={`input-edit-content-${submission.id}`}
              />
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold mb-1" data-testid={`text-speaker-${submission.id}`}>{submission.speaker}</p>
            <p className="text-sm text-muted-foreground" data-testid={`text-content-${submission.id}`}>{submission.content}</p>
          </div>
        )}

        {submission.reviewNote && (
          <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
            <span className="font-semibold">Review note:</span> {submission.reviewNote}
            {submission.reviewedBy && <span> (by {submission.reviewedBy})</span>}
          </div>
        )}

        {isActionable && (
          <div className="space-y-2 border-t pt-3">
            <Input
              placeholder="Review note (optional)"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              className="text-sm"
              data-testid={`input-review-note-${submission.id}`}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(!editing)}
                data-testid={`button-edit-${submission.id}`}
              >
                <Pencil className="w-3 h-3 mr-1" />
                {editing ? "Cancel Edit" : "Edit"}
              </Button>
              <div className="flex-1" />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onReject(submission.id, reviewNote)}
                disabled={isPending}
                data-testid={`button-reject-${submission.id}`}
              >
                <X className="w-3 h-3 mr-1" />
                Reject
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const speaker = editing && editedSpeaker !== submission.speaker ? editedSpeaker : undefined;
                  const content = editing && editedContent !== submission.content ? editedContent : undefined;
                  onApprove(submission.id, speaker, content, reviewNote);
                }}
                disabled={isPending}
                data-testid={`button-approve-${submission.id}`}
              >
                <Check className="w-3 h-3 mr-1" />
                Approve
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminQueue() {
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
        editedSpeaker,
        editedContent,
        reviewNote,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queue"] });
      toast({ title: "Rejected", description: "Submission rejected" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/moltbook/invite-agents", {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Posted to Moltbook", description: `Summary posted. ${data.summary?.slice(0, 80)}...` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to post to Moltbook. Is MOLTBOOK_API_KEY set?", variant: "destructive" });
    },
  });

  const handleApprove = (id: number, editedSpeaker?: string, editedContent?: string, reviewNote?: string) => {
    approveMutation.mutate({ id, editedSpeaker, editedContent, reviewNote });
  };

  const handleReject = (id: number, reviewNote?: string) => {
    rejectMutation.mutate({ id, reviewNote });
  };

  const pendingCount = submissions.filter(s => s.status === "pending").length;
  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  const filters: { value: FilterStatus; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold" data-testid="text-queue-title">Moderation Queue</h1>
            <p className="text-sm text-muted-foreground">
              Review external bot submissions before they enter the conversation
            </p>
          </div>
          {pendingCount > 0 && (
            <Badge variant="outline" className="text-sm" data-testid="text-pending-count">
              {pendingCount} pending
            </Badge>
          )}
        </div>

        <Card className="mb-6">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Invite external agents to contribute via Moltbook</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending}
                data-testid="button-invite-agents"
              >
                <Send className="w-3 h-3 mr-1" />
                {inviteMutation.isPending ? "Posting..." : "Post Summary to Moltbook"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {filters.map(f => (
            <Button
              key={f.value}
              variant={filter === f.value ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilter(f.value)}
              data-testid={`button-filter-${f.value}`}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="h-4 bg-muted rounded w-1/3 mb-2 animate-pulse" />
                  <div className="h-3 bg-muted rounded w-full mb-1 animate-pulse" />
                  <div className="h-3 bg-muted rounded w-2/3 animate-pulse" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : submissions.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <Clock className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground" data-testid="text-empty-queue">
                {filter === "pending"
                  ? "No pending submissions. Post a summary to Moltbook to invite agents!"
                  : `No ${filter} submissions found.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {submissions.map(s => (
              <SubmissionCard
                key={s.id}
                submission={s}
                onApprove={handleApprove}
                onReject={handleReject}
                isPending={isMutating}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}