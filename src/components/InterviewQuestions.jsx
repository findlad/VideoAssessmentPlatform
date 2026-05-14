"use client";

import { useEffect, useRef, useState } from "react";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  readDocument,
  updateDocument,
  writeDocument,
} from "@/lib/firebase/firestore";
import { uploadInterviewAnswer } from "@/lib/firebase/storage";

const RECORD_SECONDS = 60;

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function InterviewQuestions({ fileName, onCompletedChange }) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(Boolean(fileName));
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [recordSecondsLeft, setRecordSecondsLeft] = useState(RECORD_SECONDS);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedAnswers, setSavedAnswers] = useState([]);
  const [completed, setCompleted] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const stopTimeoutRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function loadQuestions() {
      if (!fileName) {
        setLoading(false);
        setError("This interview link is missing a file code.");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const nextRequest = await readDocument("questions", fileName);

        if (!active) {
          return;
        }

        if (!nextRequest) {
          setError(
            "We could not find an interview request for this file code.",
          );
          setRequest(null);
          return;
        }

        setRequest(nextRequest);
        setCurrentIndex(0);
        setRecordSecondsLeft(RECORD_SECONDS);
        setSavedAnswers([]);
        setCompleted(false);
        onCompletedChange?.(false);
      } catch (nextError) {
        if (!active) {
          return;
        }

        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load this interview request.",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadQuestions();

    return () => {
      active = false;
    };
  }, [fileName, onCompletedChange]);

  useEffect(() => {
    if (!recording || recordSecondsLeft <= 0) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setRecordSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [recordSecondsLeft, recording]);

  useEffect(() => {
    return () => {
      window.clearTimeout(stopTimeoutRef.current);
      stopCamera();
    };
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startRecording() {
    if (!request) {
      return;
    }

    setError("");
    setRecordSecondsLeft(RECORD_SECONDS);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });

        setRecording(false);
        setUploading(true);
        stopCamera();

        try {
          const path = await uploadInterviewAnswer(
            fileName,
            currentIndex,
            blob,
          );
          const nextResponseCount = currentIndex + 1;
          const nextStatus =
            nextResponseCount >= request.questions.length
              ? "responded"
              : "in-progress";

          await writeDocument(
            `questions/${fileName}/answers`,
            `answer-${nextResponseCount}`,
            {
              questionIndex: currentIndex,
              question: request.questions[currentIndex],
              storagePath: path,
              contentType: blob.type || "video/webm",
            },
          );
          await updateDocument("questions", fileName, {
            responseCount: nextResponseCount,
            status: nextStatus,
          });

          setSavedAnswers((current) => [...current, path]);

          if (currentIndex + 1 >= request.questions.length) {
            setCompleted(true);
            onCompletedChange?.(true);
          } else {
            setCurrentIndex((index) => index + 1);
            setRecordSecondsLeft(RECORD_SECONDS);
          }
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to upload this answer.",
          );
        } finally {
          setUploading(false);
        }
      };

      recorder.start();
      setRecording(true);
      stopTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, RECORD_SECONDS * 1000);
    } catch (nextError) {
      stopCamera();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to access the camera and microphone.",
      );
    }
  }

  function stopRecording() {
    window.clearTimeout(stopTimeoutRef.current);

    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <CircularProgress size={22} />
        <Typography sx={{ color: "#657085" }}>
          Loading interview questions...
        </Typography>
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (completed) {
    return (
      <Alert icon={<CheckCircleOutlineIcon />} severity="success">
        Interview complete. Your {savedAnswers.length} answer
        {savedAnswers.length === 1 ? "" : "s"} uploaded successfully.
      </Alert>
    );
  }

  const currentQuestion = request.questions[currentIndex];
  const canRecord = !recording && !uploading;
  const progressValue =
    ((currentIndex +
      (uploading || savedAnswers.length > currentIndex ? 1 : 0)) /
      request.questions.length) *
    100;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="p" sx={{ color: "#657085", mb: 1 }}>
          Question {currentIndex + 1} of {request.questions.length}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={progressValue}
          sx={{ mb: 3 }}
        />
        <Typography sx={{ color: "#657085" }}>
          When ready, record your one minute answer.
        </Typography>
        <Typography component="h2" sx={{ fontSize: "1.5rem", mb: 1 }}>
          {currentQuestion}
        </Typography>
      </Box>

      <Box
        sx={{
          bgcolor: "#0f172a",
          borderRadius: 2,
          minHeight: 260,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Box
          component="video"
          ref={videoRef}
          autoPlay
          muted
          playsInline
          sx={{
            display: recording ? "block" : "none",
            height: "100%",
            minHeight: 260,
            objectFit: "cover",
            width: "100%",
          }}
        />
        {!recording ? (
          <Stack
            spacing={1}
            sx={{
              alignItems: "center",
              color: "#e5e7eb",
              inset: 0,
              justifyContent: "center",
              minHeight: 260,
              p: 3,
              position: "absolute",
              textAlign: "center",
            }}
          >
            {uploading ? <CircularProgress color="inherit" /> : null}
            <Typography>
              {uploading
                ? "Uploading answer..."
                : "Camera preview will appear when recording starts."}
            </Typography>
          </Stack>
        ) : null}
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { xs: "stretch", sm: "center" } }}
      >
        {!recording ? (
          <Button
            variant="contained"
            startIcon={<VideocamOutlinedIcon />}
            onClick={startRecording}
            disabled={!canRecord}
          >
            Start recording
          </Button>
        ) : (
          <Button
            color="error"
            variant="contained"
            startIcon={<StopCircleOutlinedIcon />}
            onClick={stopRecording}
          >
            Stop and upload
          </Button>
        )}
        <Typography sx={{ color: "#657085" }}>
          {recording
            ? `${recordSecondsLeft} second${recordSecondsLeft === 1 ? "" : "s"} remaining`
            : "Each answer is saved automatically after recording."}
        </Typography>
      </Stack>
    </Stack>
  );
}
