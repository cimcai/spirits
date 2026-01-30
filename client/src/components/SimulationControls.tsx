import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, Pause, RotateCcw, Zap } from "lucide-react";

interface SimulationControlsProps {
  isRunning: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onTriggerSample: () => void;
  entryCount: number;
  callCount: number;
  isGenerating?: boolean;
}

export function SimulationControls({
  isRunning,
  onStart,
  onPause,
  onReset,
  onTriggerSample,
  entryCount,
  callCount,
  isGenerating = false,
}: SimulationControlsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Simulation Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-md bg-secondary/50 text-center">
            <p className="text-2xl font-bold text-primary">{entryCount}</p>
            <p className="text-xs text-muted-foreground">Messages</p>
          </div>
          <div className="p-3 rounded-md bg-secondary/50 text-center">
            <p className="text-2xl font-bold text-amber-400">{callCount}</p>
            <p className="text-xs text-muted-foreground">Calls Triggered</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {isRunning ? (
            <Button onClick={onPause} variant="secondary" className="w-full" data-testid="button-pause">
              <Pause className="h-4 w-4 mr-2" />
              Pause Simulation
            </Button>
          ) : (
            <Button onClick={onStart} className="w-full" data-testid="button-start">
              <Play className="h-4 w-4 mr-2" />
              Start Simulation
            </Button>
          )}
          
          <Button
            onClick={onTriggerSample}
            variant="outline"
            className="w-full"
            disabled={isGenerating}
            data-testid="button-add-message"
          >
            <Zap className="h-4 w-4 mr-2" />
            {isGenerating ? "Generating..." : "Generate Dialogue"}
          </Button>

          <Button
            onClick={onReset}
            variant="ghost"
            className="w-full text-muted-foreground"
            data-testid="button-reset"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset Room
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
