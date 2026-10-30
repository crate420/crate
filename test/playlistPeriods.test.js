const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const periods = require('../public/playlist-periods');
const eraConfig = require('../public/genre-era-config');
const row = {count:5,year_counts:[{year:1999,count:1},{year:2000,count:2},{year:2010,count:1},{year:null,count:1},{year:1980,count:0}]};
test('All retains unknown years, and only populated decades are offered',()=>{
  assert.equal(periods.count(row,'all'),5);
  assert.deepEqual(periods.options(row).map(o=>o.value),['all','1990s','2000s','2010s']);
  assert.deepEqual(periods.options({count:2}),[{value:'all',label:'All'}]);
  assert.deepEqual(periods.range('all'),{});
});
test('decade boundaries and counts agree, and current decade stops at current year',()=>{
  assert.equal(periods.count(row,'1990s'),1);
  assert.equal(periods.count(row,'2000s'),2);
  assert.equal(periods.count(row,'2010s'),1);
  assert.deepEqual(periods.range('2000s'),{year_min:2000,year_max:2009});
  const decade=Math.floor(new Date().getFullYear()/10)*10;
  assert.equal(periods.range(decade+'s').year_max,new Date().getFullYear());
});
test('outgoing decade ranges filter genre, artist, collection and existing era definitions',()=>{
  const tracks=[1999,2000,2009,2010,null].map((year,i)=>({track_id:i,uri:'spotify:track:'+i,spotify_uri:'spotify:track:'+i,playlist_code:'pop',artist_names:JSON.stringify(['Example']),effective_release_year:year}));
  const module={exports:{}};
  const mocks={
    '../repositories/playlists':{},'../repositories/tracks':{},'../repositories/users':{},'../spotify/playlists':{},
    './playlistDefinitions':{PLAYLIST_DEFINITIONS:[{playlistCode:'pop',displayName:'Crate: Pop'}]},
    './eraYears':{effectiveReleaseYearForRow:t=>t.effective_release_year},
    '../../public/genre-era-config':eraConfig,
    './specialtyTrackResolver':{resolveSpecialtyTracksForUser:()=>({tracks}),seedCodeForSpecialtyPlaylistCode:()=> 'sample',specialtyPlaylistCodeForSeed:()=> 'specialty:sample'},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/crate/syncPlaylists'),'utf8'),{module,exports:module.exports,require:id=>{assert.ok(id in mocks,id);return mocks[id];},console:{log(){}}});
  const build=module.exports.buildSelectedDefinitions;
  for(const selection of [{type:'genre',playlist_code:'pop',era:'all'},{type:'artist',artist_name:'Example'},{type:'specialty',seed_code:'sample'},{type:'era',era:'retro'}]){
    const definitions=build([{...selection,...periods.range('2000s')}],tracks,1);
    assert.deepEqual(Array.from(definitions[0].tracks,t=>t.track_id),[1,2]);
    assert.equal(definitions[0].selection.year_min,2000);
    assert.equal(definitions[0].selection.year_max,2009);
  }
  const all=build([{type:'genre',playlist_code:'pop',era:'all'}],tracks,1);
  assert.equal(all[0].tracks.length,5);
});
