import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryViewSchema, { ILibraryView } from '~/schema/libraryView';

export function createLibraryViewModel(mongoose: typeof import('mongoose')): Model<ILibraryView> {
  applyTenantIsolation(libraryViewSchema);
  return (
    mongoose.models.LibraryView || mongoose.model<ILibraryView>('LibraryView', libraryViewSchema)
  );
}
