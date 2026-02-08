import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { Radio, BarChart3, BookOpen, Shield, Download, Mic } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { Room, ConversationEntry, AiModel, ModelAnalysis, OutboundCall } from "@shared/schema";


export default function Dashboard() {
  const { toast } = useToast();
  const [isSimulationRunning, setIsSimulationRunning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showPersonaPlex, setShowPersonaPlex] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    const saved = localStorage.getItem("voiceEnabled");
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [ttsSpeaker, setTtsSpeaker] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSeenCallIdRef = useRef<number>(0);
  const ttsPlayingRef = useRef<boolean>(false);

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
    refetchInterval: 3000,
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
  const philosopherNames = useMemo(() => new Set(models.map(m => m.name)), [models]);

  const getEffectiveConfidence = useCallback((model: AiModel) => {
    const modelAn = analyses.filter((a) => a.modelId === model.id);
    const latestActiveAnalysis = modelAn
      .filter(a => !a.isTriggered && a.proposedResponse && a.confidence > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (!latestActiveAnalysis) return 0;
    const analysisEntryId = latestActiveAnalysis.conversationEntryId || 0;
    const humanMessagesSince = entries.filter(e => e.id > analysisEntryId && !philosopherNames.has(e.speaker)).length;
    const decayFactor = Math.max(0, 1 - (humanMessagesSince * 0.15));
    return Math.round(latestActiveAnalysis.confidence * decayFactor * (model.confidenceMultiplier ?? 1));
  }, [analyses, entries, philosopherNames]);

  // Top 3 models by effective confidence get button mapping
  const top3ModelIds = [...models]
    .map(m => ({ id: m.id, confidence: getEffectiveConfidence(m) }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map(m => m.id);

  const triggerPhilosopherById = useCallback(async (modelId: number) => {
    const model = models.find(m => m.id === modelId);
    if (!model || !room?.id) return;

    if (entries.length === 0) {
      toast({
        title: `${model.name} has nothing to say`,
        description: "Start a conversation first so they have something to respond to.",
      });
      return;
    }

    toast({
      title: `${model.name} is thinking...`,
      description: "Generating a response",
    });

    try {
      const res = await fetch(`/api/models/${modelId}/force-speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Failed to trigger response", variant: "destructive" });
        return;
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "analyses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room.id, "calls"] });

      toast({
        title: `${model.name} spoke!`,
        description: "Response added to the conversation",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to trigger response",
        variant: "destructive",
      });
    }
  }, [models, entries, room, toast]);

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

  // Auto-play TTS when new philosopher responses appear (from USB buttons or external triggers)
  useEffect(() => {
    if (!voiceEnabled || calls.length === 0) return;

    const maxCallId = Math.max(...calls.map(c => c.id));

    if (lastSeenCallIdRef.current === 0) {
      lastSeenCallIdRef.current = maxCallId;
      return;
    }

    const newCalls = calls
      .filter(c => c.id > lastSeenCallIdRef.current)
      .sort((a, b) => a.id - b.id);

    if (newCalls.length === 0) return;

    lastSeenCallIdRef.current = maxCallId;

    if (ttsPlayingRef.current) return;

    const playQueue = async () => {
      ttsPlayingRef.current = true;
      for (const call of newCalls) {
        if (!call.responseContent) continue;
        const model = models.find(m => m.id === call.modelId);
        const voice = model?.voice || "alloy";
        const speakerName = model?.name || "Unknown";
        console.log("[TTS] Playing response from %s (voice: %s, call #%d)", speakerName, voice, call.id);
        setTtsSpeaker(speakerName);
        try {
          const audioResponse = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: call.responseContent, voice }),
          });
          if (audioResponse.ok) {
            const audioBlob = await audioResponse.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            console.log("[TTS] Audio loaded, starting playback for %s", speakerName);
            await new Promise<void>((resolve) => {
              audio.onended = () => { console.log("[TTS] Finished playing %s", speakerName); resolve(); };
              audio.onerror = (e) => { console.log("[TTS] Audio error for %s:", speakerName, e); resolve(); };
              audio.play().catch((e) => { console.log("[TTS] Play blocked for %s:", speakerName, e); resolve(); });
            });
            URL.revokeObjectURL(audioUrl);
          } else {
            console.log("[TTS] API returned %d for %s", audioResponse.status, speakerName);
          }
        } catch (e) {
          console.log("[TTS] Fetch error for %s:", speakerName, e);
        }
      }
      ttsPlayingRef.current = false;
      setTtsSpeaker(null);
    };

    playQueue();
  }, [calls, voiceEnabled, models]);

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
            <Button 
              variant={showPersonaPlex ? "destructive" : "default"}
              size="sm"
              className={showPersonaPlex ? "" : "bg-green-500 hover:bg-green-600 text-white gap-2"}
              onClick={() => {
                setShowPersonaPlex(!showPersonaPlex);
                if (!showPersonaPlex) {
                  toast({ title: "PersonaPlex Voice", description: "Voice AI ready - click Connect to speak!" });
                }
              }}
              data-testid="button-personaplex"
            >
              <Mic className="h-4 w-4" />
              {showPersonaPlex ? "Close Voice" : "PersonaPlex Voice"}
            </Button>
            <Link href="/analytics">
              <Button variant="ghost" size="icon" data-testid="button-analytics">
                <BarChart3 />
              </Button>
            </Link>
            <Link href="/api-docs">
              <Button variant="ghost" size="icon" data-testid="button-api-docs">
                <BookOpen />
              </Button>
            </Link>
            <Link href="/admin/queue">
              <Button variant="ghost" size="icon" data-testid="button-admin-queue">
                <Shield />
              </Button>
            </Link>
            {room && (
              <a href={`/api/rooms/${room.id}/export?format=txt`} download>
                <Button variant="ghost" size="icon" data-testid="button-export-transcript">
                  <Download />
                </Button>
              </a>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {showPersonaPlex && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
          <div className="relative w-full max-w-4xl h-[80vh] bg-white rounded-lg overflow-hidden shadow-2xl">
            <button 
              onClick={() => setShowPersonaPlex(false)}
              className="absolute top-2 right-2 z-10 bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
            >
              ✕ Close
            </button>
            <iframe 
              src="https://cjuzwdji4o9zi2-8998.proxy.runpod.net/?voice=NATURAL_M0.pt"
              className="w-full h-full border-0"
              allow="microphone; camera"
              title="PersonaPlex Voice AI"
            />
          </div>
        </div>
      )}

      {ttsSpeaker && (
        <div className="sticky top-[65px] z-50 bg-black text-white text-center py-2 text-sm font-medium animate-pulse" data-testid="text-tts-speaking">
          Now Speaking: {ttsSpeaker}
        </div>
      )}

      {/* Pulsing philosopher orbs left to right + latest message */}
      {models.length > 0 && (
        <div className="sticky top-[65px] z-40 bg-background border-b">
          <div className="max-w-7xl mx-auto px-4 lg:px-6">
            <div className="flex items-center gap-6 py-3 overflow-x-auto">
              {models.map((model) => {
                const conf = getEffectiveConfidence(model);
                const isActive = conf > 50;
                const pulseIntensity = conf / 100;
                const btnIdx = top3ModelIds.indexOf(model.id);
                const orbSize = 20 + Math.round(pulseIntensity * 40);
                const glowSize = 4 + (pulseIntensity * 18);
                const animDur = 2 - (pulseIntensity * 1.2);
                return (
                  <button
                    key={model.id}
                    data-testid={btnIdx >= 0 ? `orb-button-${btnIdx + 1}` : `orb-button-${model.id}`}
                    onClick={() => triggerPhilosopherById(model.id)}
                    className="flex flex-col items-center gap-1 flex-shrink-0"
                    style={{ opacity: isActive ? 1 : 0.3 }}
                  >
                    <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
                      {isActive && (
                        <div
                          className="absolute rounded-full"
                          style={{
                            width: orbSize + glowSize,
                            height: orbSize + glowSize,
                            backgroundColor: model.color,
                            opacity: 0.3,
                            animation: `pulse ${animDur}s ease-in-out infinite`,
                          }}
                        />
                      )}
                      <div
                        className="rounded-full relative z-10 flex items-center justify-center"
                        style={{
                          width: orbSize,
                          height: orbSize,
                          backgroundColor: isActive ? model.color : 'transparent',
                          border: isActive ? 'none' : `2px solid hsl(var(--border))`,
                          transition: 'all 0.3s ease',
                        }}
                      >
                        {btnIdx >= 0 && (
                          <span className="text-xs font-bold" style={{ color: isActive ? '#000' : 'hsl(var(--muted-foreground))' }}>
                            {btnIdx + 1}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                      {model.name}
                    </span>
                    {conf > 0 && (
                      <span className="text-[10px] font-mono text-muted-foreground">{conf}%</span>
                    )}
                  </button>
                );
              })}
            </div>
            {entries.length > 0 && (
              <div className="pb-3 -mt-1">
                <p className="text-sm text-muted-foreground truncate" data-testid="text-latest-message">
                  <span className="font-semibold">{entries[entries.length - 1].speaker}:</span>{" "}
                  {entries[entries.length - 1].content}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

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
                      entries={entries}
                      modelNames={philosopherNames}
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
