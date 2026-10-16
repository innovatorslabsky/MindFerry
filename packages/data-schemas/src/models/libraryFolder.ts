import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryFolderSchema, { ILibraryFolder } from '~/schema/libraryFolder';

export function createLibraryFolderModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryFolder> {
  applyTenantIsolation(libraryFolderSchema);
  return (
    mongoose.models.LibraryFolder ||
    mongoose.model<ILibraryFolder>('LibraryFolder', libraryFolderSchema)
  );
}
