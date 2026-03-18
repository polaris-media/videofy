import EditPage from "@/components/EditPage/EditPage";
import StartPage from "@/components/StartPage/StartPage";
import { cmsGenerationPath, readJson } from "@/lib/projectFiles";
import { getProjectStorage } from "@/lib/projectStorage";

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
    const generationFile = cmsGenerationPath(slug);
    if (await getProjectStorage().fileExists(generationFile)) {
      const generationRecord = await readJson<Record<string, unknown> | null>(
        generationFile,
        null
      );
      if (generationRecord && typeof generationRecord === "object") {
        return <EditPage />;
      }
    }
  }

  return <StartPage initialNewsroom={slug} />;
};

export default Page;

export const dynamic = "force-dynamic";
