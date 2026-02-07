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
import { Bot, Radio, Sparkles } from "lucide-react";
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

  // Persist voice preference
  useEffect(() => {
    localStorage.setItem("voiceEnabled", JSON.stringify(voiceEnabled));
  }, [voiceEnabled]);

  // Fetch active room
  const { data: room, isLoading: roomLoading } = useQuery<Room>({
    queryKey: ["/api/rooms/active"],
  });

  // Fetch conversation entries
  const { data: entries = [] } = useQuery<ConversationEntry[]>({
    queryKey: ["/api/rooms", room?.id, "entries"],
    enabled: !!room?.id,
  });

  // Fetch AI models
  const { data: models = [] } = useQuery<AiModel[]>({
    queryKey: ["/api/models"],
  });

  // Fetch analyses
  const { data: analyses = [] } = useQuery<ModelAnalysis[]>({
    queryKey: ["/api/rooms", room?.id, "analyses"],
    enabled: !!room?.id,
  });

  // Fetch outbound calls
  const { data: calls = [] } = useQuery<OutboundCall[]>({
    queryKey: ["/api/rooms", room?.id, "calls"],
    enabled: !!room?.id,
  });

  // Generate philosophical dialogue mutation
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

  // Reset room mutation
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

  // Generate a new philosophical dialogue message
  const generateNewDialogue = useCallback(() => {
    if (!room?.id || isGenerating) return;
    setIsGenerating(true);
    generateDialogueMutation.mutate();
  }, [room?.id, isGenerating, generateDialogueMutation]);

  // Start simulation - generate philosophical dialogue every 6 seconds
  const startSimulation = useCallback(() => {
    setIsSimulationRunning(true);
    generateNewDialogue(); // Generate first message immediately
    intervalRef.current = setInterval(() => {
      generateNewDialogue();
    }, 6000); // 6 seconds to allow for AI generation time
  }, [generateNewDialogue]);

  // Pause simulation
  const pauseSimulation = useCallback(() => {
    setIsSimulationRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Reset room
  const handleReset = useCallback(() => {
    pauseSimulation();
    resetRoomMutation.mutate();
  }, [pauseSimulation, resetRoomMutation]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Trigger philosopher and play TTS
  const triggerPhilosopher = useCallback(async (modelIndex: number) => {
    const model = models[modelIndex];
    if (!model || !room?.id) return;

    const modelAnalyses = analyses.filter((a) => a.modelId === model.id);
    const latestEntryId = entries.length > 0 ? entries[entries.length - 1].id : 0;
    
    // Get the latest untriggered analysis with a proposed response
    const latestActiveAnalysis = modelAnalyses
      .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestActiveAnalysis) return;

    // Calculate decayed confidence
    const analysisEntryId = latestActiveAnalysis.conversationEntryId || 0;
    const messagesSinceAnalysis = latestEntryId - analysisEntryId;
    const decayFactor = Math.max(0, 1 - (messagesSinceAnalysis * 0.15));
    const confidence = Math.round(latestActiveAnalysis.confidence * decayFactor);
    
    if (confidence <= 50) return; // Too stale

    try {
      // Trigger the analysis
      await apiRequest("POST", `/api/analyses/${latestActiveAnalysis.id}/trigger`, {});
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "analyses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "calls"] });

      toast({
        title: `${model.name} spoke!`,
        description: "Response added to the conversation",
      });

      // Play TTS for the response (only if voice is enabled)
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

  // Keyboard shortcuts for triggering philosophers (1, 2, 3 keys)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if (e.key === "1") triggerPhilosopher(0);
      else if (e.key === "2") triggerPhilosopher(1);
      else if (e.key === "3") triggerPhilosopher(2);
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [triggerPhilosopher]);

  // Get analyses for a specific model
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
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Philosophical Insight</h1>
              <p className="text-sm text-muted-foreground">
                AI philosophers in dialogue
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {room && (
              <Badge variant="outline" className="gap-2">
                <Radio className="h-3 w-3" />
                {room.name}
              </Badge>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Info Banner */}
        <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Philosophical Insight</p>
            <p className="text-sm text-muted-foreground">
              Watch philosophical dialogue unfold in real-time. Three AI philosophers analyze the conversation and offer their unique perspectives.
              Click their pulsing lights when you want to hear their wisdom.
            </p>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column - Conversation Stream */}
          <div className="lg:col-span-5">
            <ConversationStream entries={entries} isLive={isSimulationRunning} />
          </div>

          {/* Middle Column - AI Models */}
          <div className="lg:col-span-4 space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Active AI Models ({models.length})
            </h2>
            {models.length === 0 ? (
              <div className="p-8 rounded-lg border border-dashed text-center text-muted-foreground">
                <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No AI models configured</p>
              </div>
            ) : (
              <div className="space-y-4">
                {models.map((model) => (
                  <AiModelPanel
                    key={model.id}
                    model={model}
                    analyses={getModelAnalyses(model.id)}
                    isProcessing={isGenerating}
                    roomId={room?.id}
                    latestEntryId={entries.length > 0 ? entries[entries.length - 1].id : 0}
                    voiceEnabled={voiceEnabled}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right Column - Controls & Calls */}
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
