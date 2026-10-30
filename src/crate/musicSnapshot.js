// Database-only reads. Deliberately imports no Spotify/enrichment clients.
const {createHash}=require('node:crypto');
const {openDatabase}=require('../db');
const parse=(s,f)=>{try{return JSON.parse(s);}catch{return f;}};
const cleanSignals=s=>parse(s,[]).filter(v=>typeof v==='string'&&!/^(popularity|followers[ _:]+total|spotify[ _:]+artist[ _:]+id|artist[ _:]+name)/i.test(v));
function error(message,statusCode=400){return Object.assign(new Error(message),{statusCode,code:'invalid_music_snapshot'});}
function snapshot(userId,options={}){
 if(options.user_id!==undefined||options.userId!==undefined)throw error('Account selector is not supported.');
 const limit=options.limit===undefined?100:Number(options.limit),offset=options.offset===undefined?0:Number(options.offset);
 if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(offset)||offset<0)throw error('Invalid pagination.');
 const db=openDatabase();
 return db.transaction(()=>{
 const rows=db.prepare(`SELECT t.id AS track_id,t.spotify_track_id,t.name,t.artist_names,t.album_name,t.raw_json,t.updated_at,u.last_seen_at,o.override_playlist_code,o.updated_at AS override_updated,e.effective_release_year FROM user_tracks u JOIN tracks t ON t.id=u.track_id LEFT JOIN track_overrides o ON o.track_id=t.id LEFT JOIN track_era_overrides e ON e.track_id=t.id WHERE u.user_id=? AND u.playlist_code IS NULL ORDER BY t.id`).all(userId);
 const names=new Set(rows.flatMap(r=>parse(r.artist_names,[])).map(n=>n.trim().toLowerCase()));
 const ids=new Set(rows.map(r=>r.spotify_track_id));const isrcs=new Set(rows.map(r=>parse(r.raw_json,{})?.external_ids?.isrc).filter(Boolean));
 const genres=db.prepare('SELECT artist_name,genre,source FROM artist_genres').all().filter(r=>names.has(r.artist_name.trim().toLowerCase()));
 const artistRows=db.prepare(`SELECT a.display_artist_name,a.normalized_artist_name,a.spotify_artist_id,s.source,s.normalized_signals_json,s.error_code,s.fetched_at,s.expires_at FROM artist_intelligence a JOIN artist_intelligence_sources s ON s.artist_intelligence_id=a.id`).all().filter(r=>names.has(r.normalized_artist_name));
 const trackRows=db.prepare(`SELECT t.spotify_track_id,t.isrc,s.source,s.normalized_signals_json,s.raw_payload_json,s.error_code,s.fetched_at,s.expires_at FROM track_intelligence t JOIN track_intelligence_sources s ON s.track_intelligence_id=t.id`).all().filter(r=>ids.has(r.spotify_track_id)||isrcs.has(r.isrc));
 const evidence=r=>({source:r.source,signals:cleanSignals(r.normalized_signals_json),error_code:r.error_code||null,fetched_at:r.fetched_at,expires_at:r.expires_at||null,manually_approved:parse(r.raw_payload_json,{})?.manually_approved===true,authority:'unresolved_legacy_shared'});
 const artists=[...names].sort().map(name=>({name,approved_genres:genres.filter(r=>r.artist_name.trim().toLowerCase()===name).map(r=>({genre:r.genre,source:r.source})),cached_sources:artistRows.filter(r=>r.normalized_artist_name===name).map(r=>({...evidence(r),spotify_artist_id:r.spotify_artist_id}))}));
 const tracks=rows.map(r=>{const raw=parse(r.raw_json,{});return {track_id:r.track_id,spotify_track_id:r.spotify_track_id,title:r.name,artist_names:parse(r.artist_names,[]),artist_ids:(raw.artists||[]).map(a=>a.id).filter(Boolean),album_name:r.album_name,isrc:raw.external_ids?.isrc||null,release_date:raw.album?.release_date||null,effective_release_year:r.effective_release_year||null,manual_override:r.override_playlist_code||null,manual_override_scope:r.override_playlist_code?'legacy_global_lock':null,popularity:raw.popularity??null,explicit:raw.explicit??false,duration_ms:raw.duration_ms??null,cached_track_sources:trackRows.filter(t=>t.spotify_track_id===r.spotify_track_id||(raw.external_ids?.isrc&&t.isrc===raw.external_ids.isrc)).map(evidence)};});
 const version=createHash('sha256').update(JSON.stringify({rows,artists,trackRows})).digest('hex');
 if(options.snapshot&&options.snapshot!==version)throw error('Snapshot changed; restart pagination.',409);
 return {status:'ok',generated_at:new Date().toISOString(),scope:'current_account_unsorted_music',snapshot:version,total:tracks.length,offset,limit,count:tracks.slice(offset,offset+limit).length,has_more:offset+limit<tracks.length,tracks:tracks.slice(offset,offset+limit),artist_evidence:artists,notes:['Cached database evidence only; no provider calls or writes.','Legacy shared evidence is not consent to learn from private preferences.','Manual corrections remain locked.']};
 })();
}
function integrity(){return openDatabase().prepare(`SELECT (SELECT count(*) FROM users) accounts,(SELECT count(*) FROM tracks) catalog_tracks,(SELECT count(*) FROM tracks WHERE raw_json IS NOT NULL AND trim(raw_json)!='') catalog_with_provider_payload,(SELECT count(*) FROM user_tracks) user_song_associations,(SELECT count(*) FROM user_tracks u LEFT JOIN users a ON a.id=u.user_id WHERE a.id IS NULL) associations_missing_account,(SELECT count(*) FROM user_tracks u LEFT JOIN tracks t ON t.id=u.track_id WHERE t.id IS NULL) associations_missing_track,(SELECT count(*) FROM tracks t WHERE NOT EXISTS(SELECT 1 FROM user_tracks u WHERE u.track_id=t.id)) catalog_without_current_association`).get();}
module.exports={snapshot,integrity};
