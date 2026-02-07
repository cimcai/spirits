import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, Clock } from "lucide-react";
import type { OutboundCall, AiModel } from "@shared/schema";

interface CallLogProps {
  calls: OutboundCall[];
  models: AiModel[];
}

export function CallLog({ calls, models }: CallLogProps) {
  const getModelById = (id: number) => models.find(m => m.id === id);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Phone className="h-5 w-5 text-muted-foreground" />
        <CardTitle className="text-lg">Responses</CardTitle>
        <Badge variant="secondary" className="ml-auto">
          {calls.length}
        </Badge>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-[300px] px-4 pb-4">
          {calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
              <p className="text-sm">No responses triggered yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {calls.slice().reverse().map((call) => {
                const model = getModelById(call.modelId);

                return (
                  <div
                    key={call.id}
                    className="p-3 rounded-md border animate-slide-in-right"
                    data-testid={`call-log-${call.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: model?.color || "#888" }}
                        />
                        <span className="font-medium text-sm">{model?.name || "Unknown"}</span>
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(call.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="p-2 rounded-md bg-secondary/50">
                      <p className="text-sm">{call.responseContent}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
