import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Download, X, FileText, Table, FileJson } from "lucide-react";

interface ExportDialogProps {
  roomId: number;
  open: boolean;
  onClose: () => void;
}

export default function ExportDialog({ roomId, open, onClose }: ExportDialogProps) {
  const [format, setFormat] = useState<"txt" | "csv" | "json">("txt");
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: speakers } = useQuery<string[]>({
    queryKey: ["/api/rooms", roomId, "speakers"],
    queryFn: async () => {
      const res = await fetch(`/api/rooms/${roomId}/speakers`);
      return res.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setSelectedSpeakers([]);
      setStartDate("");
      setEndDate("");
    }
  }, [open]);

  if (!open) return null;

  const toggleSpeaker = (speaker: string) => {
    setSelectedSpeakers(prev =>
      prev.includes(speaker) ? prev.filter(s => s !== speaker) : [...prev, speaker]
    );
  };

  const buildUrl = () => {
    const params = new URLSearchParams();
    params.set("format", format);
    if (selectedSpeakers.length > 0) {
      params.set("speakers", selectedSpeakers.join(","));
    }
    if (startDate) params.set("start", new Date(startDate).toISOString());
    if (endDate) params.set("end", new Date(endDate + "T23:59:59").toISOString());
    return `/api/rooms/${roomId}/export?${params.toString()}`;
  };

  const handleExport = () => {
    const url = buildUrl();
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatOptions = [
    { value: "txt" as const, label: "Text", icon: FileText },
    { value: "csv" as const, label: "CSV", icon: Table },
    { value: "json" as const, label: "JSON", icon: FileJson },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-5"
        onClick={e => e.stopPropagation()}
        data-testid="dialog-export"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" data-testid="text-export-title">Export Transcript</h2>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-export">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Format</label>
            <div className="flex gap-2">
              {formatOptions.map(opt => (
                <Button
                  key={opt.value}
                  variant={format === opt.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormat(opt.value)}
                  className="flex-1 gap-1.5"
                  data-testid={`button-format-${opt.value}`}
                >
                  <opt.icon className="w-3.5 h-3.5" />
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Time Period <span className="text-xs text-muted-foreground/60">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="flex-1 bg-muted border border-border rounded px-2 py-1.5 text-sm"
                placeholder="Start date"
                data-testid="input-start-date"
              />
              <span className="text-muted-foreground self-center text-sm">to</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="flex-1 bg-muted border border-border rounded px-2 py-1.5 text-sm"
                placeholder="End date"
                data-testid="input-end-date"
              />
            </div>
          </div>

          {speakers && speakers.length > 0 && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Speakers <span className="text-xs text-muted-foreground/60">({selectedSpeakers.length === 0 ? "all" : `${selectedSpeakers.length} selected`})</span>
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1" data-testid="speaker-filter-list">
                {speakers.map(speaker => (
                  <button
                    key={speaker}
                    onClick={() => toggleSpeaker(speaker)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      selectedSpeakers.includes(speaker)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:border-primary/50"
                    }`}
                    data-testid={`button-speaker-${speaker}`}
                  >
                    {speaker}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleExport} className="w-full gap-2" data-testid="button-export-download">
            <Download className="w-4 h-4" />
            Export {format.toUpperCase()}
          </Button>
        </div>
      </div>
    </div>
  );
}
