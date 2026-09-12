export const RIGHT_AUX_KEYS = ['inspirationOpen', 'referenceOpen', 'namegenOpen'] as const;
export type RightAuxKey = typeof RIGHT_AUX_KEYS[number];

export function applyRightAuxExclusive<T extends Record<RightAuxKey, boolean>>(
  state: T,
  key: RightAuxKey,
  nextOpen: boolean,
): T {
  if (!nextOpen) return { ...state, [key]: false };
  return {
    ...state,
    inspirationOpen: key === 'inspirationOpen',
    referenceOpen: key === 'referenceOpen',
    namegenOpen: key === 'namegenOpen',
  };
}

export function toggleRightAux<T extends Record<RightAuxKey, boolean>>(
  state: T,
  key: RightAuxKey,
): T {
  return applyRightAuxExclusive(state, key, !state[key]);
}
