import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { configRoot } from "@/lib/projectFiles";

const brandConfigSchema = z.object({
  brand_name: z.string().min(1).optional(),
  openai: z
    .object({
      manuscriptModel: z.string().optional(),
    })
    .optional(),
  prompts: z
    .object({
      scriptPrompt: z.string().optional(),
      scriptPromptOptions: z
        .array(
          z.object({
            id: z.string().min(1),
            label: z.string().min(1),
            prompt: z.string().min(1),
            description: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

export type BrandPromptOption = {
  id: string;
  label: string;
  prompt: string;
  description?: string;
};

export type BrandOption = {
  id: string;
  brandName: string;
  scriptPrompt: string;
  manuscriptModel?: string;
  promptOptions: BrandPromptOption[];
};

function isSafeBrandId(brandId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(brandId);
}

export async function listBrands(): Promise<BrandOption[]> {
  const brandsDir = configRoot();
  const entries = await readdir(brandsDir, { withFileTypes: true });

  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name);

  const brands: BrandOption[] = [];
  for (const fileName of jsonFiles) {
    const id = fileName.replace(/\.json$/i, "");
    if (!isSafeBrandId(id)) {
      continue;
    }
    try {
      const raw = await readFile(join(brandsDir, fileName), "utf-8");
      const parsed = brandConfigSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        continue;
      }
      brands.push({
        id,
        brandName: parsed.data.brand_name || id,
        scriptPrompt: parsed.data.prompts?.scriptPrompt || "",
        manuscriptModel: parsed.data.openai?.manuscriptModel || undefined,
        promptOptions: parsed.data.prompts?.scriptPromptOptions || [],
      });
    } catch {
      continue;
    }
  }

  return brands;
}
