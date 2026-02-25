import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Send, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { ConversationEntry } from "@shared/schema";

export default function OpenForum() {
  const { toast } = useToast();
  const [speaker, setSpeaker] = useState(() => localStorage.getItem("forumSpeaker") || "");
  const [message, setMessage] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  const prevCount = useRef(0);

  const { data: entries = [] } = useQuery<ConversationEntry[]>({
    queryKey: ["/api/open-forum/entries"],
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (speaker) localStorage.setItem("forumSpeaker", speaker);
  }, [speaker]);

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    wasNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkNearBottom, { passive: true });
    return () => el.removeEventListener("scroll", checkNearBottom);
  }, [checkNearBottom]);

  useEffect(() => {
    if (entries.length > prevCount.current && wasNearBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevCount.current = entries.length;
  }, [entries]);

  const handlePost = async () => {
    if (!speaker.trim() || !message.trim()) {
      toast({ title: "Enter your name and a message", variant: "destructive" });
      return;
    }
    setIsPosting(true);
    try {
      const res = await fetch("/api/open-forum/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker: speaker.trim(), content: message.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error, variant: "destructive" });
        return;
      }
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/open-forum/entries"] });
    } catch {
      toast({ title: "Failed to post", variant: "destructive" });
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Main Room
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">Open Forum</h1>
          </div>
          <Badge variant="outline" className="ml-auto">{entries.length} messages</Badge>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">
              Anyone can post here — no moderation, no approval needed. Philosophers analyze every message.
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              ref={scrollRef}
              className="h-[500px] overflow-y-auto space-y-3 border rounded-md p-4 bg-muted/30"
              data-testid="forum-messages"
            >
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No messages yet. Be the first to post!
                </p>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id} className="animate-fade-in" data-testid={`forum-entry-${entry.id}`}>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="shrink-0 font-medium">
                        {entry.speaker}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-relaxed">{entry.content}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2" data-testid="forum-compose">
              <Input
                placeholder="Your name"
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value)}
                className="w-32 flex-shrink-0"
                data-testid="input-forum-speaker"
              />
              <Input
                placeholder="Type a message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handlePost()}
                className="flex-1"
                data-testid="input-forum-message"
              />
              <Button
                onClick={handlePost}
                disabled={isPosting || !speaker.trim() || !message.trim()}
                data-testid="button-forum-send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
