import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Image as ImageIcon, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

interface ArtItem {
  id: number;
  roomId: number;
  title: string;
  quote: string;
  imagePrompt: string;
  createdAt: string;
}

export default function Gallery() {
  const { data: artList, isLoading } = useQuery<ArtItem[]>({
    queryKey: ["/api/art"],
  });

  const [selectedArt, setSelectedArt] = useState<ArtItem | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/analytics">
            <Button variant="ghost" size="sm" data-testid="button-back-analytics">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Analytics
            </Button>
          </Link>
          <h1 className="text-2xl font-bold" data-testid="text-gallery-title">Art Gallery</h1>
          <span className="text-sm text-muted-foreground">
            {artList?.length || 0} archived pieces
          </span>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (!artList || artList.length === 0) && (
          <Card>
            <CardContent className="py-12 text-center">
              <ImageIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-gallery-empty">No art generated yet. Go to Analytics to create your first piece.</p>
            </CardContent>
          </Card>
        )}

        {selectedArt && (
          <Card>
            <CardContent className="p-0">
              <div className="relative rounded-md overflow-hidden bg-black">
                <img
                  src={`/api/art/${selectedArt.id}/image`}
                  alt={selectedArt.title}
                  className="w-full max-w-4xl mx-auto block"
                  data-testid={`img-art-full-${selectedArt.id}`}
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                  <p className="text-white text-lg font-light italic text-center">
                    "{selectedArt.quote}"
                  </p>
                  <p className="text-white/60 text-sm text-center mt-2">{selectedArt.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-4 flex-wrap">
                <a href={`/api/art/${selectedArt.id}/image`} download={`${selectedArt.title}.png`}>
                  <Button variant="outline" size="sm" data-testid="button-download-full">
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                </a>
                <Button variant="ghost" size="sm" onClick={() => setSelectedArt(null)} data-testid="button-close-full">
                  Close
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(selectedArt.createdAt).toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {artList?.map((art) => (
            <Card
              key={art.id}
              className="cursor-pointer hover-elevate overflow-visible"
              onClick={() => setSelectedArt(art)}
              data-testid={`card-art-${art.id}`}
            >
              <CardContent className="p-0">
                <div className="relative rounded-md overflow-hidden bg-black aspect-square">
                  <img
                    src={`/api/art/${art.id}/image`}
                    alt={art.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    data-testid={`img-art-thumb-${art.id}`}
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                    <p className="text-white text-sm font-medium truncate">{art.title}</p>
                    <p className="text-white/70 text-xs italic truncate">"{art.quote}"</p>
                  </div>
                </div>
                <div className="p-3 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(art.createdAt).toLocaleDateString()}
                  </span>
                  <a
                    href={`/api/art/${art.id}/image`}
                    download={`${art.title}.png`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button variant="ghost" size="icon" data-testid={`button-download-${art.id}`}>
                      <Download className="w-3 h-3" />
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
