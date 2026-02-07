import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Settings, Save, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AiModel } from "@shared/schema";

const AVAILABLE_VOICES = [
  { value: "onyx", label: "Onyx (Deep)" },
  { value: "nova", label: "Nova (Warm)" },
  { value: "echo", label: "Echo (Soft)" },
  { value: "alloy", label: "Alloy (Neutral)" },
  { value: "fable", label: "Fable (British)" },
  { value: "shimmer", label: "Shimmer (Gentle)" },
];

const AVAILABLE_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini (Fast)" },
  { value: "gpt-4o", label: "GPT-4o (Balanced)" },
  { value: "gpt-5-nano", label: "GPT-5 Nano (Fastest)" },
  { value: "gpt-5-mini", label: "GPT-5 Mini (Efficient)" },
  { value: "gpt-5", label: "GPT-5 (Capable)" },
  { value: "gpt-5.2", label: "GPT-5.2 (Most Capable)" },
];

interface ModelConfigPanelProps {
  models: AiModel[];
}

function ModelEditor({ model }: { model: AiModel }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(model.name);
  const [description, setDescription] = useState(model.description || "");
  const [persona, setPersona] = useState(model.persona);
  const [color, setColor] = useState(model.color);
  const [voice, setVoice] = useState(model.voice || "alloy");
  const [llmModel, setLlmModel] = useState(model.llmModel || "gpt-4o-mini");

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      return apiRequest("PATCH", `/api/models/${model.id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      toast({ title: "Saved", description: `${name} updated successfully` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({ name, description, persona, color, voice, llmModel });
  };

  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover-elevate"
        data-testid={`button-config-toggle-${model.id}`}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: model.color }} />
          <span className="text-sm font-medium">{model.name}</span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="p-3 pt-0 space-y-3 border-t border-border/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-sm"
                data-testid={`input-name-${model.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 p-1 cursor-pointer"
                  data-testid={`input-color-${model.id}`}
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="text-sm flex-1"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm"
              data-testid={`input-description-${model.id}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Voice</Label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger className="text-sm" data-testid={`select-voice-${model.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_VOICES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">AI Model</Label>
              <Select value={llmModel} onValueChange={setLlmModel}>
                <SelectTrigger className="text-sm" data-testid={`select-model-${model.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Persona / Instructions</Label>
            <Textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              className="text-sm min-h-[80px]"
              data-testid={`textarea-persona-${model.id}`}
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            size="sm"
            className="w-full"
            data-testid={`button-save-${model.id}`}
          >
            <Save className="h-3 w-3 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ModelConfigPanel({ models }: ModelConfigPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full"
          data-testid="button-config-panel-toggle"
        >
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuration
          </CardTitle>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-2 pt-0">
          {models.map((model) => (
            <ModelEditor key={model.id} model={model} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}
