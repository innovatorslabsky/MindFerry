import { Model } from 'mongoose';
import libraryViewSchema, { ILibraryView } from '~/schema/libraryView';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryViewModel(mongoose: typeof import('mongoose')): Model<ILibraryView> {
  applyTenantIsolation(libraryViewSchema);
  return (
    mongoose.models.LibraryView || mongoose.model<ILibraryView>('LibraryView', libraryViewSchema)
  );
}
