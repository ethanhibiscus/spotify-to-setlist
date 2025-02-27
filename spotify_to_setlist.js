#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const SpotifyWebApi = require('spotify-web-api-node');
const { search } = require('./tunebat-api/tunebat'); // using the exported search() from tunebat.js
const stringSimilarity = require('string-similarity');
const csvWriter = require('csv-writer').createObjectCsvWriter;
const yargs = require('yargs');

// Parse command-line arguments
const argv = yargs.option('link', {
  alias: 'l',
  describe: 'Spotify playlist or track link',
  type: 'string',
  demandOption: true
}).argv;

// Initialize Spotify API client using client credentials flow
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Utility to sleep with jitter
function sleep(ms) {
  const jitter = Math.floor(Math.random() * 500);
  return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

// Obtain access token from Spotify
async function getSpotifyAccessToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    console.log("Spotify access token retrieved.");
    spotifyApi.setAccessToken(data.body['access_token']);
  } catch (err) {
    console.error('Failed to retrieve Spotify access token', err);
    process.exit(1);
  }
}

// Parse Spotify link
function parseSpotifyLink(link) {
  if (link.includes('playlist/')) {
    const match = link.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!match || match.length < 2) throw new Error('Invalid playlist link format.');
    console.log("Parsed playlist ID:", match[1]);
    return { type: 'playlist', id: match[1] };
  } else if (link.includes('track/')) {
    const match = link.match(/track\/([a-zA-Z0-9]+)/);
    if (!match || match.length < 2) throw new Error('Invalid track link format.');
    console.log("Parsed track ID:", match[1]);
    return { type: 'track', id: match[1] };
  } else {
    throw new Error('Unsupported link format. Provide a valid Spotify playlist or track link.');
  }
}

// Retrieve single track details from Spotify
async function getTrack(trackId) {
  try {
    console.log(`Retrieving details for track ID: ${trackId}`);
    const data = await spotifyApi.getTrack(trackId);
    console.log("Retrieved track:", data.body.name, "by", data.body.artists[0].name);
    return data.body;
  } catch (err) {
    console.error(`Error retrieving track ${trackId}: `, err);
    return null;
  }
}

// Retrieve tracks from a playlist
async function getPlaylistTracks(playlistId) {
  try {
    console.log(`Retrieving tracks for playlist ID: ${playlistId}`);
    const data = await spotifyApi.getPlaylistTracks(playlistId, { limit: 100 });
    console.log(`Found ${data.body.items.length} tracks in the playlist.`);
    return data.body.items.map(item => item.track);
  } catch (err) {
    console.error(`Error retrieving playlist ${playlistId}: `, err);
    return [];
  }
}

// Get Tunebat data with duplicate filtering and retries
async function getTunebatData(artist, title, attempt = 1) {
  const query = `${artist} ${title}`;
  try {
    console.log(`Attempt ${attempt}: Querying Tunebat for: ${query}`);
    await sleep(500); // base delay with jitter
    
    let results = await search(query);
    console.log(`Tunebat returned ${results.length} items for: ${query}`);

    // Filter duplicates (case-insensitive)
    const seen = new Set();
    const uniqueResults = results.filter(item => {
      const lowerName = item.n.toLowerCase();
      if (seen.has(lowerName)) return false;
      seen.add(lowerName);
      return true;
    });
    console.log(`Filtered to ${uniqueResults.length} unique items for: ${query}`);

    let bestMatch = null;
    let bestScore = 0;
    uniqueResults.forEach(item => {
      let score = stringSimilarity.compareTwoStrings(item.n.toLowerCase(), title.toLowerCase());
      console.log(`  Comparing "${item.n}" with "${title}" => score: ${score.toFixed(2)}`);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    });

    if (bestMatch && bestScore >= 0.8) {
      console.log(`Best match for "${artist} - ${title}" is "${bestMatch.n}" with score ${bestScore.toFixed(2)}`);
      return bestMatch;
    } else {
      console.warn(`No adequate Tunebat match for "${artist} - ${title}" (best score: ${bestScore.toFixed(2)})`);
      return null;
    }
  } catch (e) {
    console.error(`Error calling Tunebat API for "${artist} - ${title}": `, e);
    if (e.headers && e.headers['retry-after']) {
      const waitTime = (parseInt(e.headers['retry-after']) * 1000) + (attempt * 1000);
      console.warn(`Throttled by Tunebat. Waiting ${waitTime / 1000} seconds before retrying...`);
      await sleep(waitTime);
      return getTunebatData(artist, title, attempt + 1);
    } else if (attempt < 5) {
      const waitTime = Math.min(5000, Math.pow(1.5, attempt) * 1000);
      console.warn(`Retrying in ${waitTime / 1000} seconds (exponential backoff)...`);
      await sleep(waitTime);
      return getTunebatData(artist, title, attempt + 1);
    } else {
      console.error(`Exceeded maximum retries for "${artist} - ${title}". Skipping.`);
      return null;
    }
  }
}

