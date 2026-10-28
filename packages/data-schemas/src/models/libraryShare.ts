import { Model } from 'mongoose';
import libraryShareSchema, { ILibraryShare } from '~/schema/libraryShare';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryShareModel(mongoose: typeof import('mongoose')): Model<ILibraryShare> {
  applyTenantIsolation(libraryShareSchema);
  return (
    mongoose.models.LibraryShare ||
    mongoose.model<ILibraryShare>('LibraryShare', libraryShareSchema)
  );
}
