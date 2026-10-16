import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import librarySourceSchema, { ILibrarySource } from '~/schema/librarySource';

export function createLibrarySourceModel(
  mongoose: typeof import('mongoose'),
): Model<ILibrarySource> {
  applyTenantIsolation(librarySourceSchema);
  return (
    mongoose.models.LibrarySource ||
    mongoose.model<ILibrarySource>('LibrarySource', librarySourceSchema)
  );
}
