import { model, Schema } from 'mongoose';

const ThumbnailSchema = new Schema({
    url: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true }
});

const ThumbnailsSchema = new Schema({
    default: { type: ThumbnailSchema, required: true },
    medium: { type: ThumbnailSchema },
    high: { type: ThumbnailSchema },
    standard: { type: ThumbnailSchema },
    maxres: { type: ThumbnailSchema }
});

const ResourceIdSchema = new Schema({
    kind: { type: String, required: true },
    videoId: { type: String, required: true }
});

const SnippetSchema = new Schema({
    publishedAt: { type: Date, required: true },
    channelId: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    thumbnails: { type: ThumbnailsSchema, required: true },
    channelTitle: { type: String, required: true },
    playlistId: { type: String },
    resourceId: { type: ResourceIdSchema, required: true },
    videoOwnerChannelTitle: { type: String, required: true },
    videoOwnerChannelId: { type: String, required: true }
});

const MusicSchema = new Schema({
    id: { type: String, required: true },
    snippet: { type: SnippetSchema, required: true },
    streamUri: { type: String, required: true }
});

const MusicModel = model('musics', MusicSchema);

export default MusicModel;