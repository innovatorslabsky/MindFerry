import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryFeedSchema, { ILibraryFeed } from '~/schema/libraryFeed';

export function createLibraryFeedModel(mongoose: typeof import('mongoose')): Model<ILibraryFeed> {
  applyTenantIsolation(libraryFeedSchema);
  return (
    mongoose.models.LibraryFeed || mongoose.model<ILibraryFeed>('LibraryFeed', libraryFeedSchema)
  );
}
