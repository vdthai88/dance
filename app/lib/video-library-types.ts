export type LibraryVideo = {
  id: string;
  filename: string;
  contentType: string | null;
  byteSize: number;
  createdAt: string;
  sessionName: string | null;
  available: boolean;
};
