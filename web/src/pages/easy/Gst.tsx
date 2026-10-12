import { useState } from "react";
import { useNavigate } from "react-router";
import { useView } from "@/core/view";
import { Send } from "lucide-react";
import { Button, ListSkeleton, QueryView, useToast } from "@/core/ui";
import { useEasyGst } from "./gst-queries";
import { useEasyFirm } from "./state";
import { EasyPage } from "./parts";
import { easyGst, gstShareText, shareGst } from "./gst";
import { GstContent, GstCardContent } from "./GstContent";

export default function Gst() {
  const { firmId, firm, loading, error } = useEasyFirm();
  const { previous, current, today, month } = useEasyGst(firmId);
  const navigate = useNavigate();
  const { isPhone } = useView();
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const ready = previous.isSuccess && current.isSuccess && !!firm;
  async function share() {
    if (!ready || sharing || !previous.data || !current.data || !firm) return;
    setSharing(true);
    try {
      const result = await shareGst(gstShareText(firm.name, easyGst(previous.data), { month, tax: current.data.summary.tax, bills: current.data.summary.bills }), {
        share: isPhone ? navigator.share?.bind(navigator) : undefined, open: (url, target) => window.open(url, target),
      });
      if (result === "shared") toast.show({ title: "Figures shared with your CA", tone: "brand" });
    } catch (error) { toast.show({ title: "Figures weren't shared", body: error instanceof Error ? error.message : "The share sheet couldn't open. Try again.", tone: "neg" }); }
    finally { setSharing(false); }
  }
  if (firmId === null) return <EasyPage back title="GST" docTitle="Easy mode · GST">
    {loading && !error ? <ListSkeleton what="the firms" /> : <p role={error ? "alert" : undefined}>{error ? "The firms couldn't load. Try again when the internet is back." : "No firm to bill from yet. The owner adds firms in Records."}</p>}
  </EasyPage>;
  return <EasyPage back title="GST" subtitle={firm?.name ?? ""} docTitle="Easy mode · GST"
    bar={ready ? <Button variant="primary" size="xl" icon={Send} full loading={sharing} onClick={() => void share()}>Share these figures with your CA</Button> : null}>
    <QueryView query={current} what="this month's GST">{(sales) =>
      <QueryView query={previous} what="last month's return">{(row) =>
        <GstContent firmName={firm?.name ?? ""} today={today}
          current={{ month, tax: sales.summary.tax, bills: sales.summary.bills }} previous={easyGst(row)}
          onVisit={(path) => navigate(path, { state: { fullView: true } })} />
      }</QueryView>
    }</QueryView>
  </EasyPage>;
}

export function GstCard() {
  const { firmId, firm, loading, error } = useEasyFirm();
  const { previous, current, today, month } = useEasyGst(firmId);
  if (firmId === null) return loading && !error ? <ListSkeleton what="the firms" /> : <p role={error ? "alert" : undefined}>{error ? "The firms couldn't load. Try again when the internet is back." : "No firm to bill from yet. The owner adds firms in Records."}</p>;
  return <QueryView query={current} what="this month's GST">{(sales) =>
    <QueryView query={previous} what="last month's return">{(row) =>
      <GstCardContent firmName={firm?.name ?? ""} today={today}
        current={{ month, tax: sales.summary.tax, bills: sales.summary.bills }} previous={easyGst(row)} />
    }</QueryView>
  }</QueryView>;
}
