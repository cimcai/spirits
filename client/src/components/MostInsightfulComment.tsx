import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { OutboundCall, AiModel } from "@shared/schema";

interface MostInsightfulCommentProps {
  calls: OutboundCall[];
  models: AiModel[];
}

export function MostInsightfulComment({ calls, models }: MostInsightfulCommentProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todaysCalls = calls.filter((call) => {
    const callDate = new Date(call.createdAt);
    callDate.setHours(0, 0, 0, 0);
    return callDate.getTime() === today.getTime();
  });

  if (todaysCalls.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Latest Insight</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-sm">No insights triggered today yet.</p>
            <p className="text-xs mt-1">Click a philosopher's orb to add their wisdom.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const mostRecent = todaysCalls.reduce((latest, call) => {
    return new Date(call.createdAt) > new Date(latest.createdAt) ? call : latest;
  }, todaysCalls[0]);

  const model = models.find((m) => m.id === mostRecent.modelId);

  return (
    <Card data-testid="card-most-insightful">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Latest Insight</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {model && (
            <Badge
              variant="outline"
              className="gap-1.5"
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: model.color }}
              />
              {model.name}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(mostRecent.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="p-3 rounded-md border border-border/50 bg-secondary/30">
          <p className="text-sm italic" data-testid="text-insightful-response">
            "{mostRecent.responseContent}"
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {todaysCalls.length} insight{todaysCalls.length !== 1 ? 's' : ''} triggered today
        </p>
      </CardContent>
    </Card>
  );
}
