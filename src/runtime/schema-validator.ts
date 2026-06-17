import { z } from "zod";

const HtmlOutputSchema = z
  .string()
  .min(1)
  .refine((s) => s.includes("<") && s.includes(">"), { message: "Output deve conter HTML válido" });

const TweaksConfigSchema = z.object({
  controls: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      type: z.enum(["slider", "toggle", "color", "segmented", "select"]),
      value: z.union([z.string(), z.number(), z.boolean()]),
      options: z.array(z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
      cssVar: z.string().optional(),
    }),
  ),
});

export type TweaksConfig = z.infer<typeof TweaksConfigSchema>;

export function validateHtml(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const result = HtmlOutputSchema.safeParse(raw.trim());
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "Validação falhou" };
}

export function validateTweaks(
  raw: string,
): { ok: true; value: TweaksConfig } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    const result = TweaksConfigSchema.safeParse(parsed);
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, error: result.error.issues[0]?.message ?? "Schema inválido" };
  } catch {
    return { ok: false, error: "JSON inválido" };
  }
}

export function extractHtmlFromOutput(raw: string): string {
  // Strip markdown fences if present
  const fenceMatch = raw.match(/```(?:html)?\s*([\s\S]+?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // If starts with doctype or html tag, use as-is
  const trimmed = raw.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<")) {
    return trimmed;
  }

  // LLMs sometimes prepend prose ("Here's the polished version:\n\n<!DOCTYPE…")
  // despite the system prompt saying "code only". Salvage by scanning for the
  // first <!DOCTYPE / <html / <svg and slicing from there. Without this, the
  // output never passes looksLikeHtmlOutput and the iframe silently stays
  // unchanged — the "verb didn't apply" bug.
  const docMatch = trimmed.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*$/i);
  if (docMatch) return docMatch[0];
  const htmlMatch = trimmed.match(/<html\b[\s\S]*?<\/html>\s*$/i);
  if (htmlMatch) return htmlMatch[0];
  const svgMatch = trimmed.match(/<svg\b[\s\S]*?<\/svg>\s*$/i);
  if (svgMatch) return svgMatch[0];

  return raw;
}
