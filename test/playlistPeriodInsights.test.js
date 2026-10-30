const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('collection periods use resolved user tracks and effective release years',()=>{
  const records=[
    {track_id:1,playlist_code:'pop',artist_names:'["Example"]',raw_json:'{"album":{"release_date":"1999"}}',effective_release_year:2001},
    {track_id:2,playlist_code:'pop',artist_names:'["Example"]',raw_json:'{}'},
    {track_id:4,playlist_code:'pop',artist_names:'["Future"]',raw_json:JSON.stringify({album:{release_date:String(new Date().getFullYear()+1)}})},
    {track_id:3,playlist_code:'pop',artist_names:'["Other"]',raw_json:'{"album":{"release_date":"1980"}}'},
  ];
  const db={prepare:()=>({get:()=>({found:1}),all:()=>records})};
  const mocks={
    '../db':{openDatabase:()=>db},
    '../repositories/artistGenres':{findGenresByArtistNames:()=>new Map(),normalizeArtistName:s=>s.toLowerCase()},
    './eraYears':require('../src/crate/eraYears'),
    './playlistDefinitions':{ACTIVE_PLAYLIST_DEFINITIONS:[{playlistCode:'pop',displayName:'Pop'}]},
    './specialtySuggestions':{getSpecialtySuggestionsForUser:()=>[{seed_code:'sample',display_name:'Sample',overlap_count:2}]},
    './specialtyTrackResolver':{resolveSpecialtyTracksForUser:()=>({tracks:[{track_id:1},{track_id:2}]})},
    './trackContext':{getArtistNames:r=>JSON.parse(r.artist_names),parseRawTrack:JSON.parse},
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/crate/libraryInsights'),'utf8'),{module,exports:module.exports,require:id=>{assert.ok(id in mocks,id);return mocks[id];}});
  const data=module.exports.getLibraryInsightsForUser(1);
  const collection=data.playlists.specialty_playlists_earned[0];
  assert.equal(collection.overlap_count,2);
  assert.equal(JSON.stringify(collection.year_counts),JSON.stringify([{year:2001,count:1}]));
  assert.equal(data.data_quality.total_tracks,4);
  assert.equal(data.data_quality.tracks_with_release_year,2);
  assert.equal(data.timeline.year_counts.reduce((n,r)=>n+r.count,0),2);
});
