export interface BundleFile { name: string; blob: Blob }
export interface CaBundleInput { short: string; month: string; gstr1?: BundleFile; gstr3b: BundleFile; excel: BundleFile }
export type BundlePart = "gstr1" | "gstr3b" | "excel";

/** Takes files already fetched by the authenticated API client; never invents portal JSON or makes requests. */
export async function caBundle(input: CaBundleInput): Promise<{ name: string; blob: Blob; parts: BundlePart[] }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new Error("Pick a month in YYYY-MM form.");
  const files = [input.gstr1, input.gstr3b, input.excel].filter((file): file is BundleFile => !!file);
  if (files.some(file => !file.name || /[\\/\u0000-\u001f]/.test(file.name) || file.name === "." || file.name === "..")) throw new Error("The file name must not contain a path.");
  if (new Set(files.map(file => file.name.toLowerCase())).size !== files.length) throw new Error("The files need different names.");
  const { zipFiles } = await import("@/core/files/zip");
  const short = input.short.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Firm";
  const [year, month] = input.month.split("-");
  return { name: `GST_${short}_${month}${year}_for_CA.zip`, blob: await zipFiles(files), parts: [...(input.gstr1 ? ["gstr1" as const] : []), "gstr3b", "excel"] };
}
