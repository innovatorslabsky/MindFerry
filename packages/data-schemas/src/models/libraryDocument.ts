import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryDocumentSchema, { ILibraryDocument } from '~/schema/libraryDocument';

export function createLibraryDocumentModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryDocument> {
  applyTenantIsolation(libraryDocumentSchema);
  return (
    mongoose.models.LibraryDocument ||
    mongoose.model<ILibraryDocument>('LibraryDocument', libraryDocumentSchema)
  );
}
