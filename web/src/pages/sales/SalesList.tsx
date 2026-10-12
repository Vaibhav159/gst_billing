import { useView } from "@/core/view";
import { DesktopList } from "./list/DesktopList";
import { useListModel } from "./list/model";
import { PhoneList } from "./list/PhoneList";

/** /sales: the bills list. One model (the address and the server), drawn as a table on a desktop and as cards on a phone. */
export default function SalesList() {
  const { isPhone } = useView();
  const m = useListModel();
  return isPhone ? <PhoneList m={m} /> : <DesktopList m={m} />;
}
