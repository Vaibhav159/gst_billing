import { useFirms } from '@/core/scope';
import { BusyText, LoadError } from '@/core/ui';
import PhotoImport from './PhotoImport';
import PhotoEditor from './PhotoEditor';

export default function PhotoPage() {
  const { firms, loading, problem } = useFirms();
  if (loading) return <BusyText>Loading firms…</BusyText>;
  if (problem) return <LoadError problem={problem} what="firms" />;
  return <PhotoImport firms={firms} Editor={PhotoEditor} />;
}
