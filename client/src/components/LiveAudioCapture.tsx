import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Radio } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CHUNK_INTERVAL_MS = 6000;

interface LiveAudioCaptureProps {
  roomId?: number;
}

export function LiveAudioCapture({ roomId }: LiveAudioCaptureProps) {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [transcriptCount, setTranscriptCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingRef = useRef(false);

  const sendAudioForTranscription = useCallback(async (audioBlob: Blob) => {
    if (!roomId || audioBlob.size < 1000) return;

    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      formData.append("roomId", roomId.toString());

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
    if (!recorder || recorder.state !== "recording") return;

    recorder.stop();

    const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    sendAudioForTranscription(audioBlob);

    if (isRecordingRef.current && streamRef.current) {
      const newRecorder = new MediaRecorder(streamRef.current, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      newRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      newRecorder.start();
      mediaRecorderRef.current = newRecorder;
    }
  }, [sendAudioForTranscription]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      isRecordingRef.current = true;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setTranscriptCount(0);

      intervalRef.current = setInterval(() => {
        harvestChunk();
      }, CHUNK_INTERVAL_MS);

      toast({
        title: "Live Mic Active",
        description: "Listening and auto-transcribing every few seconds.",
      });
    } catch (error) {
      console.error("Microphone error:", error);
      toast({
        title: "Microphone Access",
        description: "Please allow microphone access to use live audio.",
        variant: "destructive",
      });
    }
  }, [harvestChunk, toast]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      if (audioBlob.size >= 1000) {
        sendAudioForTranscription(audioBlob);
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Live Audio Input
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Record your voice. Audio is automatically transcribed every {CHUNK_INTERVAL_MS / 1000}s and fed to the philosophers.
        </p>

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
              <span className="text-xs text-destructive font-medium">Listening...</span>
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
