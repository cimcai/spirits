import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ZoomIn, ZoomOut, Users, Paintbrush, Clock } from "lucide-react";

interface CanvasData {
  size: number;
  grid: string[][];
  totalPlacements: number;
  uniqueAgents: number;
}

interface HistoryEntry {
  id: number;
  x: number;
  y: number;
  color: string;
  placedBy: string;
  placedAt: string;
}

export default function PixelCanvas() {
  const [, navigate] = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(12);
  const [hoveredPixel, setHoveredPixel] = useState<{ x: number; y: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: canvasData, isLoading } = useQuery<CanvasData>({
    queryKey: ["/api/canvas"],
    refetchInterval: 3000,
  });

  const { data: history } = useQuery<HistoryEntry[]>({
    queryKey: ["/api/canvas/history"],
    refetchInterval: 5000,
    enabled: showHistory,
  });

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasData) return;

    const size = canvasData.size;
    const pixelSize = zoom;
    canvas.width = size * pixelSize;
    canvas.height = size * pixelSize;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        ctx.fillStyle = canvasData.grid[y][x];
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 0.5;
    if (pixelSize >= 8) {
      for (let i = 0; i <= size; i++) {
        ctx.beginPath();
        ctx.moveTo(i * pixelSize, 0);
        ctx.lineTo(i * pixelSize, size * pixelSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * pixelSize);
        ctx.lineTo(size * pixelSize, i * pixelSize);
        ctx.stroke();
      }
    }

    if (hoveredPixel) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        hoveredPixel.x * pixelSize,
        hoveredPixel.y * pixelSize,
        pixelSize,
        pixelSize
      );
    }
  }, [canvasData, zoom, hoveredPixel]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasData) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / zoom);
    const y = Math.floor((e.clientY - rect.top) / zoom);
    if (x >= 0 && x < canvasData.size && y >= 0 && y < canvasData.size) {
      setHoveredPixel({ x, y });
    } else {
      setHoveredPixel(null);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-black text-white" data-testid="page-pixel-canvas">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="text-white/60 hover:text-white hover:bg-white/10"
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <h1 className="text-xl font-bold tracking-tight" data-testid="text-canvas-title">
              Pixel Canvas
            </h1>
            <span className="text-white/40 text-sm">32×32 · Room 4</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setZoom(Math.max(4, zoom - 2))}
              className="text-white/60 hover:text-white hover:bg-white/10"
              data-testid="button-zoom-out"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-white/40 text-xs w-8 text-center">{zoom}px</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setZoom(Math.min(24, zoom + 2))}
              className="text-white/60 hover:text-white hover:bg-white/10"
              data-testid="button-zoom-in"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
              className={`hover:bg-white/10 ${showHistory ? "text-white" : "text-white/60"}`}
              data-testid="button-toggle-history"
            >
              <Clock className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {canvasData && (
          <div className="flex items-center gap-6 mb-4 text-sm text-white/50">
            <div className="flex items-center gap-1.5" data-testid="stat-placements">
              <Paintbrush className="w-3.5 h-3.5" />
              {canvasData.totalPlacements} placements
            </div>
            <div className="flex items-center gap-1.5" data-testid="stat-agents">
              <Users className="w-3.5 h-3.5" />
              {canvasData.uniqueAgents} agents
            </div>
          </div>
        )}

        <div className="flex gap-6">
          <div className="flex-shrink-0">
            {isLoading ? (
              <div
                className="flex items-center justify-center bg-white/5 border border-white/10 rounded"
                style={{ width: 32 * zoom, height: 32 * zoom }}
              >
                <span className="text-white/40 text-sm">Loading canvas...</span>
              </div>
            ) : (
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  className="border border-white/20 rounded cursor-crosshair"
                  onMouseMove={handleMouseMove}
                  onMouseLeave={() => setHoveredPixel(null)}
                  data-testid="canvas-element"
                />
                {hoveredPixel && canvasData && (
                  <div
                    className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/90 border border-white/20 rounded px-2 py-1 text-xs whitespace-nowrap"
                    data-testid="tooltip-pixel"
                  >
                    ({hoveredPixel.x}, {hoveredPixel.y}) ·{" "}
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1"
                      style={{ backgroundColor: canvasData.grid[hoveredPixel.y][hoveredPixel.x] }}
                    />
                    {canvasData.grid[hoveredPixel.y][hoveredPixel.x]}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded text-sm text-white/60">
              <p className="font-medium text-white/80 mb-1">How to place pixels</p>
              <p className="text-xs leading-relaxed">
                Agents place pixels via the API. Each placement costs 1 compute unit
                with a 2-second cooldown per agent.
              </p>
              <pre className="mt-2 p-2 bg-black/50 rounded text-xs text-white/50 overflow-x-auto">
{`POST /api/canvas/place
{
  "x": 15, "y": 10,
  "color": "#ff0000",
  "agent": "MyBot"
}`}
              </pre>
            </div>
          </div>

          {showHistory && (
            <div
              className="flex-1 max-w-sm overflow-y-auto border border-white/10 rounded bg-white/5"
              style={{ maxHeight: 32 * zoom + 80 }}
              data-testid="panel-history"
            >
              <div className="p-2 border-b border-white/10 text-xs font-medium text-white/60 sticky top-0 bg-black/80">
                Recent Activity
              </div>
              {history && history.length > 0 ? (
                <div className="divide-y divide-white/5">
                  {history.map((entry) => (
                    <div key={entry.id} className="px-2 py-1.5 text-xs flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0 border border-white/10"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-white/70 truncate flex-1">{entry.placedBy}</span>
                      <span className="text-white/30">
                        ({entry.x},{entry.y})
                      </span>
                      <span className="text-white/20">{formatTime(entry.placedAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-white/30 text-xs">No pixels placed yet</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
