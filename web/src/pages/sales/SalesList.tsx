import Placeholder from "@/pages/core/Placeholder";
import { useView } from "@/core/view";
import { DesktopList } from "./list/DesktopList";
import { useListModel } from "./list/model";

/** /sales: the bills list. One model (the address and the server), drawn as a table on a desktop. */
export default function SalesList() {
  const { isPhone } = useView();
  const m = useListModel();
  // the phone's cards come in the next task; until then a phone keeps part 0's placeholder
  return isPhone ? <Placeholder area="Bills" part={1} /> : <DesktopList m={m} />;
}
