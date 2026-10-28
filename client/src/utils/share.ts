import { apiBaseUrl } from 'librechat-data-provider';

export const buildShareLinkUrl = (shareId: string): string => {
  const baseURL = apiBaseUrl();
  return new URL(`${baseURL}/share/${shareId}`, window.location.origin).toString();
};

/** The address anyone can open to read a document its owner shared. */
export const buildLibraryShareUrl = (token: string): string => {
  const baseURL = apiBaseUrl();
  return new URL(`${baseURL}/share/library/${token}`, window.location.origin).toString();
};
