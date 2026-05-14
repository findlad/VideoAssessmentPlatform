import { Box, Container, Typography } from "@mui/material";

export default async function InterviewPage({ searchParams }) {
  const params = await searchParams;
  const fileName = params?.fileName || "";

  return (
    <Box
      component="main"
      sx={{
        minHeight: "100vh",
        bgcolor: "#f4f7fb",
        color: "#172033",
        display: "flex",
        alignItems: "center",
        py: 8
      }}
    >
      <Container maxWidth="sm">
        <Typography component="p" sx={{ color: "#1665d8", fontWeight: 700 }}>
          Interview
        </Typography>
        <Typography component="h1" sx={{ fontSize: "2.5rem", mb: 2 }}>
          Your interview request is ready.
        </Typography>
        <Typography sx={{ color: "#657085", overflowWrap: "anywhere" }}>
          File name: {fileName || "Missing"}
        </Typography>
      </Container>
    </Box>
  );
}