function formatDuration(ms) {
    if (isNaN(ms) || ms === "N/A") return "N/A"; // Handle invalid cases
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`; // Ensure two-digit seconds
  }
  
  
// Process tracks concurrently in batches
async function processTracksInBatches(tracks, batchSize = 5, delayBetweenBatches = 5000) {
  const results = [];
  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    console.log(`\n=== Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(tracks.length / batchSize)} ===`);
    
    const batchResults = await Promise.all(
      batch.map(async track => {
        const title = track.name;
        const artist = track.artists[0].name;
        console.log(`\nProcessing track: ${artist} - ${title}`);
        const tunebatData = await getTunebatData(artist, title);
        if (tunebatData) {
            const formattedDuration = formatDuration(tunebatData.d);
          console.log(`✓ Tunebat data for "${artist} - ${title}": BPM=${tunebatData.b}, Key=${tunebatData.c}, Duration=${formattedDuration}, Energy=${tunebatData.e}`);
          return {
            song: title,
            artist: artist,
            bpm: tunebatData.b,
            key: tunebatData.c,
            duration: formattedDuration,  
            energy: tunebatData.e    
          };
        } else {
          console.warn(`✗ No Tunebat data for: ${artist} - ${title}`);
          return {
            song: title,
            artist: artist,
            bpm: "N/A",
            key: "N/A",
            duration: "N/A",
            energy: "N/A"
          };
        }
      })
    );
    results.push(...batchResults);
    if (i + batchSize < tracks.length) {
      console.log(`\nBatch complete. Waiting ${delayBetweenBatches / 1000} seconds before next batch...\n`);
      await sleep(delayBetweenBatches);
    }
  }
  return results;
}

// Main function: process the Spotify link, query Tunebat for each track, and write results to CSV.
async function main() {
  await getSpotifyAccessToken();
  const parsed = parseSpotifyLink(argv.link);
  let tracks = [];

  if (parsed.type === 'track') {
    const track = await getTrack(parsed.id);
    if (track) tracks.push(track);
  } else if (parsed.type === 'playlist') {
    tracks = await getPlaylistTracks(parsed.id);
  }

  if (tracks.length === 0) {
    console.error('No tracks found.');
    process.exit(1);
  }

  console.log(`\nTotal tracks to process: ${tracks.length}\n`);

  // Process tracks in batches with parallel processing and controlled concurrency
  const rows = await processTracksInBatches(tracks, 5, 5000);

  // Write rows to a CSV file using csv-writer
  const writer = csvWriter({
    path: 'setlist.csv',
    header: [
      { id: 'song', title: 'Song' },
      { id: 'artist', title: 'Artist' },
      { id: 'bpm', title: 'BPM' },
      { id: 'key', title: 'Key' },
      { id: 'duration', title: 'Duration (ms)' },
      { id: 'energy', title: 'Energy (%)' }
    ]
  });
  await writer.writeRecords(rows);
  console.log("\nCSV file 'setlist.csv' generated successfully.");
}

main();
