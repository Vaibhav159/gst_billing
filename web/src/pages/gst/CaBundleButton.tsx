import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { prepareCaBundle, recordCaBundle, type BundleInput } from "@/core/api/gstExports";
import { problemOf } from "@/core/api/errors";
import { monthOf, todayIST } from "@/core/format";
import { saveFile } from "@/core/print/files";
import { Button, FailNote } from "@/core/ui";

export function CaBundleButton({ input }: { input: BundleInput }) {
  const { can, whyNot, me } = useAuth(); const queryClient = useQueryClient();
  const [recordFailed, setRecordFailed] = useState(false); const [omitted, setOmitted] = useState(false);
  const scope = JSON.stringify(input);
  const generation = useRef(0);
  const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const allowed = can("gst.download"); const running = input.month >= monthOf(todayIST());
  const download = useMutation({
    mutationFn: async ({ at, value }: { at: number; value: BundleInput }) => {
      const made = await prepareCaBundle(value);
      if (!mounted.current || generation.current !== at) return;
      saveFile(made.blob, made.name); setOmitted(!made.parts.includes("gstr1"));
      try { await recordCaBundle(value, made.parts); }
      catch { if (mounted.current && generation.current === at) setRecordFailed(true); }
      finally { void queryClient.invalidateQueries({ queryKey: ["gst"] }); }
    }, retry: false, networkMode: "always",
  });
  const reset = download.reset;
  useEffect(() => { generation.current += 1; setRecordFailed(false); setOmitted(false); reset(); return () => { generation.current += 1; }; }, [scope, reset, allowed, me?.id]);
  const go = () => { if (!allowed || running || download.isPending) return; setRecordFailed(false); setOmitted(false); download.mutate({ at: generation.current, value: input }); };
  const problem = download.error ? problemOf(download.error) : null;
  return <div className="flex flex-col gap-2">
    <Button icon={Package} disabled={!allowed || running} loading={download.isPending} onClick={go}>CA bundle</Button>
    <p className="text-sm text-muted">The bundle is one zip: {input.includeGstr1 && !omitted ? "the portal file, the GSTR-3B file" : "the GSTR-3B file"}, and the month's CA Excel{input.split ? ", with the cash/bank split" : ""}.{!input.includeGstr1 || omitted ? " The portal file joins once the checks pass." : ""}</p>
    {!allowed ? <p className="text-sm text-muted">{whyNot("gst.download")}</p> : running ? <p className="text-sm text-muted">The month must be over before its files can be made.</p> : null}
    <FailNote error={problem ? { title: problem.kind === "offline" ? "You're offline, so the file wasn't made" : "The file couldn't be made", body: problem.kind === "offline" ? "Nothing is lost. Try again when the internet is back." : problem.kind === "server" ? "Something went wrong while making it. Nothing is lost; try again in a minute." : problem.message } : null} onRetry={go} busy={download.isPending} />
    {recordFailed ? <p role="alert" className="text-sm text-neg">The bundle downloaded, but its record couldn't be saved.</p> : null}
  </div>;
}
