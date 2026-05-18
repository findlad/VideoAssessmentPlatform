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

const DEFAULT_RECORD_SECONDS = 60;
const DEFAULT_ATTEMPTS_ALLOWED = 1;
const UPLOAD_RETRY_DELAYS_MS = [1000, 2500, 5000];
const DRAFT_DB_NAME = "video-assessment-upload-drafts";
const DRAFT_STORE_NAME = "answers";

function getQuestionCount(request) {
  return request?.questionCount || request?.questions?.length || 0;
}

function getQuestionSettings(request, index) {
  const setting = request?.questionSettings?.[index] || {};

  return {
    attemptsAllowed: Math.max(
      1,
      Number(setting.attemptsAllowed) || DEFAULT_ATTEMPTS_ALLOWED,
    ),
    maxDurationSeconds: Math.max(
      1,
      Number(setting.maxDurationSeconds) || DEFAULT_RECORD_SECONDS,
    ),
    question: request?.questions?.[index] || setting.question || "",
    questionIndex: index,
  };
}

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

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDraftDb() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DRAFT_DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRAFT_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withDraftStore(mode, callback) {
  const db = await openDraftDb();

  if (!db) {
    return null;
  }

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(DRAFT_STORE_NAME, mode);
      const store = transaction.objectStore(DRAFT_STORE_NAME);
      const result = callback(store);

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

function getDraftId(assessmentId, questionIndex) {
  return `${assessmentId}:${questionIndex}`;
}

async function saveAnswerDraft(draft) {
  await withDraftStore("readwrite", (store) => store.put(draft));
}

async function readAnswerDraft(assessmentId, questionIndex) {
  return withDraftStore(
    "readonly",
    (store) =>
      new Promise((resolve, reject) => {
        const request = store.get(getDraftId(assessmentId, questionIndex));

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      }),
  );
}

async function deleteAnswerDraft(assessmentId, questionIndex) {
  await withDraftStore("readwrite", (store) =>
    store.delete(getDraftId(assessmentId, questionIndex)),
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function InterviewQuestions({
  fileName,
  token,
  onCompletedChange,
  onRequestLoaded,
}) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(Boolean(fileName || token));
  const [error, setError] = useState("");
  const [landingAccepted, setLandingAccepted] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceChecking, setDeviceChecking] = useState(false);
  const [cameraPreviewReady, setCameraPreviewReady] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [recordSecondsLeft, setRecordSecondsLeft] =
    useState(DEFAULT_RECORD_SECONDS);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadAttemptMessage, setUploadAttemptMessage] = useState("");
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [attemptsUsedByQuestion, setAttemptsUsedByQuestion] = useState([]);
  const [savedAnswers, setSavedAnswers] = useState([]);
  const [readyForFinalSubmit, setReadyForFinalSubmit] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [expired, setExpired] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const stopTimeoutRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioFrameRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function loadAssessment() {
      if (!fileName && !token) {
        setLoading(false);
        setError("This interview link is missing an access token.");
        onRequestLoaded?.(null);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const nextRequest = token
          ? await fetch(
              `/api/assessments/by-token?token=${encodeURIComponent(token)}`,
            ).then(async (response) => {
              const body = await response.json().catch(() => ({}));

              if (!response.ok) {
                if (response.status === 410) {
                  setExpired(true);
                }

                throw new Error(body.error || "Assessment not found.");
              }

              return body.assessment;
            })
          : await readDocument("questions", fileName);

        if (!active) {
          return;
        }

        if (!nextRequest) {
          setError("We could not find this interview request.");
          setRequest(null);
          onRequestLoaded?.(null);
          return;
        }

        setRequest(nextRequest);
        onRequestLoaded?.(nextRequest);

        if (["completed", "reviewed", "responded"].includes(nextRequest.status)) {
          setCompleted(true);
          onCompletedChange?.(true);
          return;
        }

        const nextIndex = nextRequest.responseCount || 0;
        const assessmentId = nextRequest.id || fileName;

        setCurrentIndex(nextIndex);
        setCurrentQuestion(null);
        setPendingAnswer(null);
        setRecoveredDraft(false);
        setAttemptsUsedByQuestion([]);
        setSavedAnswers([]);
        setReadyForFinalSubmit(false);
        setCompleted(false);
        setExpired(false);
        onCompletedChange?.(false);

        if (assessmentId) {
          const draft = await readAnswerDraft(assessmentId, nextIndex).catch(
            () => null,
          );

          if (!active || !draft?.blob || nextIndex >= getQuestionCount(nextRequest)) {
            return;
          }

          setCurrentQuestion(draft.question);
          setPendingAnswer(draft.blob);
          setRecoveredDraft(true);
          setAttemptsUsedByQuestion((current) => {
            const next = [...current];

            next[nextIndex] = draft.attemptsUsed || 1;

            return next;
          });
        }
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

    loadAssessment();

    return () => {
      active = false;
    };
  }, [fileName, onCompletedChange, onRequestLoaded, token]);

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
    // `stopCamera` only reads refs and stable React setters during unmount cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (deviceReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [deviceReady]);

  function stopAudioMeter() {
    if (audioFrameRef.current) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }

    audioContextRef.current?.close?.();
    audioContextRef.current = null;
    setAudioLevel(0);
  }

  function stopCamera() {
    stopAudioMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraPreviewReady(false);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function startAudioMeter(stream) {
    stopAudioMeter();

    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
      setAudioLevel(40);
      return;
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const data = new Uint8Array(analyser.frequencyBinCount);

    source.connect(analyser);
    audioContextRef.current = audioContext;

    function tick() {
      analyser.getByteFrequencyData(data);
      const average =
        data.reduce((sum, value) => sum + value, 0) / Math.max(1, data.length);

      setAudioLevel(Math.min(100, Math.round(average * 2)));
      audioFrameRef.current = window.requestAnimationFrame(tick);
    }

    tick();
  }

  async function startDeviceCheck() {
    setDeviceChecking(true);
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      streamRef.current = stream;
      setCameraPreviewReady(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      startAudioMeter(stream);
    } catch (nextError) {
      stopCamera();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to access your camera and microphone. Check your browser permissions and try again.",
      );
    } finally {
      setDeviceChecking(false);
    }
  }

  async function loadQuestionForRecording() {
    if (!request) {
      return null;
    }

    if (!token) {
      return getQuestionSettings(request, currentIndex);
    }

    const response = await fetch("/api/assessments/question", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        questionIndex: currentIndex,
        token,
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 410) {
        setExpired(true);
      }

      throw new Error(body.error || "Unable to load this question.");
    }

    return body.question;
  }

  async function startQuestionRecording() {
    if (!request || !streamRef.current) {
      return;
    }

    setError("");

    try {
      const settings = currentQuestion || (await loadQuestionForRecording());
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(
        streamRef.current,
        mimeType ? { mimeType } : undefined,
      );

      setCurrentQuestion(settings);
      setRecordSecondsLeft(settings.maxDurationSeconds);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        const assessmentId = request.id || fileName;
        const nextAttemptsUsed = (attemptsUsedByQuestion[currentIndex] || 0) + 1;

        setRecording(false);
        setPendingAnswer(blob);
        setRecoveredDraft(false);
        setAttemptsUsedByQuestion((current) => {
          const next = [...current];

          next[currentIndex] = nextAttemptsUsed;

          return next;
        });

        if (assessmentId) {
          await saveAnswerDraft({
            attemptsUsed: nextAttemptsUsed,
            blob,
            contentType: blob.type || "video/webm",
            createdAt: new Date().toISOString(),
            id: getDraftId(assessmentId, currentIndex),
            question: settings,
            questionIndex: currentIndex,
          }).catch(() => {
            setError(
              "Your answer was recorded, but this browser could not store a recovery copy. Please submit it before closing this page.",
            );
          });
        }
      };

      recorder.start();
      setRecording(true);
      stopTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, settings.maxDurationSeconds * 1000);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to start this question.",
      );
    }
  }

  function stopRecording() {
    window.clearTimeout(stopTimeoutRef.current);

    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  async function submitAnswer() {
    if (!pendingAnswer || !request || !currentQuestion) {
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadAttemptMessage("Preparing upload...");
    setError("");

    try {
      const assessmentId = request.id || fileName;
      const questionCount = getQuestionCount(request);
      const nextResponseCount = currentIndex + 1;
      let path = "";

      for (let attempt = 0; attempt <= UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          setUploadAttemptMessage(
            attempt === 0
              ? "Uploading answer..."
              : `Retrying upload, attempt ${attempt + 1}...`,
          );
          path = await uploadInterviewAnswer(
            assessmentId,
            currentIndex,
            pendingAnswer,
            {
              onProgress: setUploadProgress,
            },
          );

          setUploadAttemptMessage("Saving answer metadata...");
          await writeDocument(
            `questions/${assessmentId}/answers`,
            `answer-${nextResponseCount}`,
            {
              attemptsAllowed: currentQuestion.attemptsAllowed,
              attemptsUsed: attemptsUsedByQuestion[currentIndex] || 1,
              maxDurationSeconds: currentQuestion.maxDurationSeconds,
              question: currentQuestion.question,
              questionIndex: currentIndex,
              storagePath: path,
              contentType: pendingAnswer.type || "video/webm",
            },
          );
          await updateDocument("questions", assessmentId, {
            responseCount: nextResponseCount,
            status: "in-progress",
          });
          break;
        } catch (uploadError) {
          if (attempt >= UPLOAD_RETRY_DELAYS_MS.length) {
            throw uploadError;
          }

          setUploadAttemptMessage("Upload failed. Retrying automatically...");
          await wait(UPLOAD_RETRY_DELAYS_MS[attempt]);
        }
      }

      setSavedAnswers((current) => [...current, path]);
      await deleteAnswerDraft(assessmentId, currentIndex).catch(() => {});
      setPendingAnswer(null);
      setCurrentQuestion(null);
      setRecoveredDraft(false);

      if (nextResponseCount >= questionCount) {
        setReadyForFinalSubmit(true);
      } else {
        setCurrentIndex(nextResponseCount);
      }
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : "Unable to upload this answer.";

      setError(
        `${message} The recording is still saved on this device; keep this tab open or retry from this browser.`,
      );
    } finally {
      setUploading(false);
      setUploadAttemptMessage("");
    }
  }

  async function submitCompletedAssessment() {
    if (!request) {
      return;
    }

    setUploading(true);
    setError("");

    try {
      const assessmentId = request.id || fileName;

      if (token) {
        const response = await fetch("/api/assessments/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 410) {
            setExpired(true);
          }

          throw new Error(body.error || "Unable to submit assessment.");
        }
      } else {
        await updateDocument("questions", assessmentId, {
          status: "responded",
        });
      }

      stopCamera();
      setCompleted(true);
      onCompletedChange?.(true);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to submit assessment.",
      );
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <CircularProgress size={22} />
        <Typography sx={{ color: "#657085" }}>
          Loading interview...
        </Typography>
      </Stack>
    );
  }

  if (expired) {
    return (
      <Alert severity="warning">
        This assessment link has expired. Please contact the person who sent it
        if you need a new link.
      </Alert>
    );
  }

  if (error && !pendingAnswer) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (completed) {
    return (
      <Alert icon={<CheckCircleOutlineIcon />} severity="success">
        Interview complete. Your answers have been submitted successfully.
      </Alert>
    );
  }

  if (!request) {
    return <Alert severity="error">Interview request unavailable.</Alert>;
  }

  const questionCount = getQuestionCount(request);
  const visibleSettings =
    currentQuestion || getQuestionSettings(request, currentIndex);
  const attemptsUsed = attemptsUsedByQuestion[currentIndex] || 0;
  const canRecord =
    deviceReady &&
    !recording &&
    !uploading &&
    !pendingAnswer &&
    attemptsUsed < visibleSettings.attemptsAllowed;
  const canRetry =
    deviceReady &&
    !recording &&
    !uploading &&
    pendingAnswer &&
    attemptsUsed < visibleSettings.attemptsAllowed;
  const progressValue =
    ((currentIndex + (savedAnswers.length > currentIndex ? 1 : 0)) /
      Math.max(1, questionCount)) *
    100;

  if (!landingAccepted) {
    return (
      <Stack spacing={2}>
        <Typography sx={{ color: "#657085" }}>
          Hello {request.candidateName || request.intervieweeName || "there"}.
          You will answer {questionCount} question
          {questionCount === 1 ? "" : "s"} one at a time. Questions are not
          shown until recording begins, and there is no preparation time between
          questions.
        </Typography>
        {request.assessmentDescription ? (
          <Alert severity="info">{request.assessmentDescription}</Alert>
        ) : null}
        <Stack spacing={1}>
          {request.questionSettings?.map((setting, index) => (
            <Typography key={index} sx={{ color: "#657085" }}>
              Question {index + 1}: {setting.attemptsAllowed || 1} attempt
              {(setting.attemptsAllowed || 1) === 1 ? "" : "s"},{" "}
              {setting.maxDurationSeconds || DEFAULT_RECORD_SECONDS} seconds
            </Typography>
          ))}
        </Stack>
        <Button
          size="large"
          variant="contained"
          onClick={() => setLandingAccepted(true)}
        >
          Begin assessment
        </Button>
      </Stack>
    );
  }

  if (!deviceReady) {
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          Before you begin, confirm your camera and microphone are working.
          Questions will remain hidden until you start each recording.
        </Alert>
        <Box
          sx={{
            bgcolor: "#0f172a",
            borderRadius: 2,
            minHeight: { xs: 220, md: 240 },
            overflow: "hidden",
          }}
        >
          <Box
            component="video"
            ref={videoRef}
            autoPlay
            muted
            playsInline
            sx={{
              display: cameraPreviewReady ? "block" : "none",
              minHeight: { xs: 220, md: 240 },
              objectFit: "cover",
              width: "100%",
            }}
          />
        </Box>
        <Box>
          <Typography sx={{ color: "#657085", mb: 1 }}>
            Microphone level
          </Typography>
          <Box sx={{ bgcolor: "#d9dee8", borderRadius: 1, height: 12 }}>
            <Box
              sx={{
                bgcolor: "#1665d8",
                borderRadius: 1,
                height: 12,
                width: `${audioLevel}%`,
              }}
            />
          </Box>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Button
            variant="outlined"
            onClick={startDeviceCheck}
            disabled={deviceChecking}
          >
            {deviceChecking ? "Checking..." : "Start camera check"}
          </Button>
          <Button
            variant="contained"
            disabled={!cameraPreviewReady}
            onClick={() => setDeviceReady(true)}
          >
            Camera and microphone work
          </Button>
        </Stack>
      </Stack>
    );
  }

  if (readyForFinalSubmit) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">
          All answers are recorded. Submit your completed assessment when ready.
        </Alert>
        <Button
          variant="contained"
          onClick={submitCompletedAssessment}
          disabled={uploading}
        >
          {uploading ? (
            <CircularProgress color="inherit" size={20} />
          ) : (
            "Submit completed assessment"
          )}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {recoveredDraft ? (
        <Alert severity="info">
          We recovered a recorded answer from this browser. Submit it to
          continue.
        </Alert>
      ) : null}
      <Box>
        <Typography component="p" sx={{ color: "#657085", mb: 1 }}>
          Question {currentIndex + 1} of {questionCount}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={progressValue}
          sx={{ mb: 2 }}
        />
        <Typography sx={{ color: "#657085" }}>
          {currentQuestion
            ? `Attempt ${attemptsUsed} of ${visibleSettings.attemptsAllowed}.`
            : "The question will appear when recording starts."}
        </Typography>
        {currentQuestion ? (
          <Typography
            component="h2"
            sx={{ fontSize: { xs: "1.2rem", md: "1.35rem" }, mb: 1 }}
          >
            {currentQuestion.question}
          </Typography>
        ) : null}
      </Box>

      <Box
        sx={{
          bgcolor: "#0f172a",
          borderRadius: 2,
          minHeight: { xs: 220, md: 240 },
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
            display: "block",
            minHeight: { xs: 220, md: 240 },
            objectFit: "cover",
            width: "100%",
          }}
        />
        {!recording ? (
          <Stack
            spacing={1}
            sx={{
              alignItems: "center",
              bgcolor: "rgba(15, 23, 42, 0.72)",
              color: "#e5e7eb",
              inset: 0,
              justifyContent: "center",
              minHeight: { xs: 220, md: 240 },
              p: 2,
              position: "absolute",
              textAlign: "center",
            }}
          >
            {uploading ? <CircularProgress color="inherit" /> : null}
            <Typography>
              {uploading
                ? uploadAttemptMessage || "Uploading answer..."
                : pendingAnswer
                  ? "Answer recorded. Submit it or retry if you have attempts remaining."
                  : "Ready when you are. Starting will reveal the question and begin recording."}
            </Typography>
            {uploading ? (
              <Box sx={{ maxWidth: 420, width: "100%" }}>
                <LinearProgress
                  variant={uploadProgress ? "determinate" : "indeterminate"}
                  value={uploadProgress}
                />
                {uploadProgress ? (
                  <Typography sx={{ mt: 1 }}>
                    {uploadProgress}% uploaded
                  </Typography>
                ) : null}
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { xs: "stretch", sm: "center" } }}
      >
        {!recording ? (
          <>
            {!pendingAnswer ? (
              <Button
                variant="contained"
                startIcon={<VideocamOutlinedIcon />}
                onClick={startQuestionRecording}
                disabled={!canRecord}
              >
                Start question {currentIndex + 1}
              </Button>
            ) : (
              <>
                <Button
                  variant="contained"
                  onClick={submitAnswer}
                  disabled={uploading}
                >
                  Submit answer
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<VideocamOutlinedIcon />}
                  onClick={() => {
                    setPendingAnswer(null);
                    startQuestionRecording();
                  }}
                  disabled={!canRetry}
                >
                  Retry recording
                </Button>
              </>
            )}
          </>
        ) : (
          <Button
            color="error"
            variant="contained"
            startIcon={<StopCircleOutlinedIcon />}
            onClick={stopRecording}
          >
            Stop recording
          </Button>
        )}
        <Typography sx={{ color: "#657085" }}>
          {recording
            ? `${recordSecondsLeft} second${recordSecondsLeft === 1 ? "" : "s"} remaining`
            : `Maximum recording time: ${visibleSettings.maxDurationSeconds} second${
                visibleSettings.maxDurationSeconds === 1 ? "" : "s"
              }.`}
        </Typography>
      </Stack>
    </Stack>
  );
}
