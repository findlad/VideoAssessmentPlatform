"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Container, Typography } from "@mui/material";
import { InterviewQuestions } from "@/components/InterviewQuestions";

function isUnsupportedAssessmentDevice() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent || "";
  const mobileUserAgent =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent,
    );
  const coarsePointer =
    window.matchMedia?.("(pointer: coarse)")?.matches || false;
  const noHover = window.matchMedia?.("(hover: none)")?.matches || false;
  const touchCapable =
    navigator.maxTouchPoints > 1 || "ontouchstart" in window;
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) < 820;

  return (
    mobileUserAgent ||
    (touchCapable && coarsePointer && noHover) ||
    (touchCapable && smallViewport)
  );
}

export function InterviewPageContent({ fileName, token }) {
  const [completed, setCompleted] = useState(false);
  const [interviewTitle, setInterviewTitle] = useState("");
  const [unsupportedDevice, setUnsupportedDevice] = useState(false);
  const handleCompletedChange = useCallback((nextCompleted) => {
    setCompleted(nextCompleted);
  }, []);
  const handleRequestLoaded = useCallback((request) => {
    setInterviewTitle(request?.interviewTitle || "");
  }, []);

  useEffect(() => {
    function checkDevice() {
      setUnsupportedDevice(isUnsupportedAssessmentDevice());
    }

    checkDevice();
    window.addEventListener("resize", checkDevice);

    return () => window.removeEventListener("resize", checkDevice);
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
        {interviewTitle ? (
          <Typography
            component="p"
            sx={{ color: "#657085", fontSize: "1.1rem", fontWeight: 700 }}
          >
            {interviewTitle}
          </Typography>
        ) : null}
        <Typography component="h1" sx={{ fontSize: "2.5rem", mb: 2 }}>
          {completed
            ? "Thank you. Your interview has been submitted!"
            : "Your interview request is ready."}
        </Typography>
        <Typography sx={{ color: "#657085", overflowWrap: "anywhere" }}>
          {completed
            ? "Your answers have been uploaded and shared with the interviewer."
            : ""}
        </Typography>
        <Box sx={{ mt: 4 }}>
          {unsupportedDevice ? (
            <Alert severity="warning">
              This video assessment must be completed on a laptop or desktop
              computer. Phones and tablets are not supported because the
              assessment requires a stable camera, microphone, and browser
              recording setup.
            </Alert>
          ) : (
            <InterviewQuestions
              fileName={fileName}
              token={token}
              onCompletedChange={handleCompletedChange}
              onRequestLoaded={handleRequestLoaded}
            />
          )}
        </Box>
      </Container>
    </Box>
  );
}
