import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/core/auth/AuthProvider';
import { captureKeys, getCapture, readCapture, uploadCapture } from '@/core/api/captures';
import { invalidateDashboard } from '@/core/due/fresh';
import { createCaptureQueue } from './queue';
import { IndexedDbCaptureStore } from './store';

const queues = new WeakMap<QueryClient, ReturnType<typeof createCaptureQueue>>();
function queueFor(client: QueryClient) {
  let queue = queues.get(client);
  if (!queue) {
    queue = createCaptureQueue(new IndexedDbCaptureStore(), {
      upload: async (item, signal) => {
        const capture = await uploadCapture({ client_id: item.clientId, files: item.files, business_id: item.businessId, hint: item.hint, note: item.note }, signal, item.userId);
        invalidateDashboard(client);
        return capture;
      },
      read: async (id, signal, owner) => {
        const capture = await getCapture(id, signal, owner);
        if (capture.read || capture.status !== 'reading') return capture;
        const answer = await readCapture(id, signal, owner);
        invalidateDashboard(client);
        return answer;
      },
      changed: (id) => {
        void client.invalidateQueries({ queryKey: ['captures', 'list'] });
        if (id !== null) void client.invalidateQueries({ queryKey: captureKeys.one(id) });
        void client.invalidateQueries({ queryKey: ['ai-reads'] });
      },
    });
    queues.set(client, queue);
  }
  return queue;
}
/** One queue per signed-in app. CaptureUploadHost keeps identity and retry events current between pages. */
export function useUploads() {
  const client = useQueryClient();
  const { me, can, status } = useAuth();
  const queue = queueFor(client);
  const userId = status === 'signed-in' && can('capture') ? me?.id ?? null : null;
  useEffect(() => { void queue.setUser(userId); }, [queue, userId]);
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return { ...snapshot, add: queue.add, retry: queue.resume, remove: queue.remove };
}
/** Mount once inside AppLayout so switching accounts stops pending work even away from Capture. */
export function CaptureUploadHost() {
  const client = useQueryClient();
  const queue = queueFor(client);
  useUploads();
  useEffect(() => queue.start(), [queue]);
  useEffect(() => () => { void queue.setUser(null); }, [queue]);
  return null;
}
