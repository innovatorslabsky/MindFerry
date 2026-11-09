import { Navigate } from 'react-router-dom';
import { Spinner } from '@librechat/client';
import { SystemRoles } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

/** The page exists only where the operator turned the bridge on, and only an admin may see it. */
export default function BridgeGate({ children }: { children: ReactNode }) {
  const { data: startupConfig, isLoading } = useGetStartupConfig();
  const { user } = useAuthContext();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (startupConfig?.agentBridgeEnabled !== true || user?.role !== SystemRoles.ADMIN) {
    return <Navigate to="/c/new" replace />;
  }
  return <>{children}</>;
}
