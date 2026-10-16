import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryResourceSchema, { ILibraryResource } from '~/schema/libraryResource';

export function createLibraryResourceModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryResource> {
  applyTenantIsolation(libraryResourceSchema);
  return (
    mongoose.models.LibraryResource ||
    mongoose.model<ILibraryResource>('LibraryResource', libraryResourceSchema)
  );
}
