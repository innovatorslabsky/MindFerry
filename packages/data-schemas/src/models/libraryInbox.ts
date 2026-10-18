import { Model } from 'mongoose';
import libraryInboxSchema, { ILibraryInbox } from '~/schema/libraryInbox';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryInboxModel(mongoose: typeof import('mongoose')): Model<ILibraryInbox> {
  applyTenantIsolation(libraryInboxSchema);
  return (
    mongoose.models.LibraryInbox ||
    mongoose.model<ILibraryInbox>('LibraryInbox', libraryInboxSchema)
  );
}
