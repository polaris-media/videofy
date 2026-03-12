"use client";

import {
  AudioOutlined,
  DeleteOutlined,
  CaretRightOutlined,
  StopFilled,
  PauseOutlined,
} from "@ant-design/icons";
import { Button, Space, Tooltip, Typography } from "antd";
import React, { useRef, useEffect } from "react";
import { useReactive } from "ahooks";
import { useGlobalState } from "@/state/globalState";

const { Text } = Typography;

export interface AudioRecorderProps {
  value?: { src?: string; length?: number };
  onChange?: (audio: { src?: string; length?: number }) => void;
  onDelete?: () => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  value,
  onChange = () => {},
  onDelete = () => {},
}) => {
  const state = useReactive({
    isRecording: false,
    duration: 0,
    audioDuration: 0,
    isPlaying: false,
    isSaving: false,
  });
  const { generationId } = useGlobalState();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const uploadAudio = async (audioBlob: Blob) => {
    state.isSaving = true;
    const formData = new FormData();
    formData.append("file", audioBlob);

    try {
      if (!generationId) {
        throw new Error("No active project selected.");
      }

      const response = await fetch(
        `/api/uploadAudio?projectId=${encodeURIComponent(generationId)}`,
        {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload audio");
      }

      const { url } = await response.json();
      onChange({ src: url, length: state.duration });
    } catch (error) {
      console.error("Failed to upload audio:", error);
    } finally {
      state.isSaving = false;
    }
  };

  const startRecording = async (event?: React.MouseEvent<HTMLElement>) => {
    if (event?.shiftKey) {
      onChange({ src: "/assets/voice-sample.wav", length: 6 });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        await uploadAudio(blob);
        stream.getTracks().forEach((track) => track.stop()); // Stop microphone access
      };

      mediaRecorderRef.current.start();
      state.isRecording = true;
      state.duration = 0;
      timerRef.current = setInterval(() => {
        state.duration = state.duration + 1;
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
      state.isRecording = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const handleRecordClick = (event: React.MouseEvent<HTMLElement>) => {
    if (state.isRecording) {
      stopRecording();
    } else {
      handleDelete(); // Clear previous recording before starting a new one
      startRecording(event);
    }
  };

  const handlePlay = () => {
    if (value?.src) {
      if (state.isPlaying && audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        state.isPlaying = false;
      } else {
        const audio = new Audio(value.src);
        audioRef.current = audio;
        audio.play();
        state.isPlaying = true;
        audio.onended = () => {
          state.isPlaying = false;
          audioRef.current = null;
        };
      }
    }
  };

  const handleDelete = () => {
    if (state.isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      state.isPlaying = false;
    }
    state.duration = 0;
    if (state.isRecording) {
      stopRecording();
    }
    onChange({});
    onDelete();
  };

  useEffect(() => {
    if (value?.src) {
      if (typeof value.length === "number") {
        state.audioDuration = value.length;
      } else {
        const audio = new Audio(value.src);
        audio.onloadedmetadata = () => {
          state.audioDuration = audio.duration;
        };
      }
    } else {
      state.audioDuration = 0;
    }
  }, [value]);

  useEffect(() => {
    // Cleanup timer and audio on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex items-center p-2 border border-gray-700 rounded w-full">
      <Space>
        <Tooltip title={state.isRecording ? "Stop" : "Record custom audio"}>
          <Button
            icon={
              state.isRecording ? (
                <StopFilled className="text-red-500" />
              ) : (
                <AudioOutlined />
              )
            }
            onClick={handleRecordClick}
            danger={state.isRecording}
          />
        </Tooltip>

        {value?.src && !state.isRecording && (
          <Tooltip title="Play">
            <Button
              icon={
                state.isPlaying ? <PauseOutlined /> : <CaretRightOutlined />
              }
              onClick={handlePlay}
            />
          </Tooltip>
        )}
      </Space>
      <div className="flex-1 text-center">
        {state.isSaving && <Text>Saving...</Text>}
        {!state.isSaving &&
          value?.src &&
          !state.isRecording &&
          state.audioDuration > 0 && (
            <Text>{state.audioDuration.toFixed(1)}s</Text>
          )}
        {!state.isSaving &&
          value?.src &&
          !state.isRecording &&
          !state.audioDuration && <Text>Loading audio...</Text>}
        {state.isRecording && (
          <Text className="text-red-500">
            Recording... ({state.duration.toFixed(0)}s)
          </Text>
        )}
      </div>
      {value?.src && !state.isRecording && (
        <Tooltip title="Delete recording">
          <Button icon={<DeleteOutlined />} onClick={handleDelete} danger />
        </Tooltip>
      )}
    </div>
  );
};

export default AudioRecorder;
