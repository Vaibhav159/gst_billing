import { useRef } from "react";
import { useNavigate } from "react-router";
import { Moon, Sun } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { useNetwork } from "@/core/api/network";
import { useDueNext } from "@/core/api/dashboard";
import { useTheme, type Theme } from "@/core/device";
import { dateLong, todayIST } from "@/core/format";
import { RatesCard } from "@/core/rates/RatesCard";
import { Button, ButtonLink, IconButton, ListSkeleton, LoadError } from "@/core/ui";
import { EasyPage, BillRows, NewBillButton } from "./parts";
import { useEasyFirm, useWelcome } from "./state";
import { fetchEasyUnsent, useEasyToday, useEasyUnfinishedBills } from "./queries";
import { HomeBody } from "./HomeBody";

export default function Home() {
  const selection = useEasyFirm();
  const { firmId, firm } = selection;
  const net = useNetwork();
  const welcome = useWelcome();
  const { can } = useAuth();
  const sales = useEasyToday(firmId);
  const drafts = useEasyUnfinishedBills(can("bill.create") ? firmId : null, true);
  // 5B reuses an active or newer fresh rich answer itself; Easy asks only for the counts.
  const due = useDueNext(firmId);
  const today = todayIST();
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const dark = useRef<Theme>(theme === "pearl" ? "obsidian" : theme);
  const sunlight = () => { if (theme === "pearl") setTheme(dark.current); else { dark.current = theme; setTheme("pearl"); } };
  return <EasyPage title={firm?.name ?? "Choose a firm"} subtitle={dateLong(today)} docTitle="Easy mode · Home"
    actions={<><IconButton label={theme === "pearl" ? "Dark screen" : "Bright screen for sunlight"} icon={theme === "pearl" ? Moon : Sun} onClick={sunlight} />
      <Button variant="secondary" onClick={() => navigate("/", { state: { fullView: true } })} title="Every screen: purchases, GST returns, reports">Full view</Button></>}
    bar={<NewBillButton />}>
    {firmId === null ? <>
      {selection.loading ? <ListSkeleton rows={4} what="the firm for this phone" /> : selection.error
        ? <LoadError what="the firm for this phone" problem={selection.problem ?? { kind: net === "offline" ? "offline" : "server", message: "The firm for this phone couldn't load." }} />
        : <p className="text-md text-muted">Choose the firm this phone bills for in More.</p>}
      <ButtonLink to="/e/more" variant="primary" size="lg">Go to More</ButtonLink>
    </> : <HomeBody sales={sales} key={firmId ?? "waiting"} firmId={firmId} today={today} welcome={welcome} drafts={drafts} due={due} fetchUnsent={fetchEasyUnsent}
      rates={<RatesCard variant="easy" />} renderRows={(bills) => <BillRows bills={bills} />} />}
  </EasyPage>;
}
