import EditPage from "@/components/EditPage/EditPage";
import StartPage from "@/components/StartPage/StartPage";
import { readStoredGenerationRecord } from "@/lib/generationRecord";

type PageProps = {
  params: Promise<{
    generation: string;
  }>;
};

const GENERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const Page = async ({ params }: PageProps) => {
  const { generation } = await params;
  const slug = decodeURIComponent(generation || "").trim();

  if (GENERATION_ID_PATTERN.test(slug)) {
    const generationRecord = await readStoredGenerationRecord(slug);
    if (generationRecord && typeof generationRecord === "object") {
      return <EditPage />;
    }
  }

  return <StartPage initialNewsroom={slug} />;
};

export default Page;

export const dynamic = "force-dynamic";
