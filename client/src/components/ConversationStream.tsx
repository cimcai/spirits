import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Radio } from "lucide-react";
import type { ConversationEntry } from "@shared/schema";

interface ConversationStreamProps {
  entries: ConversationEntry[];
  isLive?: boolean;
}

const speakerColors: Record<string, string> = {
  "Alice": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "Bob": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "Carol": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "David": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "System": "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function getSpeakerColor(speaker: string): string {
  return speakerColors[speaker] || "bg-primary/20 text-primary border-primary/30";
}

export function ConversationStream({ entries, isLive = false }: ConversationStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Conversation Stream</CardTitle>
        </div>
        {isLive && (
          <Badge variant="outline" className="gap-1.5 bg-red-500/10 text-red-400 border-red-500/30">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            Live
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-[400px] px-4 pb-4">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
              <Radio className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Waiting for conversation...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry, index) => (
                <div
                  key={entry.id}
                  className="animate-fade-in"
                  data-testid={`conversation-entry-${entry.id}`}
                >
                  <div className="flex items-start gap-3">
                    <Badge
                      variant="outline"
                      className={`${getSpeakerColor(entry.speaker)} shrink-0 font-medium`}
                    >
                      {entry.speaker}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed text-foreground">
                        {entry.content}
                        {index === entries.length - 1 && isLive && (
                          <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-blink"></span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
