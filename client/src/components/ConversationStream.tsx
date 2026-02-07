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
          <MessageCircle className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Conversation</CardTitle>
        </div>
        {isLive && (
          <Badge variant="outline" className="gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-foreground"></span>
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
                    <Badge variant="outline" className="shrink-0 font-medium">
                      {entry.speaker}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed text-foreground">
                        {entry.content}
                        {index === entries.length - 1 && isLive && (
                          <span className="inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-blink"></span>
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
