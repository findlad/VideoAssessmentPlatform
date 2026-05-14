"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
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
  createDocument,
  deleteDocument,
  orderByField,
  queryDocuments,
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

const MAX_QUESTIONS = 5;
const senderEmail = process.env.NEXT_PUBLIC_EMAIL_FROM_ADDRESS;

const initialQuestions = [""];

function getInterviewLink(fileName) {
  const configuredOrigin = process.env.NEXT_PUBLIC_DEPLOYMENT_URL;
  const origin =
    configuredOrigin ||
    (typeof window !== "undefined" ? window.location.origin : "");

  return `${origin}/interview?fileName=${encodeURIComponent(fileName)}`;
}

export function NewInterviewRequestLanding() {
  const { auth, authLoading, user } = useFirebase();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedAnswers, setSelectedAnswers] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [interviews, setInterviews] = useState([]);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [questions, setQuestions] = useState(initialQuestions);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdFileId, setCreatedFileId] = useState("");

  const orderedQuestions = useMemo(
    () => questions.map((question) => question.trim()).filter(Boolean),
    [questions],
  );

  const canSubmit =
    Boolean(user) &&
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

  const loadInterviews = useCallback(async () => {
    if (!user) {
      setInterviews([]);
      return;
    }

    setDashboardLoading(true);

    try {
      const nextInterviews = await queryDocuments("questions", [
        whereEquals("createdBy", user.uid),
      ]);

      setInterviews(
        nextInterviews.sort(
          (first, second) =>
            (second.createdAt?.toMillis?.() || 0) -
            (first.createdAt?.toMillis?.() || 0),
        ),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load commissioned interviews.",
      );
    } finally {
      setDashboardLoading(false);
    }
  }, [user]);

  function updateQuestion(index, value) {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? value : question,
      ),
    );
  }

  function addQuestion() {
    setQuestions((current) =>
      current.length >= MAX_QUESTIONS ? current : [...current, ""],
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
    setTargetEmail("");
    setQuestions(initialQuestions);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setCreatedFileId("");

    try {
      const request = await createDocument("questions", {
        createdBy: user.uid,
        createdByEmail: user.email || "",
        targetEmail: targetEmail.trim(),
        questions: orderedQuestions,
        questionCount: orderedQuestions.length,
        responseCount: 0,
        status: "requested",
      });
      const fileName = request.id;
      const interviewLink = getInterviewLink(fileName);
      const mailRequest = {
        to: [targetEmail.trim()],
        metadata: {
          type: "interview-request",
          fileName,
          questionFileId: fileName,
          targetEmail: targetEmail.trim(),
          questionCount: orderedQuestions.length,
          interviewLink,
        },
        message: {
          subject: "Interview request",
          text: `Congratulations! You have received an interview request. Conduct Video Interview:\n\n${interviewLink}`,
          html: `<p>Congratulations! You have received an interview request.</p><p><a href="${interviewLink}">Conduct Video Interview</a></p>`,
        },
      };

      if (senderEmail) {
        mailRequest.from = senderEmail;
      }

      await createDocument("mail", mailRequest);

      setCreatedFileId(fileName);
      setDialogOpen(false);
      resetDialog();
      await loadInterviews();
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

  function openDeleteConfirmation(interview) {
    setDeleteTarget(interview);
    setDeleteOpen(true);
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
      await loadInterviews();
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
    const timer = window.setTimeout(() => {
      if (user) {
        loadInterviews();
      } else {
        setInterviews([]);
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadInterviews, user]);

  useEffect(() => {
    if (!createdFileId) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCreatedFileId("");
    }, 15000);

    return () => window.clearTimeout(timer);
  }, [createdFileId]);

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
                  onClick={() => setDialogOpen(true)}
                >
                  Set up a new interview
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={loadInterviews}
                  disabled={dashboardLoading}
                >
                  Refresh
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
                  overflow: "hidden",
                }}
              >
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
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
                          <TableCell colSpan={5}>
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
                          <TableCell colSpan={5}>
                            No interviews commissioned yet.
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {interviews.map((interview) => {
                        const responseCount = interview.responseCount || 0;
                        const responded =
                          interview.status === "responded" || responseCount > 0;

                        return (
                          <TableRow key={interview.id}>
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
                                <Tooltip title="Delete interview">
                                  <span>
                                    <IconButton
                                      aria-label={`Delete interview for ${interview.targetEmail}`}
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
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "flex-start" }}
                  >
                    <TextField
                      label={`Question ${index + 1}`}
                      value={question}
                      onChange={(event) =>
                        updateQuestion(index, event.target.value)
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
                ))}
                <Tooltip
                  title={
                    questions.length >= MAX_QUESTIONS
                      ? "Maximum of five questions"
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
        onClose={() => setReviewOpen(false)}
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
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewOpen(false)}>Close</Button>
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
