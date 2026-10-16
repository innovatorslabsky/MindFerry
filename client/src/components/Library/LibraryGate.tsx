import { Navigate } from 'react-router-dom';
import { Spinner } from '@librechat/client';
import type { ReactNode } from 'react';
import { useGetStartupConfig } from '~/data-provider';

/** The library pages exist only where the operator turned the library on; elsewhere they lead home. */
export default function LibraryGate({ children }: { children: ReactNode }) {
  const { data: startupConfig, isLoading } = useGetStartupConfig();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (startupConfig?.libraryEnabled !== true) {
    return <Navigate to="/c/new" replace />;
  }
  return <>{children}</>;
}
