"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  deleteDocument,
  orderByField,
  queryDocuments,
  subscribeToDocuments,
  updateDocument,
  whereEquals,
} from "@/lib/firebase/firestore";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { useFirebase } from "@/context/FirebaseContext";
import {
  deleteStorageFile,
  getStorageDownloadUrl,
} from "@/lib/firebase/storage";
import logo from "@/images/LogoTransparent.png";

const DEFAULT_QUESTION_COUNT = 4;
const DEFAULT_ATTEMPTS_ALLOWED = 1;
const DEFAULT_MAX_DURATION_SECONDS = 60;
const MAX_DURATION_MINUTES = 5;
const MAX_QUESTIONS = 6;

const initialQuestions = Array.from(
  { length: DEFAULT_QUESTION_COUNT },
  () => ({
    attemptsAllowed: DEFAULT_ATTEMPTS_ALLOWED,
    maxDurationMinutes: DEFAULT_MAX_DURATION_SECONDS / 60,
    text: "",
  }),
);

function sanitizeFileNamePart(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "unknown"
  );
}

function getAnswerExtension(answer) {
  if (answer.contentType?.includes("mp4")) {
    return "mp4";
  }

  const storageExtension = answer.storagePath?.split(".").pop();

  return storageExtension || "webm";
}

