import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, PhoneCall, PhoneOff, Clock } from "lucide-react";
import type { OutboundCall, AiModel } from "@shared/schema";

interface CallLogProps {
  calls: OutboundCall[];
  models: AiModel[];
}

const statusConfig: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
  pending: {
    icon: <Clock className="h-3 w-3" />,
    className: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    label: "Pending"
  },
  completed: {
    icon: <PhoneCall className="h-3 w-3" />,
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    label: "Completed"
  },
  failed: {
    icon: <PhoneOff className="h-3 w-3" />,
    className: "bg-red-500/10 text-red-400 border-red-500/30",
    label: "Failed"
  },
};

export function CallLog({ calls, models }: CallLogProps) {
  const getModelById = (id: number) => models.find(m => m.id === id);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center gap-2 pb-3">
        <Phone className="h-5 w-5 text-primary" />
        <CardTitle className="text-lg">Outbound Calls</CardTitle>
        <Badge variant="secondary" className="ml-auto">
          {calls.length}
        </Badge>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-[300px] px-4 pb-4">
          {calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
              <Phone className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No calls triggered yet</p>
              <p className="text-xs mt-1">Calls appear when AI models decide to speak</p>
            </div>
          ) : (
            <div className="space-y-3">
              {calls.slice().reverse().map((call) => {
                const model = getModelById(call.modelId);
                const status = statusConfig[call.status] || statusConfig.pending;

                return (
                  <div
                    key={call.id}
                    className="p-3 rounded-md border bg-card animate-slide-in-right"
                    data-testid={`call-log-${call.id}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: model?.color || "#6366f1" }}
                        />
                        <span className="font-medium text-sm">{model?.name || "Unknown Model"}</span>
                      </div>
                      <Badge variant="outline" className={`gap-1 ${status.className}`}>
                        {status.icon}
                        {status.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Trigger: {call.triggerReason}
                    </p>
                    <div className="p-2 rounded bg-secondary/50">
                      <p className="text-sm">{call.responseContent}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(call.createdAt).toLocaleString()}
                    </p>
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
