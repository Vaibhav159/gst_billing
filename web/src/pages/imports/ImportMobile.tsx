import { FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { Page, Card, ButtonLink } from '@/core/ui';
/** Both import doors use the prototype's phone handoff. */
export function ImportMobile() {
  const { can } = useAuth();
  return <Page title="Import" phoneSubtitle="Done on the computer" back="/more"><Card><div className="flex flex-col items-center text-center gap-2 px-2 py-6"><span aria-hidden="true" className="w-12 h-12 rounded-card bg-raised border border-line grid place-items-center text-fg2 mb-1"><FileSpreadsheet size={22} /></span><p className="text-md font-semibold">Imports are done on the computer</p><p className="text-fg2 max-w-[40ch]">Checking many bills or rows needs a wide table. Open the app on the desk computer: Purchases › Import.{can('capture') ? " On the phone, capture each supplier's bill instead." : ''}</p><div className="flex flex-col gap-2 w-full mt-3">{can('capture') ? <ButtonLink to="/capture" variant="primary" full>Capture a bill</ButtonLink> : null}<ButtonLink to="/purchases" full>Purchases</ButtonLink></div></div></Card></Page>;
}
