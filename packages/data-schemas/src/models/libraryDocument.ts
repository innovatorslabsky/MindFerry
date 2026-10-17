import { Model } from 'mongoose';
import libraryDocumentSchema, { ILibraryDocument } from '~/schema/libraryDocument';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createLibraryDocumentModel(
  mongoose: typeof import('mongoose'),
): Model<ILibraryDocument> {
  applyTenantIsolation(libraryDocumentSchema);
  return (
    mongoose.models.LibraryDocument ||
    mongoose.model<ILibraryDocument>('LibraryDocument', libraryDocumentSchema)
  );
}
