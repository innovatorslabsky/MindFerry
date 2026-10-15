import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryProgressSchema, { ILibraryProgress } from '~/schema/libraryProgress';

export function createLibraryProgressModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryProgress> {
  applyTenantIsolation(libraryProgressSchema);
  return (
    mongoose.models.LibraryProgress ||
    mongoose.model<ILibraryProgress>('LibraryProgress', libraryProgressSchema)
  );
}
