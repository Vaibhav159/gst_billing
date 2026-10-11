import { GitMerge } from "lucide-react";
import { useCustomerDuplicates } from "@/core/api/customerMerge";
import { useNetwork } from "@/core/api/network";
import { useAuth } from "@/core/auth/AuthProvider";
import { Banner, ButtonLink, QueryView } from "@/core/ui";

export function CustomerDuplicates() {
  const groups = useCustomerDuplicates();
  const { can } = useAuth();
  const network = useNetwork();
  if (groups.isPending || network === "offline") return null;
  return <QueryView query={groups} what="duplicate customers">{all => {
    const g = all[0];
    if (!g || g.customers.length < 2) return null;
    const [target, source] = g.customers;
    return <Banner tone="brand" icon={GitMerge} title={`${g.customers.map(c => c.name).join(" and ")} share the ${g.what === "gstin" ? "GSTIN" : "phone"} ${g.value}`}
      actions={<ButtonLink size="sm" to={`/customers/${source.id}${can("customer.merge") ? `?merge=${target.id}` : ""}`}>{can("customer.merge") ? "Review and merge" : "Open"}</ButtonLink>}>
      Usually that's one buyer entered twice. Merging moves the bills to one record.{all.length > 1 ? ` ${all.length - 1} more ${all.length === 2 ? "pair" : "pairs"} like this.` : ""}
    </Banner>;
  }}</QueryView>;
}
