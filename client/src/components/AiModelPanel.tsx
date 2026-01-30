import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Zap, Activity } from "lucide-react";
import type { AiModel, ModelAnalysis } from "@shared/schema";

interface AiModelPanelProps {
  model: AiModel;
  analyses: ModelAnalysis[];
  isProcessing?: boolean;
}

export function AiModelPanel({ model, analyses, isProcessing = false }: AiModelPanelProps) {
  const latestAnalysis = analyses[analyses.length - 1];
  const avgConfidence = analyses.length > 0
    ? Math.round(analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length)
    : 0;
  const triggerCount = analyses.filter(a => a.shouldSpeak).length;

  return (
    <Card 
      className="h-full flex flex-col overflow-hidden"
      style={{ borderColor: model.color + "40" }}
      data-testid={`ai-model-panel-${model.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div 
              className="p-2 rounded-md"
              style={{ backgroundColor: model.color + "20" }}
            >
              <Bot className="h-4 w-4" style={{ color: model.color }} />
            </div>
            <div>
              <CardTitle className="text-base">{model.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{model.description}</p>
            </div>
          </div>
          {isProcessing && (
            <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30">
              <Activity className="h-3 w-3 animate-pulse" />
              Analyzing
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 pt-0">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-md bg-secondary/50">
            <p className="text-xs text-muted-foreground mb-1">Avg. Confidence</p>
            <div className="flex items-center gap-2">
              <Progress value={avgConfidence} className="h-2 flex-1" />
              <span className="text-sm font-medium">{avgConfidence}%</span>
            </div>
          </div>
          <div className="p-3 rounded-md bg-secondary/50">
            <p className="text-xs text-muted-foreground mb-1">Call Triggers</p>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-lg font-bold">{triggerCount}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent Analysis</p>
          <ScrollArea className="h-[120px]">
            {analyses.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No analysis yet...</p>
            ) : (
              <div className="space-y-2 pr-4">
                {analyses.slice(-3).reverse().map((analysis) => (
                  <div
                    key={analysis.id}
                    className="p-2 rounded-md bg-secondary/30 text-xs animate-fade-in"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-muted-foreground">
                        {new Date(analysis.createdAt).toLocaleTimeString()}
                      </span>
                      {analysis.shouldSpeak && (
                        <Badge 
                          variant="outline" 
                          className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        >
                          SPEAK
                        </Badge>
                      )}
                    </div>
                    <p className="line-clamp-2">{analysis.analysis}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
