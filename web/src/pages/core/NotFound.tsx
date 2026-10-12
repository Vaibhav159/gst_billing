import { Compass } from "lucide-react";
import { ButtonLink, EmptyState, Page } from "@/core/ui";

export default function NotFound() {
  return (
    <Page title="This page isn't here">
      <EmptyState icon={Compass} title="This page isn't here" actions={<ButtonLink to="/" variant="primary">Go to the home page</ButtonLink>}>
        The link may be old, or the page was moved in the new app.
      </EmptyState>
    </Page>
  );
}
