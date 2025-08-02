import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

const API_CONFIG = {
  baseUrl: "https://danbooru.donmai.us",
  defaultParams: {
    only: "id,file_url,large_file_url,preview_file_url,tag_string,tag_string_artist,tag_string_character,tag_string_copyright,rating,score",
  },
  timeout: 8000,
}

interface DanbooruPost {
  id: number
  file_url: string
  large_file_url: string
  preview_file_url: string
  tag_string: string
  tag_string_artist: string
  tag_string_character: string
  tag_string_copyright: string
  rating: string
  score: number
}

export async function POST(request: NextRequest) {
  try {
    const { ids } = await request.json();
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Invalid or empty IDs array' }, { status: 400 });
    }

    const limitedIds = ids.slice(0, 100);

    const query = limitedIds.length === 1 
      ? `id:${limitedIds[0]}`
      : limitedIds.map(id => `id:${id}`).join(' or ');

    const danbooruUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(query)}&limit=100`;

    const response = await fetch(danbooruUrl);
    
    if (!response.ok) {
      console.error('Danbooru API error:', response.status, response.statusText);
      throw new Error(`Danbooru API error: ${response.status}`);
    }

    const rawPosts = await response.json();

    const validPosts = rawPosts.filter((post: any) => 
      post && 
      post.id && 
      post.file_url && 
      post.file_ext !== 'mp4' && 
      post.file_ext !== 'webm'
    );

    const sortedPosts = limitedIds
      .map(id => validPosts.find((post: any) => post.id === id))
      .filter(Boolean);

    return NextResponse.json(sortedPosts);
  } catch (error) {
    console.error('Favorites API error:', error);
    return NextResponse.json({ error: 'Failed to fetch favorites' }, { status: 500 });
  }
}