import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/core/auth/AuthProvider";
import { firmListQuery } from "@/core/api/firms";
import { shopSettingsQuery } from "@/core/api/sales";
import { MoreBody } from "./MoreBody";
import { EasyPage } from "./parts";
import { useEasyFirm, useWelcome } from "./state";

export default function More() {
  const { me } = useAuth();
  const { firm, firms, setFirm, loading, error } = useEasyFirm();
  const welcome = useWelcome();
  const qc = useQueryClient();
  // 4C's useFirms already observes this exact narrow cache: no second request or full firm-detail read.
  const rows = useQuery(firmListQuery());
  const retry = () => { void Promise.all([
    rows.refetch(),
    qc.invalidateQueries({ queryKey: shopSettingsQuery.queryKey, exact: true }),
    qc.invalidateQueries({ queryKey: ["prefs", me?.id], exact: true }),
  ]); };
  const choices = firms.map((f) => {
    const row = rows.data?.find((r) => r.id === f.id);
    return { ...f, location: row ? [row.city, row.state_name].filter(Boolean).join(", ") : f.state };
  });
  return <EasyPage title="More" subtitle={`${me?.fullName || "Signed in"} · ${me?.roleLabel || ""}`} docTitle="Easy mode · More">
    <MoreBody key={me?.id} firm={firm} firms={choices} setFirm={setFirm} resetWelcome={welcome.reset}
      loading={loading || rows.isFetching} error={error || rows.isError ? "Couldn't load the firms. Try again." : undefined} onRetry={retry} />
  </EasyPage>;
}
