import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ConversationStream } from "@/components/ConversationStream";
import { AiModelPanel } from "@/components/AiModelPanel";
import { CallLog } from "@/components/CallLog";
import { SimulationControls } from "@/components/SimulationControls";
import { MostInsightfulComment } from "@/components/MostInsightfulComment";
import { ModelConfigPanel } from "@/components/ModelConfigPanel";
import { LiveAudioCapture } from "@/components/LiveAudioCapture";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Radio, BarChart3 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { Room, ConversationEntry, AiModel, ModelAnalysis, OutboundCall } from "@shared/schema";


export default function Dashboard() {
  const { toast } = useToast();
  const [isSimulationRunning, setIsSimulationRunning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    const saved = localStorage.getItem("voiceEnabled");
    return saved !== null ? JSON.parse(saved) : true;
  });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    localStorage.setItem("voiceEnabled", JSON.stringify(voiceEnabled));
  }, [voiceEnabled]);

  const { data: room, isLoading: roomLoading } = useQuery<Room>({
    queryKey: ["/api/rooms/active"],
  });

  const { data: entries = [] } = useQuery<ConversationEntry[]>({
    queryKey: ["/api/rooms", room?.id, "entries"],
    enabled: !!room?.id,
  });

  const { data: models = [] } = useQuery<AiModel[]>({
    queryKey: ["/api/models"],
  });

  const { data: analyses = [] } = useQuery<ModelAnalysis[]>({
    queryKey: ["/api/rooms", room?.id, "analyses"],
    enabled: !!room?.id,
  });

  const { data: calls = [] } = useQuery<OutboundCall[]>({
    queryKey: ["/api/rooms", room?.id, "calls"],
    enabled: !!room?.id,
  });

  const generateDialogueMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/rooms/${room?.id}/generate-dialogue`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "analyses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "calls"] });
      setIsGenerating(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate dialogue",
        variant: "destructive",
      });
      setIsGenerating(false);
    },
  });

  const resetRoomMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/rooms/${room?.id}/reset`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "analyses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "calls"] });
      toast({
        title: "Room Reset",
        description: "Conversation has been cleared",
      });
    },
  });

  const generateNewDialogue = useCallback(() => {
    if (!room?.id || isGenerating) return;
    setIsGenerating(true);
    generateDialogueMutation.mutate();
  }, [room?.id, isGenerating, generateDialogueMutation]);

  const startSimulation = useCallback(() => {
    setIsSimulationRunning(true);
    generateNewDialogue();
    intervalRef.current = setInterval(() => {
      generateNewDialogue();
    }, 6000);
  }, [generateNewDialogue]);

  const pauseSimulation = useCallback(() => {
    setIsSimulationRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handleReset = useCallback(() => {
    pauseSimulation();
    resetRoomMutation.mutate();
  }, [pauseSimulation, resetRoomMutation]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Compute effective confidence for each model to determine top-3 button mapping
  const getEffectiveConfidence = useCallback((model: AiModel) => {
    const modelAn = analyses.filter((a) => a.modelId === model.id);
    const latestEntryId = entries.length > 0 ? entries[entries.length - 1].id : 0;
    const latestActiveAnalysis = modelAn
      .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (!latestActiveAnalysis) return 0;
    const analysisEntryId = latestActiveAnalysis.conversationEntryId || 0;
    const messagesSinceAnalysis = latestEntryId - analysisEntryId;
    const decayFactor = Math.max(0, 1 - (messagesSinceAnalysis * 0.15));
    return Math.round(latestActiveAnalysis.confidence * decayFactor * (model.confidenceMultiplier ?? 1));
  }, [analyses, entries]);

  // Top 3 models by effective confidence get button mapping
  const top3ModelIds = [...models]
    .map(m => ({ id: m.id, confidence: getEffectiveConfidence(m) }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map(m => m.id);

  const triggerPhilosopherById = useCallback(async (modelId: number) => {
    const model = models.find(m => m.id === modelId);
    if (!model || !room?.id) return;

    const modelAn = analyses.filter((a) => a.modelId === model.id);
    const latestEntryId = entries.length > 0 ? entries[entries.length - 1].id : 0;
    
    const latestActiveAnalysis = modelAn
      .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestActiveAnalysis) return;

    const analysisEntryId = latestActiveAnalysis.conversationEntryId || 0;
    const messagesSinceAnalysis = latestEntryId - analysisEntryId;
    const decayFactor = Math.max(0, 1 - (messagesSinceAnalysis * 0.15));
    const confidence = Math.round(latestActiveAnalysis.confidence * decayFactor * (model.confidenceMultiplier ?? 1));
    
    if (confidence <= 50) return;

    try {
      await apiRequest("POST", `/api/analyses/${latestActiveAnalysis.id}/trigger`, {});
      
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "analyses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "calls"] });

      toast({
        title: `${model.name} spoke!`,
        description: "Response added to the conversation",
      });

      if (voiceEnabled && latestActiveAnalysis.proposedResponse) {
        const audioResponse = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            text: latestActiveAnalysis.proposedResponse,
            voice: model.voice || "alloy"
          }),
        });
        
        if (audioResponse.ok) {
          const audioBlob = await audioResponse.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          audio.play();
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to trigger response",
        variant: "destructive",
      });
    }
  }, [models, analyses, entries, room, toast, voiceEnabled]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if (e.key === "1" && top3ModelIds[0]) triggerPhilosopherById(top3ModelIds[0]);
      else if (e.key === "2" && top3ModelIds[1]) triggerPhilosopherById(top3ModelIds[1]);
      else if (e.key === "3" && top3ModelIds[2]) triggerPhilosopherById(top3ModelIds[2]);
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [triggerPhilosopherById, top3ModelIds]);

  const getModelAnalyses = (modelId: number) => {
    return analyses.filter((a) => a.modelId === modelId);
  };

  if (roomLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-[500px]" />
            <Skeleton className="h-[500px]" />
            <Skeleton className="h-[500px]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 z-50 bg-background">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-app-title">CIMC Spirits</h1>
            <p className="text-sm text-muted-foreground">
              AI philosophers in dialogue
            </p>
          </div>
          <div className="flex items-center gap-3">
            {room && (
              <Badge variant="outline" className="gap-2">
                <Radio className="h-3 w-3" />
                {room.name}
              </Badge>
            )}
            <Link href="/analytics">
              <Button variant="ghost" size="icon" data-testid="button-analytics">
                <BarChart3 />
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <ConversationStream entries={entries} isLive={isSimulationRunning} />
          </div>

          <div className="lg:col-span-4 space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              Philosophers ({models.length})
            </h2>
            {models.length === 0 ? (
              <div className="p-8 rounded-md border border-dashed text-center text-muted-foreground">
                <p className="text-sm">No AI models configured</p>
              </div>
            ) : (
              <div className="space-y-4">
                {models.map((model) => {
                  const btnIdx = top3ModelIds.indexOf(model.id);
                  return (
                    <AiModelPanel
                      key={model.id}
                      model={model}
                      analyses={getModelAnalyses(model.id)}
                      isProcessing={isGenerating}
                      roomId={room?.id}
                      latestEntryId={entries.length > 0 ? entries[entries.length - 1].id : 0}
                      voiceEnabled={voiceEnabled}
                      buttonIndex={btnIdx >= 0 ? btnIdx + 1 : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:col-span-3 space-y-6">
            <SimulationControls
              isRunning={isSimulationRunning}
              onStart={startSimulation}
              onPause={pauseSimulation}
              onReset={handleReset}
              onTriggerSample={generateNewDialogue}
              entryCount={entries.length}
              callCount={calls.length}
              isGenerating={isGenerating}
              voiceEnabled={voiceEnabled}
              onVoiceToggle={setVoiceEnabled}
            />
            <LiveAudioCapture roomId={room?.id} />
            <MostInsightfulComment calls={calls} models={models} />
            <ModelConfigPanel models={models} />
            <CallLog calls={calls} models={models} />
          </div>
        </div>
      </main>
    </div>
  );
}
