export type MediaFile = {
  content_type: string;
  tags: string[];
  url: string;
};

export type ApiDocument = {
  id: string;
  media_files: MediaFile[];
  name: string;
};
