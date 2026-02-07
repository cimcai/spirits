import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Radio, UserRound, Plus, X } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CHUNK_INTERVAL_MS = 6000;
const STORAGE_KEY = "philosophical-insight-speakers";
const ACTIVE_SPEAKER_KEY = "philosophical-insight-active-speaker";

interface LiveAudioCaptureProps {
  roomId?: number;
}

function loadSpeakers(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return ["Joscha Bach", "Questioner"];
}

function loadActiveSpeaker(speakers: string[]): string {
  try {
    const stored = localStorage.getItem(ACTIVE_SPEAKER_KEY);
    if (stored && speakers.includes(stored)) return stored;
  } catch {}
  return speakers[0] || "Live Speaker";
}

export function LiveAudioCapture({ roomId }: LiveAudioCaptureProps) {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [transcriptCount, setTranscriptCount] = useState(0);
  const [speakers, setSpeakers] = useState<string[]>(loadSpeakers);
  const [activeSpeaker, setActiveSpeaker] = useState<string>(() => loadActiveSpeaker(loadSpeakers()));
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [showAddSpeaker, setShowAddSpeaker] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingRef = useRef(false);
  const activeSpeakerRef = useRef(activeSpeaker);

  useEffect(() => {
    activeSpeakerRef.current = activeSpeaker;
    localStorage.setItem(ACTIVE_SPEAKER_KEY, activeSpeaker);
  }, [activeSpeaker]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(speakers));
  }, [speakers]);

  const sendAudioForTranscription = useCallback(async (audioBlob: Blob) => {
    console.log(`[audio] Sending blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
    if (!roomId || audioBlob.size < 1000) {
      console.log(`[audio] Skipped: roomId=${roomId}, size=${audioBlob.size}`);
      return;
    }

    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      formData.append("roomId", roomId.toString());
      formData.append("speaker", activeSpeakerRef.current);

      const response = await fetch("/api/audio/transcribe", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.text) {
          setLastTranscript(data.text);
          setTranscriptCount((c) => c + 1);
          queryClient.invalidateQueries({ queryKey: ["/api/rooms", roomId, "entries"] });
          queryClient.invalidateQueries({ queryKey: ["/api/rooms", roomId, "analyses"] });
        }
      }
    } catch (error) {
      console.error("Transcription error:", error);
    } finally {
      setIsTranscribing(false);
    }
  }, [roomId]);

  const harvestChunk = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      console.log(`[audio] harvestChunk skipped: recorder=${!!recorder}, state=${recorder?.state}`);
      return;
    }

    const chunks = chunksRef.current;
    console.log(`[audio] Harvesting: ${chunks.length} chunks, sizes: ${chunks.map(c => c.size).join(',')}`);

    if (chunks.length === 0) {
      console.log(`[audio] No chunks to harvest, skipping`);
      return;
    }

    const audioBlob = new Blob(chunks, { type: "audio/webm" });
    chunksRef.current = [];
    console.log(`[audio] Created blob: ${audioBlob.size} bytes`);

    recorder.stop();

    if (isRecordingRef.current && streamRef.current) {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const newRecorder = new MediaRecorder(streamRef.current, { mimeType });
      newRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      newRecorder.start(1000);
      mediaRecorderRef.current = newRecorder;
    }

    sendAudioForTranscription(audioBlob);
  }, [sendAudioForTranscription]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      isRecordingRef.current = true;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      setIsRecording(true);
      setTranscriptCount(0);

      intervalRef.current = setInterval(() => {
        harvestChunk();
      }, CHUNK_INTERVAL_MS);

      toast({
        title: "Live Mic Active",
        description: `Recording as "${activeSpeaker}". Auto-transcribing every ${CHUNK_INTERVAL_MS / 1000}s.`,
      });
    } catch (error) {
      console.error("Microphone error:", error);
      toast({
        title: "Microphone Access",
        description: "Please allow microphone access to use live audio.",
        variant: "destructive",
      });
    }
  }, [harvestChunk, toast, activeSpeaker]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    const chunks = chunksRef.current;
    if (chunks.length > 0) {
      const audioBlob = new Blob(chunks, { type: "audio/webm" });
      chunksRef.current = [];
      if (audioBlob.size >= 1000) {
        sendAudioForTranscription(audioBlob);
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    streamRef.current = null;
    setIsRecording(false);
  }, [sendAudioForTranscription]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const addSpeaker = () => {
    const name = newSpeakerName.trim();
    if (name && !speakers.includes(name)) {
      const updated = [...speakers, name];
      setSpeakers(updated);
      setNewSpeakerName("");
      setShowAddSpeaker(false);
    }
  };

  const removeSpeaker = (name: string) => {
    if (speakers.length <= 1) return;
    const updated = speakers.filter((s) => s !== name);
    setSpeakers(updated);
    if (activeSpeaker === name) {
      setActiveSpeaker(updated[0]);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Live Audio Input
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <UserRound className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground shrink-0">Speaker:</span>
            {speakers.map((name) => (
              <div key={name} className="flex items-center gap-0.5">
                <Button
                  variant={activeSpeaker === name ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveSpeaker(name)}
                  className="text-xs toggle-elevate"
                  data-testid={`button-speaker-${name.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {name}
                  {speakers.length > 1 && (
                    <X
                      className="h-3 w-3 ml-1 text-muted-foreground"
                      onClick={(e) => { e.stopPropagation(); removeSpeaker(name); }}
                    />
                  )}
                </Button>
              </div>
            ))}
            {showAddSpeaker ? (
              <div className="flex items-center gap-1">
                <Input
                  value={newSpeakerName}
                  onChange={(e) => setNewSpeakerName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addSpeaker(); if (e.key === "Escape") setShowAddSpeaker(false); }}
                  placeholder="Name..."
                  className="w-28 text-xs"
                  autoFocus
                  data-testid="input-new-speaker-name"
                />
                <Button size="sm" onClick={addSpeaker} disabled={!newSpeakerName.trim()} data-testid="button-add-speaker-confirm">
                  Add
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAddSpeaker(true)}
                data-testid="button-add-speaker"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {isRecording ? (
          <Button
            onClick={stopRecording}
            variant="destructive"
            className="w-full"
            data-testid="button-stop-recording"
          >
            <MicOff className="h-4 w-4 mr-2" />
            Stop Recording
          </Button>
        ) : (
          <Button
            onClick={startRecording}
            variant="outline"
            className="w-full"
            disabled={!roomId || isTranscribing}
            data-testid="button-start-recording"
          >
            {isTranscribing ? (
              <>
                <Radio className="h-4 w-4 mr-2 animate-pulse" />
                Transcribing...
              </>
            ) : (
              <>
                <Mic className="h-4 w-4 mr-2" />
                Start Recording
              </>
            )}
          </Button>
        )}

        {isRecording && (
          <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              <span className="text-xs text-destructive font-medium">
                Recording as {activeSpeaker}
              </span>
            </div>
            {isTranscribing && (
              <Badge variant="secondary" className="text-xs">Transcribing</Badge>
            )}
            {transcriptCount > 0 && (
              <span className="text-xs text-muted-foreground">{transcriptCount} segments</span>
            )}
          </div>
        )}

        {lastTranscript && (
          <div className="p-2 rounded-md bg-secondary/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-xs">Last Transcript</Badge>
            </div>
            <p className="text-xs text-muted-foreground italic" data-testid="text-last-transcript">
              "{lastTranscript}"
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
