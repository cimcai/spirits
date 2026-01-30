import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ConversationStream } from "@/components/ConversationStream";
import { AiModelPanel } from "@/components/AiModelPanel";
import { CallLog } from "@/components/CallLog";
import { SimulationControls } from "@/components/SimulationControls";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bot, Radio, Sparkles } from "lucide-react";
import type { Room, ConversationEntry, AiModel, ModelAnalysis, OutboundCall } from "@shared/schema";

const SAMPLE_CONVERSATIONS = [
  { speaker: "Alice", content: "I've been thinking about switching our cloud provider. The current costs are getting out of hand." },
  { speaker: "Bob", content: "What alternatives have you looked at? AWS has some good enterprise pricing." },
  { speaker: "Alice", content: "We've compared AWS, Google Cloud, and Azure. The migration costs are a concern though." },
  { speaker: "Carol", content: "Don't forget about the learning curve for the team. That's hidden cost too." },
  { speaker: "Bob", content: "True. Has anyone done a total cost of ownership analysis?" },
  { speaker: "Alice", content: "Not yet. We should probably bring in a consultant for that." },
  { speaker: "David", content: "I know a great firm that specializes in cloud migration assessments." },
  { speaker: "Carol", content: "That would be helpful. What's their typical engagement look like?" },
  { speaker: "David", content: "Usually 2-3 weeks for initial assessment, then they provide a detailed roadmap." },
  { speaker: "Alice", content: "Perfect. Can you send me their contact details? We should set up a call." },
  { speaker: "Bob", content: "Before we reach out, we should align on our budget constraints." },
  { speaker: "Carol", content: "Good point. What's our current annual cloud spend?" },
  { speaker: "Alice", content: "Around $2.4 million. We're hoping to reduce that by at least 20%." },
  { speaker: "David", content: "That's achievable with the right optimization strategy." },
  { speaker: "Bob", content: "Should we schedule a follow-up meeting to discuss this further?" },
];

export default function Dashboard() {
  const { toast } = useToast();
  const [isSimulationRunning, setIsSimulationRunning] = useState(false);
  const messageIndexRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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

  // Add conversation entry mutation
  const addEntryMutation = useMutation({
    mutationFn: async (data: { speaker: string; content: string }) => {
      return apiRequest("POST", `/api/rooms/${room?.id}/entries`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "analyses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rooms", room?.id, "calls"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add message",
        variant: "destructive",
      });
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
      messageIndexRef.current = 0;
      toast({
        title: "Room Reset",
        description: "Conversation has been cleared",
      });
    },
  });

  // Add a sample message
  const addSampleMessage = useCallback(() => {
    if (!room?.id) return;
    const currentIndex = messageIndexRef.current;
    const message = SAMPLE_CONVERSATIONS[currentIndex % SAMPLE_CONVERSATIONS.length];
    addEntryMutation.mutate(message);
    messageIndexRef.current = currentIndex + 1;
  }, [room?.id, addEntryMutation]);

  // Start simulation
  const startSimulation = useCallback(() => {
    setIsSimulationRunning(true);
    intervalRef.current = setInterval(() => {
      addSampleMessage();
    }, 4000);
  }, [addSampleMessage]);

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
              <h1 className="text-xl font-bold">AI Model Aggregator</h1>
              <p className="text-sm text-muted-foreground">
                Intelligent outbound call triggers
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
            <p className="text-sm font-medium">How it works</p>
            <p className="text-sm text-muted-foreground">
              AI models analyze the conversation stream in real-time. When a model determines it's the right moment to contribute, 
              it triggers an outbound call with its response. Start the simulation to see it in action.
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
                    isProcessing={addEntryMutation.isPending}
                    roomId={room?.id}
                    latestEntryId={entries.length > 0 ? entries[entries.length - 1].id : 0}
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
              onTriggerSample={addSampleMessage}
              entryCount={entries.length}
              callCount={calls.length}
            />
            <CallLog calls={calls} models={models} />
          </div>
        </div>
      </main>
    </div>
  );
}