async function downloadUrlAsFile(url, fileName) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to download ${fileName}.`);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

export function NewInterviewRequestLanding() {
  const { auth, authLoading, user } = useFirebase();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedReviewInterview, setSelectedReviewInterview] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState([]);
  const [savingReviewId, setSavingReviewId] = useState("");
  const [savingNotesId, setSavingNotesId] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingInterviewId, setDownloadingInterviewId] = useState("");
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeyLabel, setApiKeyLabel] = useState("External integration");
  const [newApiKeySecret, setNewApiKeySecret] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [revokingApiKeyId, setRevokingApiKeyId] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [interviews, setInterviews] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [interviewTitle, setInterviewTitle] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [intervieweeName, setIntervieweeName] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [questions, setQuestions] = useState(initialQuestions);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdFileId, setCreatedFileId] = useState("");

  const orderedQuestions = useMemo(
    () =>
      questions
        .map((question) => ({
          attemptsAllowed: Math.max(
            1,
            Number(question.attemptsAllowed) || DEFAULT_ATTEMPTS_ALLOWED,
          ),
          maxDurationSeconds:
            Math.min(
              MAX_DURATION_MINUTES,
              Math.max(
                1,
                Number(question.maxDurationMinutes) ||
                  DEFAULT_MAX_DURATION_SECONDS / 60,
              ),
            ) * 60,
          text: question.text.trim(),
        }))
        .filter((question) => question.text),
    [questions],
  );

  const canSubmit =
    Boolean(user) &&
    interviewTitle.trim().length > 0 &&
    requesterName.trim().length > 0 &&
    intervieweeName.trim().length > 0 &&
    targetEmail.trim().length > 0 &&
    orderedQuestions.length > 0 &&
    !submitting;

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");

    try {
      if (!auth) {
        throw new Error("Firebase Auth is not initialized.");
      }

      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
      } else {
        await createUserWithEmailAndPassword(
          auth,
          authEmail.trim(),
          authPassword,
        );
      }

      setAuthPassword("");
    } catch (nextError) {
      setAuthError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to authenticate.",
      );
    }
  }

  const getAuthToken = useCallback(async () => {
    if (!user) {
      throw new Error("You must be signed in.");
    }

    return user.getIdToken();
  }, [user]);

  const loadApiKeys = useCallback(async () => {
    if (!user) {
      setApiKeys([]);
      return;
    }

    setApiKeysLoading(true);
    setApiKeyError("");

    try {
      const token = await getAuthToken();
      const response = await fetch("/api/admin/api-keys", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || "Unable to load API keys.");
      }

      setApiKeys(body.apiKeys || []);
    } catch (nextError) {
      setApiKeyError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load API keys.",
      );
    } finally {
      setApiKeysLoading(false);
    }
  }, [getAuthToken, user]);

  async function handleCreateApiKey(event) {
    event.preventDefault();
    setCreatingApiKey(true);
    setApiKeyError("");
    setNewApiKeySecret("");

    try {
      const token = await getAuthToken();
      const response = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: apiKeyLabel,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || "Unable to create API key.");
      }

      setNewApiKeySecret(body.secret || "");
      setApiKeys((current) => [body.apiKey, ...current]);
    } catch (nextError) {
      setApiKeyError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to create API key.",
      );
    } finally {
      setCreatingApiKey(false);
    }
  }

  async function handleRevokeApiKey(apiKeyId) {
    setRevokingApiKeyId(apiKeyId);
    setApiKeyError("");

    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/admin/api-keys/${apiKeyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || "Unable to revoke API key.");
      }

      setApiKeys((current) =>
        current.map((apiKey) =>
          apiKey.id === apiKeyId
            ? { ...apiKey, revokedAt: new Date().toISOString() }
            : apiKey,
        ),
      );
    } catch (nextError) {
      setApiKeyError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to revoke API key.",
      );
    } finally {
      setRevokingApiKeyId("");
    }
  }

  async function copyNewApiKey() {
    if (!newApiKeySecret) {
      return;
    }

    await navigator.clipboard.writeText(newApiKeySecret);
  }

  function updateQuestion(index, field, value) {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? { ...question, [field]: value } : question,
      ),
    );
  }

  function updateQuestionMaxDuration(index, value) {
    const duration = Number(value);

    updateQuestion(
      index,
      "maxDurationMinutes",
      duration > MAX_DURATION_MINUTES ? String(MAX_DURATION_MINUTES) : value,
    );
  }

  function addQuestion() {
    setQuestions((current) =>
      current.length >= MAX_QUESTIONS
        ? current
        : [
            ...current,
            {
              attemptsAllowed: DEFAULT_ATTEMPTS_ALLOWED,
              maxDurationMinutes: DEFAULT_MAX_DURATION_SECONDS / 60,
              text: "",
            },
          ],
    );
  }

  function removeQuestion(index) {
    setQuestions((current) =>
      current.length === 1
        ? current
        : current.filter((question, questionIndex) => questionIndex !== index),
    );
  }

  function resetDialog() {
    setInterviewTitle("");
    setRequesterName("");
    setIntervieweeName("");
    setTargetEmail("");
    setQuestions(initialQuestions);
    setError("");
  }

  function openNewInterviewDialog() {
    resetDialog();
    setCreatedFileId("");
    setDialogOpen(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setCreatedFileId("");

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/interview-requests", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          interviewTitle,
          requesterName,
          intervieweeName,
          targetEmail,
          questions: orderedQuestions,
        }),
      });
      const responseBody = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          responseBody.error || "Unable to create the interview request.",
        );
      }

      setCreatedFileId(responseBody.id || "");
      setDialogOpen(false);
      resetDialog();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to create the interview request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openReview(interview) {
    setSelectedAnswers([]);
    setSelectedReviewInterview(interview);
    setReviewOpen(true);
    setReviewLoading(true);

    try {
      const answers = await queryDocuments(
        `questions/${interview.id}/answers`,
        [orderByField("questionIndex", "asc")],
      );
      const answersWithUrls = await Promise.all(
        answers.map(async (answer) => ({
          ...answer,
          url: await getStorageDownloadUrl(answer.storagePath),
        })),
      );

      setSelectedAnswers(answersWithUrls);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load interview answers.",
      );
    } finally {
      setReviewLoading(false);
    }
  }

  function updateSelectedAnswer(answerId, nextValues) {
    setSelectedAnswers((current) =>
      current.map((answer) =>
        answer.id === answerId ? { ...answer, ...nextValues } : answer,
      ),
    );
  }

  async function handleReviewRating(answer, rating) {
    if (!selectedReviewInterview) {
      return;
    }

    const previousRating = answer.reviewRating;

    updateSelectedAnswer(answer.id, { reviewRating: rating });
    setSavingReviewId(answer.id);
    setError("");

    try {
      await updateDocument(
        `questions/${selectedReviewInterview.id}/answers`,
        answer.id,
        {
          reviewRating: rating,
        },
      );
    } catch (nextError) {
      updateSelectedAnswer(answer.id, { reviewRating: previousRating });
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to save response rating.",
      );
    } finally {
      setSavingReviewId("");
    }
  }

  function handleReviewNotesChange(answerId, value) {
    updateSelectedAnswer(answerId, { reviewNotes: value });
  }

  async function handleSaveReviewNotes(answer) {
    if (!selectedReviewInterview) {
      return;
    }

    setSavingNotesId(answer.id);
    setError("");

    try {
      await updateDocument(
        `questions/${selectedReviewInterview.id}/answers`,
        answer.id,
        {
          reviewNotes: answer.reviewNotes || "",
        },
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to save response notes.",
      );
    } finally {
      setSavingNotesId("");
    }
  }

  function openDeleteConfirmation(interview) {
    setDeleteTarget(interview);
    setDeleteOpen(true);
  }

  async function handleDownloadVideos(interview) {
    setDownloadingInterviewId(interview.id);
    setError("");

    try {
      const answers = await queryDocuments(`questions/${interview.id}/answers`, [
        orderByField("questionIndex", "asc"),
      ]);

      if (answers.length === 0) {
        throw new Error("No uploaded videos were found for this interview.");
      }

      const candidateName = sanitizeFileNamePart(interview.intervieweeName);

      for (const answer of answers) {
        const questionNumber = (answer.questionIndex ?? 0) + 1;
        const question = sanitizeFileNamePart(
          answer.question || `Question ${questionNumber}`,
        );
        const extension = getAnswerExtension(answer);
        const url = await getStorageDownloadUrl(answer.storagePath);

        await downloadUrlAsFile(
          url,
          `${candidateName} - Question ${questionNumber} - ${question}.${extension}`,
        );
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to download interview videos.",
      );
    } finally {
      setDownloadingInterviewId("");
    }
  }

  async function handleDeleteInterview() {
    if (!deleteTarget) {
      return;
    }

    setDeleting(true);
    setError("");

    try {
      const answers = await queryDocuments(
        `questions/${deleteTarget.id}/answers`,
        [],
      );

      await Promise.all(
        answers.map(async (answer) => {
          if (answer.storagePath) {
            await deleteStorageFile(answer.storagePath);
          }

          await deleteDocument(
            `questions/${deleteTarget.id}/answers`,
            answer.id,
          );
        }),
      );
      await deleteDocument("questions", deleteTarget.id);

      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to delete this interview.",
      );
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    let unsubscribe = () => {};

    const timer = window.setTimeout(() => {
      if (!user) {
        setInterviews([]);
        setDashboardLoading(false);
        return;
      }

      setDashboardLoading(true);

      unsubscribe = subscribeToDocuments(
        "questions",
        [whereEquals("createdBy", user.uid)],
        (nextInterviews) => {
          setInterviews(
            nextInterviews.sort(
              (first, second) =>
                (second.createdAt?.toMillis?.() || 0) -
                (first.createdAt?.toMillis?.() || 0),
            ),
          );
          setDashboardLoading(false);
        },
        (nextError) => {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to load commissioned interviews.",
          );
          setDashboardLoading(false);
        },
      );
    }, 0);

    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [loadApiKeys, user]);

  useEffect(() => {
    if (!createdFileId) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCreatedFileId("");
    }, 15000);

    return () => window.clearTimeout(timer);
  }, [createdFileId]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (user) {
        await loadApiKeys();
      } else {
        setApiKeys([]);
        setNewApiKeySecret("");
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadApiKeys, user]);

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        bgcolor: "#f4f7fb",
        color: "#172033",
        display: "flex",
        alignItems: "center",
        py: { xs: 6, md: 10 },
      }}
    >
      <Container maxWidth="lg">
        <Stack spacing={4}>
          <Stack spacing={2}>
            <Box>
              <Image
                src={logo}
                alt="Video Assessment Platform"
                height={200}
                priority
              />
            </Box>

            <Typography
              component="h1"
              sx={{
                fontSize: { xs: "2.4rem", md: "4rem" },
                fontWeight: 800,
                lineHeight: 1,
                maxWidth: 700,
              }}
            >
              Welcome to the delightful video interview platform
            </Typography>
            <Typography sx={{ color: "#657085", fontSize: "1.08rem" }}>
              Create a focused interview request, send it to a candidate, and
              route them straight to the interview page.
            </Typography>
          </Stack>

          {!user ? (
            <Box
              component="form"
              onSubmit={handleAuthSubmit}
              sx={{
                bgcolor: "#fff",
                border: "1px solid #d9dee8",
                borderRadius: 2,
                maxWidth: 520,
                p: 3,
              }}
            >
              <Stack spacing={2}>
                <Typography component="h2" sx={{ fontSize: "1.35rem" }}>
                  {authMode === "login" ? "Sign in" : "Create an account"}
                </Typography>
                {authError ? <Alert severity="error">{authError}</Alert> : null}
                <TextField
                  label="Email"
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  slotProps={{
                    htmlInput: {
                      suppressHydrationWarning: true,
                    },
                  }}
                  required
                  fullWidth
                />
                <TextField
                  label="Password"
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  required
                  fullWidth
                />
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={authLoading}
                  >
                    {authMode === "login" ? "Sign in" : "Create account"}
                  </Button>
                  <Button
                    type="button"
                    color="inherit"
                    onClick={() =>
                      setAuthMode((mode) =>
                        mode === "login" ? "create" : "login",
                      )
                    }
                  >
                    {authMode === "login"
                      ? "Create account"
                      : "Use existing account"}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ) : (
            <Stack spacing={3}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ alignItems: { xs: "stretch", sm: "center" } }}
              >
                <Button
                  size="large"
                  variant="contained"
                  onClick={openNewInterviewDialog}
                >
                  Set up a new interview
                </Button>
                <Button
                  color="inherit"
                  startIcon={<LogoutIcon />}
                  onClick={() => signOut(auth)}
                >
                  Sign out
                </Button>
              </Stack>

              <Box
                sx={{
                  bgcolor: "#fff",
                  border: "1px solid #d9dee8",
                  borderRadius: 2,
                  p: 3,
                }}
              >
                <Stack spacing={2}>
                  <Typography component="h2" sx={{ fontSize: "1.25rem" }}>
                    API keys
                  </Typography>
                  {apiKeyError ? (
                    <Alert severity="error">{apiKeyError}</Alert>
                  ) : null}
                  <Box component="form" onSubmit={handleCreateApiKey}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1.5}
                    >
                      <TextField
                        label="Key label"
                        value={apiKeyLabel}
                        onChange={(event) => setApiKeyLabel(event.target.value)}
                        fullWidth
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        disabled={creatingApiKey}
                        sx={{ whiteSpace: "nowrap" }}
                      >
                        {creatingApiKey ? (
                          <CircularProgress color="inherit" size={20} />
                        ) : (
                          "Generate key"
                        )}
                      </Button>
                    </Stack>
                  </Box>
                  {newApiKeySecret ? (
                    <Alert
                      severity="success"
                      action={
                        <Button
                          color="inherit"
                          size="small"
                          startIcon={<ContentCopyOutlinedIcon />}
                          onClick={copyNewApiKey}
                        >
                          Copy
                        </Button>
                      }
                    >
                      New key created. Copy it now:{" "}
                      <Box
                        component="span"
                        sx={{
                          fontFamily: "monospace",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {newApiKeySecret}
                      </Box>
                    </Alert>
                  ) : null}
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Label</TableCell>
                          <TableCell>Created</TableCell>
                          <TableCell>Last used</TableCell>
                          <TableCell>Uses</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {apiKeysLoading ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <Stack
                                direction="row"
                                spacing={1.5}
                                sx={{ alignItems: "center" }}
                              >
                                <CircularProgress size={18} />
                                <Typography>Loading API keys...</Typography>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ) : null}
                        {!apiKeysLoading && apiKeys.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              No API keys generated yet.
                            </TableCell>
                          </TableRow>
                        ) : null}
                        {apiKeys.map((apiKey) => {
                          const revoked = Boolean(apiKey.revokedAt);

                          return (
                            <TableRow key={apiKey.id}>
                              <TableCell>{apiKey.label}</TableCell>
                              <TableCell>
                                {apiKey.createdAt
                                  ? new Date(
                                      apiKey.createdAt,
                                    ).toLocaleDateString()
                                  : "Unknown"}
                              </TableCell>
                              <TableCell>
                                {apiKey.lastUsedAt
                                  ? new Date(
                                      apiKey.lastUsedAt,
                                    ).toLocaleString()
                                  : "Never"}
                              </TableCell>
                              <TableCell>{apiKey.usageCount}</TableCell>
                              <TableCell>
                                <Chip
                                  label={revoked ? "Revoked" : "Active"}
                                  color={revoked ? "default" : "success"}
                                  size="small"
                                />
                              </TableCell>
                              <TableCell align="right">
                                <Button
                                  color="error"
                                  disabled={
                                    revoked || revokingApiKeyId === apiKey.id
                                  }
                                  onClick={() => handleRevokeApiKey(apiKey.id)}
                                  size="small"
                                  variant="outlined"
                                >
                                  {revokingApiKeyId === apiKey.id
                                    ? "Revoking"
                                    : "Revoke"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Stack>
              </Box>

              <Box
                sx={{
                  bgcolor: "#fff",
                  border: "1px solid #d9dee8",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Title</TableCell>
                        <TableCell>Interviewee</TableCell>
                        <TableCell>Target email</TableCell>
                        <TableCell>Questions</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Responses</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dashboardLoading ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <Stack
                              direction="row"
                              spacing={1.5}
                              sx={{ alignItems: "center" }}
                            >
                              <CircularProgress size={20} />
                              <Typography>Loading interviews...</Typography>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {!dashboardLoading && interviews.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            No interviews commissioned yet.
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {interviews.map((interview) => {
                        const responseCount = interview.responseCount || 0;
                        const responded =
                          ["completed", "responded", "reviewed"].includes(
                            interview.status,
                          ) || responseCount >= interview.questionCount;
                        const downloading =
                          downloadingInterviewId === interview.id;

                        return (
                          <TableRow key={interview.id}>
                            <TableCell>
                              {interview.interviewTitle || "Untitled"}
                            </TableCell>
                            <TableCell>
                              {interview.intervieweeName || "Unknown"}
                            </TableCell>
                            <TableCell>{interview.targetEmail}</TableCell>
                            <TableCell>{interview.questionCount}</TableCell>
                            <TableCell>
                              <Chip
                                label={responded ? "Response received" : "Sent"}
                                color={responded ? "success" : "default"}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>
                              {responseCount} / {interview.questionCount}
                            </TableCell>
                            <TableCell align="right">
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{ justifyContent: "flex-end" }}
                              >
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<VisibilityOutlinedIcon />}
                                  disabled={!responded}
                                  onClick={() => openReview(interview)}
                                >
                                  View
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={
                                    downloading ? (
                                      <CircularProgress
                                        color="inherit"
                                        size={16}
                                      />
                                    ) : (
                                      <FileDownloadOutlinedIcon />
                                    )
                                  }
                                  disabled={!responded || downloading}
                                  onClick={() => handleDownloadVideos(interview)}
                                >
                                  Download
                                </Button>
                                <Tooltip title="Delete interview">
                                  <span>
                                    <IconButton
                                      aria-label={`Delete interview for ${
                                        interview.intervieweeName ||
                                        interview.targetEmail
                                      }`}
                                      color="error"
                                      onClick={() =>
                                        openDeleteConfirmation(interview)
                                      }
                                    >
                                      <DeleteOutlinedIcon />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Stack>
          )}

          {createdFileId ? (
            <Alert severity="success">Interview request created.</Alert>
          ) : null}
        </Stack>
      </Container>

      <Dialog
        open={dialogOpen}
        onClose={() => {
          if (!submitting) {
            setDialogOpen(false);
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleSubmit}>
          <DialogTitle>Set up a new interview</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              {error ? <Alert severity="error">{error}</Alert> : null}
              <TextField
                label="Interview title"
                value={interviewTitle}
                onChange={(event) => setInterviewTitle(event.target.value)}
                required
                fullWidth
              />
              <TextField
                label="Your name"
                value={requesterName}
                onChange={(event) => setRequesterName(event.target.value)}
                required
                fullWidth
              />
              <TextField
                label="Interviewee name"
                value={intervieweeName}
                onChange={(event) => setIntervieweeName(event.target.value)}
                required
                fullWidth
              />
              <TextField
                label="Target email"
                type="email"
                value={targetEmail}
                onChange={(event) => setTargetEmail(event.target.value)}
                slotProps={{
                  htmlInput: {
                    suppressHydrationWarning: true,
                  },
                }}
                required
                fullWidth
              />
              <Stack spacing={2}>
                {questions.map((question, index) => (
                  <Stack
                    key={index}
                    spacing={1.5}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "flex-start" }}
                    >
                      <TextField
                        label={`Question ${index + 1}`}
                        value={question.text}
                        onChange={(event) =>
                          updateQuestion(index, "text", event.target.value)
                        }
                        multiline
                        minRows={index === 0 ? 3 : 2}
                        required={index === 0}
                        fullWidth
                      />
                      {questions.length > 1 ? (
                        <Tooltip title={`Remove question ${index + 1}`}>
                          <span>
                            <IconButton
                              aria-label={`Remove question ${index + 1}`}
                              onClick={() => removeQuestion(index)}
                              disabled={submitting}
                              sx={{ mt: 1 }}
                            >
                              <DeleteOutlinedIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : null}
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <TextField
                        label="Attempts allowed"
                        type="number"
                        value={question.attemptsAllowed}
                        onChange={(event) =>
                          updateQuestion(
                            index,
                            "attemptsAllowed",
                            event.target.value,
                          )
                        }
                        slotProps={{
                          htmlInput: {
                            max: MAX_DURATION_MINUTES,
                            min: 1,
                            step: 1,
                          },
                        }}
                        required
                        fullWidth
                      />
                      <TextField
                        label="Max duration (minutes)"
                        type="number"
                        value={question.maxDurationMinutes}
                        onChange={(event) =>
                          updateQuestionMaxDuration(index, event.target.value)
                        }
                        slotProps={{
                          htmlInput: {
                            min: 1,
                            step: 1,
                          },
                        }}
                        required
                        fullWidth
                      />
                    </Stack>
                  </Stack>
                ))}
                <Tooltip
                  title={
                    questions.length >= MAX_QUESTIONS
                      ? "Maximum of six questions"
                      : "Add question"
                  }
                >
                  <span>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={addQuestion}
                      disabled={submitting || questions.length >= MAX_QUESTIONS}
                      sx={{ alignSelf: "flex-start" }}
                    >
                      Add question
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
              color="inherit"
            >
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={!canSubmit}>
              {submitting ? (
                <CircularProgress color="inherit" size={22} />
              ) : (
                "Done"
              )}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={reviewOpen}
        onClose={() => {
          setReviewOpen(false);
          setSelectedReviewInterview(null);
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Interview response</DialogTitle>
        <DialogContent>
          {reviewLoading ? (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <CircularProgress size={22} />
              <Typography>Loading videos...</Typography>
            </Stack>
          ) : (
            <Stack spacing={3} sx={{ pt: 1 }}>
              {selectedAnswers.length === 0 ? (
                <Alert severity="info">No uploaded answers were found.</Alert>
              ) : null}
              {selectedAnswers.map((answer) => (
                <Box key={answer.id}>
                  <Typography
                    component="h3"
                    sx={{ fontSize: "1.05rem", mb: 1 }}
                  >
                    Question {answer.questionIndex + 1}: {answer.question}
                  </Typography>
                  <Box
                    component="video"
                    controls
                    src={answer.url}
                    sx={{
                      bgcolor: "#0f172a",
                      borderRadius: 1,
                      width: "100%",
                    }}
                  />
                  <Stack spacing={1.5} sx={{ mt: 2 }}>
                    <Box>
                      <Typography sx={{ color: "#657085", mb: 1 }}>
                        Rating
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ flexWrap: "wrap", rowGap: 1 }}
                      >
                        {Array.from({ length: 10 }, (_, ratingIndex) => {
                          const rating = ratingIndex + 1;
                          const selected = Number(answer.reviewRating) === rating;
                          const saving = savingReviewId === answer.id;

                          return (
                            <Button
                              key={rating}
                              aria-pressed={selected}
                              size="small"
                              variant={selected ? "contained" : "outlined"}
                              disabled={saving}
                              onClick={() => handleReviewRating(answer, rating)}
                              sx={{
                                borderWidth: selected ? 2 : 1,
                                fontWeight: selected ? 800 : 500,
                                minWidth: 38,
                                ...(selected && {
                                  bgcolor: "#1665d8",
                                  boxShadow: "0 0 0 2px rgba(22, 101, 216, 0.2)",
                                  color: "#fff",
                                  "&.Mui-disabled": {
                                    bgcolor: "#1665d8",
                                    color: "#fff",
                                    opacity: 0.72,
                                  },
                                  "&:hover": {
                                    bgcolor: "#0f56bd",
                                  },
                                }),
                              }}
                            >
                              {rating}
                            </Button>
                          );
                        })}
                      </Stack>
                      <Typography sx={{ color: "#657085", mt: 1 }}>
                        {answer.reviewRating
                          ? `${savingReviewId === answer.id ? "Saving" : "Saved"} rating: ${answer.reviewRating}/10`
                          : "No rating selected."}
                      </Typography>
                    </Box>
                    <TextField
                      label="Notes"
                      value={answer.reviewNotes || ""}
                      onChange={(event) =>
                        handleReviewNotesChange(answer.id, event.target.value)
                      }
                      multiline
                      minRows={3}
                      fullWidth
                    />
                    <Button
                      variant="outlined"
                      onClick={() => handleSaveReviewNotes(answer)}
                      disabled={savingNotesId === answer.id}
                      sx={{ alignSelf: "flex-start" }}
                    >
                      {savingNotesId === answer.id ? (
                        <CircularProgress color="inherit" size={18} />
                      ) : (
                        "Save notes"
                      )}
                    </Button>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setReviewOpen(false);
              setSelectedReviewInterview(null);
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteOpen(false);
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Delete interview request?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              This will delete the interview request, any recorded answer
              metadata, and uploaded answer videos for this interview. This
              cannot be undone.
            </Alert>
            <Typography sx={{ color: "#657085" }}>
              Interviewee: {deleteTarget?.intervieweeName || "Unknown"}
            </Typography>
            <Typography sx={{ color: "#657085" }}>
              Target email: {deleteTarget?.targetEmail || "Unknown"}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            color="inherit"
            disabled={deleting}
            onClick={() => setDeleteOpen(false)}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={handleDeleteInterview}
          >
            {deleting ? (
              <CircularProgress color="inherit" size={22} />
            ) : (
              "Delete interview"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
