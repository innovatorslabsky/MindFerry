import { Model } from 'mongoose';
import librarySessionSchema, { ILibrarySession } from '~/schema/librarySession';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibrarySessionModel(
  mongoose: typeof import('mongoose'),
): Model<ILibrarySession> {
  applyTenantIsolation(librarySessionSchema);
  return (
    mongoose.models.LibrarySession ||
    mongoose.model<ILibrarySession>('LibrarySession', librarySessionSchema)
  );
}
