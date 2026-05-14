"use client";

import { useCallback, useState } from "react";
import { Box, Container, Typography } from "@mui/material";
import { InterviewQuestions } from "@/components/InterviewQuestions";

export function InterviewPageContent({ fileName }) {
  const [completed, setCompleted] = useState(false);
  const handleCompletedChange = useCallback((nextCompleted) => {
    setCompleted(nextCompleted);
  }, []);

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        bgcolor: "#f4f7fb",
        color: "#172033",
        display: "flex",
        alignItems: "center",
        py: 8,
      }}
    >
      <Container maxWidth="sm">
        <Typography component="p" sx={{ color: "#1665d8", fontWeight: 700 }}>
          Interview
        </Typography>
        <Typography component="h1" sx={{ fontSize: "2.5rem", mb: 2 }}>
          {completed
            ? "Thank you. Your interview has been submitted. Please wait to hear back from who requested your input."
            : "Your interview request is ready."}
        </Typography>
        <Typography sx={{ color: "#657085", overflowWrap: "anywhere" }}>
          {completed
            ? "Your answers have been uploaded and shared with the interviewer."
            : `File name: ${fileName || "Missing"}`}
        </Typography>
        <Box sx={{ mt: 4 }}>
          <InterviewQuestions
            fileName={fileName}
            onCompletedChange={handleCompletedChange}
          />
        </Box>
      </Container>
    </Box>
  );
}
