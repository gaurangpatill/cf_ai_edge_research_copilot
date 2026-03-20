import { ResearchWorkspace } from "@/components/workspace/research-workspace";

export default async function ChatWorkspacePage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ResearchWorkspace sessionId={sessionId} />;
}
