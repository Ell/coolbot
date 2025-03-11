import { createTool } from "../bot/tool";
import { z } from "zod";
import fetch from "node-fetch";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_VIDEO_URL = "https://www.youtube.com/watch?v=";

/**
 * Gets the API key from environment variables or throws an error if it doesn't exist
 */
function getApiKey(): string {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY environment variable is not set");
  }
  return apiKey;
}

/**
 * Formats a large number with delimiters (e.g., 1,000,000)
 */
function groupIntDigits(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Searches YouTube and returns the video ID of the first result
 */
async function searchYouTube(query: string): Promise<string | null> {
  const apiKey = getApiKey();
  const searchParams = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: "1",
    key: apiKey,
  });

  try {
    const response = await fetch(`${YOUTUBE_SEARCH_URL}?${searchParams}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`YouTube API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as any;

    if (!data.items || data.items.length === 0) {
      return null;
    }

    return data.items[0].id.videoId;
  } catch (error) {
    console.error("Error searching YouTube:", error);
    throw error;
  }
}

/**
 * Gets detailed information about a video and formats it into a string
 */
async function getVideoDescription(videoId: string): Promise<string> {
  const apiKey = getApiKey();
  const searchParams = new URLSearchParams({
    part: "snippet,contentDetails,statistics",
    id: videoId,
    key: apiKey,
  });

  try {
    const response = await fetch(`${YOUTUBE_VIDEOS_URL}?${searchParams}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`YouTube API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as any;

    if (!data.items || data.items.length === 0) {
      return `No details found for video ID ${videoId}`;
    }

    const video = data.items[0];
    const title = video.snippet.title;
    const channelTitle = video.snippet.channelTitle || "Unknown Channel";

    // Parse duration
    const duration = video.contentDetails.duration;
    // Convert ISO 8601 duration to human-readable format
    const durationMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = durationMatch[1] ? parseInt(durationMatch[1]) : 0;
    const minutes = durationMatch[2] ? parseInt(durationMatch[2]) : 0;
    const seconds = durationMatch[3] ? parseInt(durationMatch[3]) : 0;

    let durationStr = "";
    if (hours > 0) {
      durationStr += `${hours}:`;
      durationStr += `${minutes.toString().padStart(2, "0")}:`;
    } else {
      durationStr += `${minutes}:`;
    }
    durationStr += seconds.toString().padStart(2, "0");

    // Format statistics
    const likes = video.statistics.likeCount
      ? groupIntDigits(parseInt(video.statistics.likeCount))
      : "N/A";
    const views = video.statistics.viewCount
      ? groupIntDigits(parseInt(video.statistics.viewCount))
      : "N/A";

    const videoUrl = `${YOUTUBE_VIDEO_URL}${videoId}`;

    return `${title} [${durationStr}] | 👤 ${channelTitle} | 👍 ${likes} | 👀 ${views} | ${videoUrl}`;
  } catch (error) {
    console.error("Error getting video details:", error);
    throw error;
  }
}

/**
 * Gets basic information about a video (title, length, uploader)
 */
async function getVideoBasicInfo(videoId: string): Promise<string> {
  const apiKey = getApiKey();
  const searchParams = new URLSearchParams({
    part: "snippet,contentDetails",
    id: videoId,
    key: apiKey,
  });

  try {
    const response = await fetch(`${YOUTUBE_VIDEOS_URL}?${searchParams}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`YouTube API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as any;

    if (!data.items || data.items.length === 0) {
      return `No details found for video ID ${videoId}`;
    }

    const video = data.items[0];
    const title = video.snippet.title;
    const channelTitle = video.snippet.channelTitle || "Unknown Channel";

    // Parse duration
    const duration = video.contentDetails.duration;
    // Convert ISO 8601 duration to human-readable format
    const durationMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = durationMatch[1] ? parseInt(durationMatch[1]) : 0;
    const minutes = durationMatch[2] ? parseInt(durationMatch[2]) : 0;
    const seconds = durationMatch[3] ? parseInt(durationMatch[3]) : 0;

    let durationStr = "";
    if (hours > 0) {
      durationStr += `${hours}:`;
      durationStr += `${minutes.toString().padStart(2, "0")}:`;
    } else {
      durationStr += `${minutes}:`;
    }
    durationStr += seconds.toString().padStart(2, "0");

    const videoUrl = `${YOUTUBE_VIDEO_URL}${videoId}`;

    return `${title} [${durationStr}] | 👤 ${channelTitle} | ${videoUrl}`;
  } catch (error) {
    console.error("Error getting video basic info:", error);
    throw error;
  }
}

export const youtubeSearchTool = createTool(
  "youtube_search",
  "Search for a YouTube video and return the video details including title, duration, likes, views, and URL",
  z.object({
    query: z.string().describe("The search query for YouTube"),
  }),
  async ({ query }: { query: string }) => {
    try {
      const videoId = await searchYouTube(query);
      if (!videoId) {
        return "No videos found for the query.";
      }

      const videoDescription = await getVideoDescription(videoId);
      return videoDescription;
    } catch (error: any) {
      console.error("YouTube search tool error:", error);
      return `Error searching YouTube: ${error.message}`;
    }
  }
);

export const youtubeUrlTool = createTool(
  "youtube_url",
  "Search for a YouTube video and return the URL with title, length, and uploader information",
  z.object({
    query: z.string().describe("The search query for YouTube"),
  }),
  async ({ query }: { query: string }) => {
    try {
      const videoId = await searchYouTube(query);
      if (!videoId) {
        return "No videos found for the query.";
      }

      const videoInfo = await getVideoBasicInfo(videoId);
      return videoInfo;
    } catch (error: any) {
      console.error("YouTube URL tool error:", error);
      return `Error searching YouTube: ${error.message}`;
    }
  }
);

export default {
  youtube_search: youtubeSearchTool,
  youtube_url: youtubeUrlTool,
};
