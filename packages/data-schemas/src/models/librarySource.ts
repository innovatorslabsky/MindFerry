import { Model } from 'mongoose';
import librarySourceSchema, { ILibrarySource } from '~/schema/librarySource';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibrarySourceModel(
  mongoose: typeof import('mongoose'),
): Model<ILibrarySource> {
  applyTenantIsolation(librarySourceSchema);
  return (
    mongoose.models.LibrarySource ||
    mongoose.model<ILibrarySource>('LibrarySource', librarySourceSchema)
  );
}
