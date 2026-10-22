import { createContext, useContext } from 'react';
import type { MeResponse } from '@va/shared';

export interface MeContextValue {
  me: MeResponse;
  reloadMe: () => void;
}

export const MeContext = createContext<MeContextValue | null>(null);

export function useMe(): MeContextValue {
  const v = useContext(MeContext);
  if (!v) throw new Error('useMe must be used inside the app shell');
  return v;
}
