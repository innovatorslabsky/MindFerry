import mongoose, { Schema, Document, Types } from 'mongoose';
import { LIBRARY_KINDS, LIBRARY_LOCATIONS } from './libraryDocument';

export const LIBRARY_SORTS = ['updated', 'created', 'title', 'shortest', 'longest'] as const;

/** What a pinned view shows: the filters of the list, kept under a name. */
export interface ILibraryViewFilter {
  location?: (typeof LIBRARY_LOCATIONS)[number];
  kind?: (typeof LIBRARY_KINDS)[number];
  tag?: string;
  /** A folder id, or `none` for documents in no folder. */
  folder?: string;
  sort?: (typeof LIBRARY_SORTS)[number];
}

/** A saved set of list filters shown in the sidebar, so a person can return to it in one click. */
export interface ILibraryView extends Document {
  userId: Types.ObjectId;
  name: string;
  /** Lower-cased name, so "Shortlist" and "shortlist" are the same view. */
  nameKey: string;
  filter: ILibraryViewFilter;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

const libraryViewSchema: Schema<ILibraryView> = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    filter: {
      location: { type: String, enum: LIBRARY_LOCATIONS },
      kind: { type: String, enum: LIBRARY_KINDS },
      tag: { type: String },
      folder: { type: String },
      sort: { type: String, enum: LIBRARY_SORTS },
    },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

libraryViewSchema.index({ userId: 1, nameKey: 1 }, { unique: true });

export default libraryViewSchema;
