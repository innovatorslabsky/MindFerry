import { Model } from 'mongoose';
import libraryHighlightSchema, { ILibraryHighlight } from '~/schema/libraryHighlight';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryHighlightModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryHighlight> {
  applyTenantIsolation(libraryHighlightSchema);
  return (
    mongoose.models.LibraryHighlight ||
    mongoose.model<ILibraryHighlight>('LibraryHighlight', libraryHighlightSchema)
  );
}
