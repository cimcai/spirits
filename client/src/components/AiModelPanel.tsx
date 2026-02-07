import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AiModel, ModelAnalysis } from "@shared/schema";

interface AiModelPanelProps {
  model: AiModel;
  analyses: ModelAnalysis[];
  isProcessing?: boolean;
  roomId?: number;
  latestEntryId?: number;
  voiceEnabled?: boolean;
}

export function AiModelPanel({ model, analyses, isProcessing = false, roomId, latestEntryId = 0, voiceEnabled = true }: AiModelPanelProps) {
  const { toast } = useToast();
  
  const latestActiveAnalysis = analyses
    .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const analysisEntryId = latestActiveAnalysis?.conversationEntryId || 0;
  const messagesSinceAnalysis = latestEntryId - analysisEntryId;
  
  const decayFactor = Math.max(0, 1 - (messagesSinceAnalysis * 0.15));
  const rawConfidence = latestActiveAnalysis?.confidence || 0;
  const confidence = Math.round(rawConfidence * decayFactor);
  
  const hasResponse = !!latestActiveAnalysis?.proposedResponse && confidence > 50;

  const playTTS = async (text: string) => {
    try {
      const audioResponse = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: model.voice || "alloy" }),
      });
      
      if (audioResponse.ok) {
        const audioBlob = await audioResponse.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
      }
    } catch (error) {
      console.error("TTS error:", error);
    }
  };

  const triggerMutation = useMutation({
    mutationFn: async (analysisId: number) => {
      return apiRequest("POST", `/api/analyses/${analysisId}/trigger`, {});
    },
    onSuccess: () => {
      if (roomId) {
        queryClient.invalidateQueries({ queryKey: ["/api/rooms", roomId, "entries"] });
        queryClient.invalidateQueries({ queryKey: ["/api/rooms", roomId, "analyses"] });
        queryClient.invalidateQueries({ queryKey: ["/api/rooms", roomId, "calls"] });
      }
      toast({
        title: `${model.name} spoke!`,
        description: "Response added to the conversation",
      });
      
      if (voiceEnabled && latestActiveAnalysis?.proposedResponse) {
        playTTS(latestActiveAnalysis.proposedResponse);
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to trigger response",
        variant: "destructive",
      });
    },
  });

  const handleTrigger = () => {
    if (latestActiveAnalysis) {
      triggerMutation.mutate(latestActiveAnalysis.id);
    }
  };

  const pulseIntensity = confidence / 100;
  const glowSize = 8 + (pulseIntensity * 24);
  const animationDuration = 2 - (pulseIntensity * 1.2);
  const orbSize = 48 + (pulseIntensity * 32);

  return (
    <Card 
      className="relative"
      data-testid={`ai-model-panel-${model.id}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: hasResponse ? model.color : undefined, opacity: hasResponse ? 1 : 0.3, border: hasResponse ? 'none' : '1px solid hsl(var(--border))' }}
          />
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{model.name}</CardTitle>
            <p className="text-xs text-muted-foreground truncate">{model.description}</p>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="flex flex-col items-center py-4">
          <button
            onClick={handleTrigger}
            disabled={!hasResponse || triggerMutation.isPending}
            className="relative group focus:outline-none disabled:cursor-not-allowed"
            data-testid={`trigger-light-${model.id}`}
            aria-label={`Trigger ${model.name} response`}
          >
            {hasResponse && (
              <>
                <div
                  className="absolute inset-0 rounded-full blur-xl transition-all"
                  style={{
                    backgroundColor: model.color,
                    opacity: 0.15 + (pulseIntensity * 0.25),
                    transform: `scale(${1.5 + pulseIntensity})`,
                    animation: `pulse ${animationDuration}s ease-in-out infinite`,
                  }}
                />
                <div
                  className="absolute inset-0 rounded-full blur-md transition-all"
                  style={{
                    backgroundColor: model.color,
                    opacity: 0.2 + (pulseIntensity * 0.3),
                    transform: `scale(${1.2 + pulseIntensity * 0.5})`,
                    animation: `pulse ${animationDuration}s ease-in-out infinite`,
                    animationDelay: `${animationDuration * 0.3}s`,
                  }}
                />
              </>
            )}
            
            <div
              className="relative rounded-full flex items-center justify-center transition-all duration-500 group-hover:scale-110"
              style={{
                width: `${orbSize}px`,
                height: `${orbSize}px`,
                backgroundColor: hasResponse ? model.color : 'hsl(var(--muted))',
                boxShadow: hasResponse 
                  ? `0 0 ${glowSize}px ${model.color}, 0 0 ${glowSize * 2}px ${model.color}40`
                  : "none",
                opacity: hasResponse ? 0.7 + (pulseIntensity * 0.3) : 0.2,
              }}
            />
          </button>

          <div className="mt-4 text-center">
            {hasResponse || isProcessing ? (
              <>
                <p 
                  className="text-2xl font-bold transition-all duration-300" 
                  style={{ opacity: isProcessing ? 0.6 : 1 }}
                >
                  {confidence}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {isProcessing ? (
                    <span className="animate-pulse">Analyzing...</span>
                  ) : (
                    "Value Score"
                  )}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Waiting...</p>
            )}
          </div>
        </div>

        {hasResponse && latestActiveAnalysis && (
          <div className="mt-2 p-3 rounded-md bg-secondary/50 border border-border/50">
            <p className="text-xs text-muted-foreground mb-1">Proposed Response:</p>
            <p className="text-sm line-clamp-3">{latestActiveAnalysis.proposedResponse}</p>
            <Button
              onClick={handleTrigger}
              disabled={triggerMutation.isPending}
              size="sm"
              className="w-full mt-3"
              data-testid={`button-speak-${model.id}`}
            >
              {triggerMutation.isPending ? "Speaking..." : "Click to Speak"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
