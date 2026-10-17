import { Model } from 'mongoose';
import libraryResourceSchema, { ILibraryResource } from '~/schema/libraryResource';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryResourceModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryResource> {
  applyTenantIsolation(libraryResourceSchema);
  return (
    mongoose.models.LibraryResource ||
    mongoose.model<ILibraryResource>('LibraryResource', libraryResourceSchema)
  );
}
