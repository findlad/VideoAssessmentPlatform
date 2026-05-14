import { InterviewPageContent } from "@/components/InterviewPageContent";

export default async function InterviewPage({ searchParams }) {
  const params = await searchParams;
  const fileName = params?.fileName || "";

  return <InterviewPageContent fileName={fileName} />;
}
