"use client";

import { useMemo, useState } from "react";
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
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { createDocument } from "@/lib/firebase/firestore";

const MAX_QUESTIONS = 5;

const emptyQuestions = Array.from({ length: MAX_QUESTIONS }, () => "");

function getInterviewLink(fileName) {
  const configuredOrigin = process.env.NEXT_PUBLIC_DEPLOYMENT_URL;
  const origin =
    configuredOrigin ||
    (typeof window !== "undefined" ? window.location.origin : "");

  return `${origin}/interview?fileName=${encodeURIComponent(fileName)}`;
}

export function NewInterviewLanding() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [questions, setQuestions] = useState(emptyQuestions);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdFileId, setCreatedFileId] = useState("");

  const orderedQuestions = useMemo(
    () => questions.map((question) => question.trim()).filter(Boolean),
    [questions]
  );

  const canSubmit =
    targetEmail.trim().length > 0 && orderedQuestions.length > 0 && !submitting;

  function updateQuestion(index, value) {
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? value : question
      )
    );
  }

  function resetDialog() {
    setTargetEmail("");
    setQuestions(emptyQuestions);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setCreatedFileId("");

    try {
      const request = await createDocument("questions", {
        targetEmail: targetEmail.trim(),
        questions: orderedQuestions,
        questionCount: orderedQuestions.length,
        status: "requested"
      });
      const fileName = request.id;
      const interviewLink = getInterviewLink(fileName);

      await createDocument("mail", {
        to: [targetEmail.trim()],
        metadata: {
          type: "interview-request",
          fileName,
          questionFileId: fileName,
          targetEmail: targetEmail.trim(),
          questionCount: orderedQuestions.length,
          interviewLink
        },
        message: {
          subject: "Interview request",
          text: `Congratulations! You have received an interview request, please click the link below to proceed.\n\n${interviewLink}`,
          html: `<p>Congratulations! You have received an interview request, please click the link below to proceed.</p><p><a href="${interviewLink}">${interviewLink}</a></p>`
        }
      });

      setCreatedFileId(fileName);
      setDialogOpen(false);
      resetDialog();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to create the interview request."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        bgcolor: "#f4f7fb",
        color: "#172033",
        display: "flex",
        alignItems: "center",
        py: { xs: 6, md: 10 }
      }}
    >
      <Container maxWidth="md">
        <Stack spacing={4} sx={{ maxWidth: 760 }}>
          <Stack spacing={2}>
            <Typography
              component="p"
              sx={{
                color: "#1665d8",
                fontSize: "0.78rem",
                fontWeight: 700,
                textTransform: "uppercase"
              }}
            >
              Video Assessment Platform
            </Typography>
            <Typography
              component="h1"
              sx={{
                fontSize: { xs: "2.4rem", md: "4rem" },
                fontWeight: 800,
                lineHeight: 1,
                maxWidth: 700
              }}
            >
              Welcome to the delightful video interview platform
            </Typography>
            <Typography sx={{ color: "#657085", fontSize: "1.08rem" }}>
              Create a focused interview request, send it to a candidate, and
              route them straight to the interview page.
            </Typography>
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Button
              size="large"
              variant="contained"
              onClick={() => setDialogOpen(true)}
              sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
            >
              Set up a new interview
            </Button>
          </Stack>

          {createdFileId ? (
            <Alert severity="success">
              Interview request created. File id: {createdFileId}
            </Alert>
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
                required
                fullWidth
              />
              <Stack spacing={2}>
                {questions.map((question, index) => (
                  <TextField
                    key={index}
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
                ))}
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
    </Box>
  );
}
