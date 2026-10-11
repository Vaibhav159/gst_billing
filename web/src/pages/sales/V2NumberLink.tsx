import { useParams } from "react-router";
import { BillByNumber } from "./bill/BillByNumber";

/** v2's /billing/invoice/{firm slug}/{FY}/{number} (v2 App.tsx:138-143): the bill with that number, firm and year. */
export default function V2NumberLink() {
  const { bizSlug = "", fy = "", slug = "" } = useParams();
  return <BillByNumber number={slug} firmSlug={bizSlug} fy={fy} />;
}
