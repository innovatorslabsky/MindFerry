import { Model } from 'mongoose';
import libraryProgressSchema, { ILibraryProgress } from '~/schema/libraryProgress';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryProgressModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryProgress> {
  applyTenantIsolation(libraryProgressSchema);
  return (
    mongoose.models.LibraryProgress ||
    mongoose.model<ILibraryProgress>('LibraryProgress', libraryProgressSchema)
  );
}
