import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { AiModel } from "@shared/schema";

type AiModelWithAP = AiModel & { preferredUsername?: string };

export default function SpiritProfile() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: models = [], isLoading } = useQuery<AiModelWithAP[]>({
    queryKey: ["/api/models"],
  });

  const model = models.find((m) => String(m.id) === id);

  const actorUrl = `${window.location.origin}/spirits/${id}`;
  const federationHandle = model?.preferredUsername
    ? `@${model.preferredUsername}@${window.location.host}`
    : null;

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast({ title: `Copied ${label}` });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Spirit not found.</p>
        <Link href="/">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>
    );
  }

  const curlCommand = `curl -H 'Accept: application/ld+json' ${actorUrl}`;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
        {/* Back navigation */}
        <Link href="/">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="w-4 h-4 mr-2" />
            All Philosophers
          </Button>
        </Link>

        {/* Spirit header */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{ backgroundColor: model.color ?? undefined }}
              />
              <div>
                <CardTitle className="text-2xl">{model.name}</CardTitle>
                {federationHandle && (
                  <button
                    className="text-sm text-muted-foreground font-mono hover:text-foreground flex items-center gap-1 mt-1"
                    onClick={() => copyToClipboard(federationHandle, "federation handle")}
                    title="Copy federation handle"
                  >
                    <Copy className="w-3 h-3 shrink-0" />
                    {federationHandle}
                  </button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{model.description}</p>
            <div className="flex gap-2 flex-wrap">
              {model.llmModel && (
                <Badge variant="secondary" className="text-xs font-mono">
                  {model.llmModel}
                </Badge>
              )}
              {model.voice && (
                <Badge variant="outline" className="text-xs">
                  voice: {model.voice}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ActivityPub identity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ActivityPub Identity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Actor URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted rounded px-2 py-1 break-all">
                  {actorUrl}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => copyToClipboard(actorUrl, "actor URL")}
                  title="Copy URL"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                <a href={actorUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Open raw JSON">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </a>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Retrieve as JSON-LD (ActivityPub)
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted rounded px-2 py-1 break-all select-all">
                  {curlCommand}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => copyToClipboard(curlCommand, "curl command")}
                  title="Copy curl command"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                The response includes an <code>outbox</code> URL listing this spirit's published messages.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
