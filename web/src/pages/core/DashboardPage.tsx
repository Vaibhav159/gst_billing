import { RatesCard } from "@/core/rates/RatesCard";
import { useView } from "@/core/view";
import Dashboard from "./Dashboard";

/** 5C owns the board; the dashboard route supplies its desktop/Expert variant. */
export default function DashboardPage() {
  const { isPhone } = useView();
  return <Dashboard rates={<RatesCard variant={isPhone ? "strip" : "card"} />} />;
}
