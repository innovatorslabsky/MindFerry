import { Model } from 'mongoose';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import libraryUnitSchema, { ILibraryUnit } from '~/schema/libraryUnit';

export function createLibraryUnitModel(mongoose: typeof import('mongoose')): Model<ILibraryUnit> {
  applyTenantIsolation(libraryUnitSchema);
  return (
    mongoose.models.LibraryUnit || mongoose.model<ILibraryUnit>('LibraryUnit', libraryUnitSchema)
  );
}
