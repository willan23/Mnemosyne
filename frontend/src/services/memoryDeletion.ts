import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const markMemoryDeleted = async (
  memoryId: string,
  deletedByDeviceId = 'desktop'
): Promise<void> => {
  await updateDoc(doc(db, 'sessions', memoryId), {
    deletedAt: Date.now(),
    deletedByDeviceId,
    updatedAt: Date.now(),
  });
};
