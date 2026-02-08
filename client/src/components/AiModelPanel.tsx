import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThumbsUp, ThumbsDown, Share2 } from "lucide-react";
import type { AiModel, ModelAnalysis, ResponseRating, ConversationEntry } from "@shared/schema";

interface AiModelPanelProps {
  model: AiModel;
  analyses: ModelAnalysis[];
  isProcessing?: boolean;
  roomId?: number;
  latestEntryId?: number;
  voiceEnabled?: boolean;
  buttonIndex?: number;
  entries?: ConversationEntry[];
  modelNames?: Set<string>;
}

export function AiModelPanel({ model, analyses, isProcessing = false, roomId, latestEntryId = 0, voiceEnabled = true, buttonIndex, entries = [], modelNames = new Set() }: AiModelPanelProps) {
  const { toast } = useToast();
  const [ratedAnalysisIds, setRatedAnalysisIds] = useState<Set<number>>(new Set());

  const { data: ratings = [] } = useQuery<ResponseRating[]>({
    queryKey: ["/api/models", model.id, "ratings"],
  });

  const thumbsUp = ratings.filter(r => r.rating === 1).length;
  const thumbsDown = ratings.filter(r => r.rating === -1).length;
  const totalRatings = thumbsUp + thumbsDown;
  
  const latestActiveAnalysis = analyses
    .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const latestTriggeredAnalysis = analyses
    .filter(a => a.isTriggered && a.proposedResponse)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  const analysisEntryId = latestActiveAnalysis?.conversationEntryId || 0;
  const humanMessagesSince = entries.filter(e => e.id > analysisEntryId && !modelNames.has(e.speaker)).length;
  
  const decayFactor = Math.max(0, 1 - (humanMessagesSince * 0.15));
  const rawConfidence = latestActiveAnalysis?.confidence || 0;
  const multiplier = model.confidenceMultiplier ?? 1;
  const confidence = Math.round(rawConfidence * decayFactor * multiplier);
  
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

  const rateMutation = useMutation({
    mutationFn: async ({ analysisId, rating }: { analysisId: number; rating: number }) => {
      return apiRequest("POST", `/api/analyses/${analysisId}/rate`, { rating });
    },
    onSuccess: (_, variables) => {
      setRatedAnalysisIds(prev => new Set(prev).add(variables.analysisId));
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models", model.id, "ratings"] });
      toast({
        title: variables.rating === 1 ? "Rated positively" : "Rated negatively",
        description: variables.rating === -1 
          ? `${model.name}'s confidence has been reduced` 
          : `${model.name}'s confidence has been boosted`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to rate response",
        variant: "destructive",
      });
    },
  });

  const moltbookMutation = useMutation({
    mutationFn: async (analysisId: number) => {
      return apiRequest("POST", "/api/moltbook/share-insight", { analysisId });
    },
    onSuccess: () => {
      toast({ title: "Shared to Moltbook", description: `${model.name}'s insight posted to Moltbook` });
    },
    onError: () => {
      toast({ title: "Moltbook Error", description: "Failed to share to Moltbook. Check if API key is configured.", variant: "destructive" });
    },
  });

  const handleTrigger = () => {
    if (latestActiveAnalysis) {
      triggerMutation.mutate(latestActiveAnalysis.id);
    }
  };

  const handleRate = (rating: number) => {
    if (latestTriggeredAnalysis) {
      rateMutation.mutate({ analysisId: latestTriggeredAnalysis.id, rating });
    }
  };

  const handleShareToMoltbook = () => {
    if (latestTriggeredAnalysis) {
      moltbookMutation.mutate(latestTriggeredAnalysis.id);
    }
  };

  const pulseIntensity = confidence / 100;
  const glowSize = 8 + (pulseIntensity * 24);
  const animationDuration = 2 - (pulseIntensity * 1.2);
  const orbSize = 48 + (pulseIntensity * 32);

  const showRating = latestTriggeredAnalysis && !ratedAnalysisIds.has(latestTriggeredAnalysis.id);

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
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{model.name}</CardTitle>
              {buttonIndex && (
                <Badge variant="outline" className="text-xs font-mono" data-testid={`badge-button-${model.id}`}>
                  {buttonIndex}
                </Badge>
              )}
              {multiplier !== 1 && (
                <Badge variant="secondary" className="text-xs" data-testid={`badge-multiplier-${model.id}`}>
                  {Math.round(multiplier * 100)}%
                </Badge>
              )}
              {totalRatings > 0 && (
                <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid={`text-ratings-${model.id}`}>
                  <ThumbsUp className="w-3 h-3" />{thumbsUp}
                  <ThumbsDown className="w-3 h-3 ml-1" />{thumbsDown}
                </span>
              )}
            </div>
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

        {showRating && (
          <div className="mt-3 p-3 rounded-md bg-secondary/30 border border-border/50" data-testid={`rating-panel-${model.id}`}>
            <p className="text-xs text-muted-foreground mb-2">Rate this response:</p>
            <p className="text-xs line-clamp-2 mb-2 text-muted-foreground/80">{latestTriggeredAnalysis.proposedResponse}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1"
                onClick={() => handleRate(1)}
                disabled={rateMutation.isPending}
                data-testid={`button-rate-up-${model.id}`}
              >
                <ThumbsUp className="w-3 h-3" />
                Good
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1"
                onClick={() => handleRate(-1)}
                disabled={rateMutation.isPending}
                data-testid={`button-rate-down-${model.id}`}
              >
                <ThumbsDown className="w-3 h-3" />
                Poor
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2 gap-1"
              onClick={handleShareToMoltbook}
              disabled={moltbookMutation.isPending}
              data-testid={`button-moltbook-${model.id}`}
            >
              <Share2 className="w-3 h-3" />
              {moltbookMutation.isPending ? "Sharing..." : "Share to Moltbook"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
