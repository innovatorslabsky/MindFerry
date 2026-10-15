import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryHighlightSchema, { ILibraryHighlight } from '~/schema/libraryHighlight';

export function createLibraryHighlightModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryHighlight> {
  applyTenantIsolation(libraryHighlightSchema);
  return (
    mongoose.models.LibraryHighlight ||
    mongoose.model<ILibraryHighlight>('LibraryHighlight', libraryHighlightSchema)
  );
}
