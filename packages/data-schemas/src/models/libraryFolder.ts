import { Model } from 'mongoose';
import libraryFolderSchema, { ILibraryFolder } from '~/schema/libraryFolder';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryFolderModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryFolder> {
  applyTenantIsolation(libraryFolderSchema);
  return (
    mongoose.models.LibraryFolder ||
    mongoose.model<ILibraryFolder>('LibraryFolder', libraryFolderSchema)
  );
}
