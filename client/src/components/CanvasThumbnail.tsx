import { useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

interface CanvasData {
  size: number;
  grid: string[][];
  totalPlacements: number;
  uniqueAgents: number;
}

export default function CanvasThumbnail({ pixelSize = 2 }: { pixelSize?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data } = useQuery<CanvasData>({
    queryKey: ["/api/canvas"],
    refetchInterval: 5000,
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const s = data.size;
    canvas.width = s * pixelSize;
    canvas.height = s * pixelSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        ctx.fillStyle = data.grid[y][x];
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
      }
    }
  }, [data, pixelSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  if (!data) return null;

  return (
    <Link href="/canvas">
      <canvas
        ref={canvasRef}
        className="border border-white/20 rounded cursor-pointer hover:border-white/50 transition-colors"
        style={{ width: data.size * pixelSize, height: data.size * pixelSize }}
        title={`Pixel Canvas · ${data.totalPlacements} placements · Click to open`}
        data-testid="canvas-thumbnail"
      />
    </Link>
  );
}
