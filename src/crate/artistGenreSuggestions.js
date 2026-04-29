const artistGenreRepo = require("../repositories/artistGenres");
const { getMissingArtistGenres } = require("./missingArtistGenres");

const CURATED_ARTIST_SUGGESTIONS = {
  "toad the wet sprocket": {
    artistName: "Toad The Wet Sprocket",
    suggestedGenres: ["alternative rock", "jangle pop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "imagine dragons": {
    artistName: "Imagine Dragons",
    suggestedGenres: ["pop rock", "modern rock"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "p!nk": {
    artistName: "P!nk",
    suggestedGenres: ["pop rock", "dance pop"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "bruno mars": {
    artistName: "Bruno Mars",
    suggestedGenres: ["pop", "soul", "r&b", "funk"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "madonna": {
    artistName: "Madonna",
    suggestedGenres: ["pop", "dance", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the cranberries": {
    artistName: "The Cranberries",
    suggestedGenres: ["rock", "alternative rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "craig david": {
    artistName: "Craig David",
    suggestedGenres: ["r&b", "soul", "pop"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "miley cyrus": {
    artistName: "Miley Cyrus",
    suggestedGenres: ["pop", "rock", "country"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "*nsync": {
    artistName: "*NSYNC",
    suggestedGenres: ["pop"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "michael jackson": {
    artistName: "Michael Jackson",
    suggestedGenres: ["pop", "soul", "r&b", "funk"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "taylor swift": {
    artistName: "Taylor Swift",
    suggestedGenres: ["pop", "country", "folk"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the police": {
    artistName: "The Police",
    suggestedGenres: ["rock", "new wave", "reggae"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "coheed and cambria": {
    artistName: "Coheed and Cambria",
    suggestedGenres: ["rock", "alternative rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "beyoncé": {
    artistName: "Beyoncé",
    suggestedGenres: ["pop", "r&b", "soul", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "black eyed peas": {
    artistName: "Black Eyed Peas",
    suggestedGenres: ["pop", "hip hop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "coldplay": {
    artistName: "Coldplay",
    suggestedGenres: ["rock", "alternative rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "halestorm": {
    artistName: "Halestorm",
    suggestedGenres: ["rock", "alternative rock"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "neil diamond": {
    artistName: "Neil Diamond",
    suggestedGenres: ["pop", "rock", "singer-songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "tracy chapman": {
    artistName: "Tracy Chapman",
    suggestedGenres: ["folk", "singer-songwriter", "soul"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "counting crows": {
    artistName: "Counting Crows",
    suggestedGenres: ["rock", "alternative rock", "folk"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "elton john": {
    artistName: "Elton John",
    suggestedGenres: ["pop", "rock", "singer-songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "fitz and the tantrums": {
    artistName: "Fitz and The Tantrums",
    suggestedGenres: ["pop", "soul", "dance", "alternative rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "rihanna": {
    artistName: "Rihanna",
    suggestedGenres: ["pop", "r&b", "dance", "hip hop"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "thirty seconds to mars": {
    artistName: "Thirty Seconds To Mars",
    suggestedGenres: ["rock", "alternative rock"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "alanis morissette": {
    artistName: "Alanis Morissette",
    suggestedGenres: ["rock", "alternative rock", "pop", "singer-songwriter"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "justin bieber": {
    artistName: "Justin Bieber",
    suggestedGenres: ["pop", "r&b", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "justin timberlake": {
    artistName: "Justin Timberlake",
    suggestedGenres: ["pop", "r&b", "soul", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "destiny's child": {
    artistName: "Destiny's Child",
    suggestedGenres: ["r&b", "pop", "soul"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "the goo goo dolls": {
    artistName: "The Goo Goo Dolls",
    suggestedGenres: ["rock", "alternative rock", "pop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "tlc": {
    artistName: "TLC",
    suggestedGenres: ["r&b", "pop", "soul", "hip hop"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "traveling wilburys": {
    artistName: "Traveling Wilburys",
    suggestedGenres: ["rock", "folk", "singer-songwriter"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "backstreet boys": {
    artistName: "Backstreet Boys",
    suggestedGenres: ["pop"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "better than ezra": {
    artistName: "Better Than Ezra",
    suggestedGenres: ["rock", "alternative rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "billy idol": {
    artistName: "Billy Idol",
    suggestedGenres: ["rock", "new wave", "pop"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "chappell roan": {
    artistName: "Chappell Roan",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "christina aguilera": {
    artistName: "Christina Aguilera",
    suggestedGenres: ["pop", "r&b", "soul"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "huey lewis & the news": {
    artistName: "Huey Lewis & The News",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "post malone": {
    artistName: "Post Malone",
    suggestedGenres: ["pop", "hip hop", "r&b"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the weeknd": {
    artistName: "The Weeknd",
    suggestedGenres: ["pop", "r&b", "soul", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "whitney houston": {
    artistName: "Whitney Houston",
    suggestedGenres: ["pop", "r&b", "soul"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "abba": {
    artistName: "ABBA",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "bruce springsteen": {
    artistName: "Bruce Springsteen",
    suggestedGenres: ["rock", "singer-songwriter"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "bryan adams": {
    artistName: "Bryan Adams",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "ceelo green": {
    artistName: "CeeLo Green",
    suggestedGenres: ["soul", "rb", "pop"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "garbage": {
    artistName: "Garbage",
    suggestedGenres: ["alternative", "rock", "electronic"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "gin blossoms": {
    artistName: "Gin Blossoms",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "hootie & the blowfish": {
    artistName: "Hootie & The Blowfish",
    suggestedGenres: ["rock", "pop", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "inxs": {
    artistName: "INXS",
    suggestedGenres: ["rock", "newwave", "pop"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "jess glynne": {
    artistName: "Jess Glynne",
    suggestedGenres: ["pop", "dance", "soul"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "jonas brothers": {
    artistName: "Jonas Brothers",
    suggestedGenres: ["pop", "rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "kesha": {
    artistName: "Kesha",
    suggestedGenres: ["pop", "dance", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "mc hammer": {
    artistName: "MC Hammer",
    suggestedGenres: ["hiphop", "pop", "dance"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "t-pain": {
    artistName: "T-Pain",
    suggestedGenres: ["hiphop", "rb", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "ajr": {
    artistName: "AJR",
    suggestedGenres: ["pop", "alternative", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "billie eilish": {
    artistName: "Billie Eilish",
    suggestedGenres: ["pop", "alternative", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "buckcherry": {
    artistName: "Buckcherry",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "danger mouse": {
    artistName: "Danger Mouse",
    suggestedGenres: ["hiphop", "electronic", "alternative"],
    suggestedPlaylistCode: "hiphop",
    confidence: "medium",
  },
  "gnarls barkley": {
    artistName: "Gnarls Barkley",
    suggestedGenres: ["soul", "pop", "alternative"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "harry styles": {
    artistName: "Harry Styles",
    suggestedGenres: ["pop", "rock", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "indigo girls": {
    artistName: "Indigo Girls",
    suggestedGenres: ["folk", "singer_songwriter", "rock"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "jack harlow": {
    artistName: "Jack Harlow",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "lenny kravitz": {
    artistName: "Lenny Kravitz",
    suggestedGenres: ["rock", "soul"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "liz phair": {
    artistName: "Liz Phair",
    suggestedGenres: ["alternative", "rock", "singer_songwriter"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "smash mouth": {
    artistName: "Smash Mouth",
    suggestedGenres: ["rock", "pop", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "van morrison": {
    artistName: "Van Morrison",
    suggestedGenres: ["rock", "soul", "singer_songwriter"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "akon": {
    artistName: "Akon",
    suggestedGenres: ["rb", "hiphop", "pop"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "barenaked ladies": {
    artistName: "Barenaked Ladies",
    suggestedGenres: ["rock", "pop", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "cold war kids": {
    artistName: "Cold War Kids",
    suggestedGenres: ["alternative", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "doja cat": {
    artistName: "Doja Cat",
    suggestedGenres: ["pop", "hiphop", "rb"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "eddie vedder": {
    artistName: "Eddie Vedder",
    suggestedGenres: ["rock", "alternative", "singer_songwriter"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "ellie goulding": {
    artistName: "Ellie Goulding",
    suggestedGenres: ["pop", "dance", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "flo rida": {
    artistName: "Flo Rida",
    suggestedGenres: ["hiphop", "pop", "dance"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "kaleo": {
    artistName: "KALEO",
    suggestedGenres: ["rock", "blues", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "meat loaf": {
    artistName: "Meat Loaf",
    suggestedGenres: ["rock", "soundtrack"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "ne-yo": {
    artistName: "Ne-Yo",
    suggestedGenres: ["rb", "pop", "soul"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "no doubt": {
    artistName: "No Doubt",
    suggestedGenres: ["rock", "pop", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "olivia rodrigo": {
    artistName: "Olivia Rodrigo",
    suggestedGenres: ["pop", "rock", "alternative"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "selena gomez": {
    artistName: "Selena Gomez",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the outfield": {
    artistName: "The Outfield",
    suggestedGenres: ["rock", "pop", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "third eye blind": {
    artistName: "Third Eye Blind",
    suggestedGenres: ["rock", "alternative", "pop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "three dog night": {
    artistName: "Three Dog Night",
    suggestedGenres: ["rock", "pop", "soul"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "will smith": {
    artistName: "Will Smith",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "belinda carlisle": {
    artistName: "Belinda Carlisle",
    suggestedGenres: ["pop", "rock", "newwave"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "blondie": {
    artistName: "Blondie",
    suggestedGenres: ["newwave", "rock", "pop"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "cyndi lauper": {
    artistName: "Cyndi Lauper",
    suggestedGenres: ["pop", "newwave", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "doechii": {
    artistName: "Doechii",
    suggestedGenres: ["hiphop", "rb", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "george michael": {
    artistName: "George Michael",
    suggestedGenres: ["pop", "soul", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "halsey": {
    artistName: "Halsey",
    suggestedGenres: ["pop", "alternative", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "hozier": {
    artistName: "Hozier",
    suggestedGenres: ["soul", "folk", "blues"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "jason derulo": {
    artistName: "Jason Derulo",
    suggestedGenres: ["pop", "rb", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "jax": {
    artistName: "Jax",
    suggestedGenres: ["pop"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "lizzo": {
    artistName: "Lizzo",
    suggestedGenres: ["pop", "soul", "hiphop"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "loverboy": {
    artistName: "Loverboy",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "nelly furtado": {
    artistName: "Nelly Furtado",
    suggestedGenres: ["pop", "rb", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "niall horan": {
    artistName: "Niall Horan",
    suggestedGenres: ["pop", "rock", "folk"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "nicki minaj": {
    artistName: "Nicki Minaj",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "sean kingston": {
    artistName: "Sean Kingston",
    suggestedGenres: ["pop", "rb", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "sick puppies": {
    artistName: "SICK PUPPIES",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "tate mcrae": {
    artistName: "Tate McRae",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the hooters": {
    artistName: "The Hooters",
    suggestedGenres: ["rock", "newwave", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "the wallflowers": {
    artistName: "The Wallflowers",
    suggestedGenres: ["rock", "alternative", "folk"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "tina turner": {
    artistName: "Tina Turner",
    suggestedGenres: ["soul", "rock", "pop"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "troye sivan": {
    artistName: "Troye Sivan",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "amy winehouse": {
    artistName: "Amy Winehouse",
    suggestedGenres: ["soul", "rb", "jazz"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "berlin": {
    artistName: "Berlin",
    suggestedGenres: ["newwave", "pop", "electronic"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "blue october": {
    artistName: "Blue October",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "crash test dummies": {
    artistName: "Crash Test Dummies",
    suggestedGenres: ["rock", "alternative", "folk"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "crowded house": {
    artistName: "Crowded House",
    suggestedGenres: ["rock", "pop", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "george ezra": {
    artistName: "George Ezra",
    suggestedGenres: ["folk", "pop", "singer_songwriter"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "joe satriani": {
    artistName: "Joe Satriani",
    suggestedGenres: ["rock"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "men at work": {
    artistName: "Men At Work",
    suggestedGenres: ["newwave", "rock", "pop"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "milli vanilli": {
    artistName: "Milli Vanilli",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "natasha bedingfield": {
    artistName: "Natasha Bedingfield",
    suggestedGenres: ["pop"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "nelly": {
    artistName: "Nelly",
    suggestedGenres: ["hiphop", "pop", "rb"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "pop evil": {
    artistName: "Pop Evil",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "portugal. the man": {
    artistName: "Portugal. The Man",
    suggestedGenres: ["alternative", "rock", "pop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "scissor sisters": {
    artistName: "Scissor Sisters",
    suggestedGenres: ["pop", "dance", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "seal": {
    artistName: "Seal",
    suggestedGenres: ["soul", "pop", "rb"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "tones and i": {
    artistName: "Tones And I",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "war": {
    artistName: "War",
    suggestedGenres: ["soul", "rb", "rock"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "wings": {
    artistName: "Wings",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "young the giant": {
    artistName: "Young the Giant",
    suggestedGenres: ["alternative", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "5 seconds of summer": {
    artistName: "5 Seconds of Summer",
    suggestedGenres: ["pop", "rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "alex warren": {
    artistName: "Alex Warren",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "all-4-one": {
    artistName: "All-4-One",
    suggestedGenres: ["rb", "pop", "soul"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "american authors": {
    artistName: "American Authors",
    suggestedGenres: ["pop", "rock", "alternative"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "ava max": {
    artistName: "Ava Max",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "awolnation": {
    artistName: "AWOLNATION",
    suggestedGenres: ["alternative", "electronic", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "bbno$": {
    artistName: "bbno$",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "bonnie tyler": {
    artistName: "Bonnie Tyler",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "camila cabello": {
    artistName: "Camila Cabello",
    suggestedGenres: ["pop", "rb", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "conan gray": {
    artistName: "Conan Gray",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "dusty springfield": {
    artistName: "Dusty Springfield",
    suggestedGenres: ["soul", "pop"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "fastball": {
    artistName: "Fastball",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "fergie": {
    artistName: "Fergie",
    suggestedGenres: ["pop", "hiphop", "rb"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "finger eleven": {
    artistName: "Finger Eleven",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "george harrison": {
    artistName: "George Harrison",
    suggestedGenres: ["rock", "singer_songwriter"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "glorilla": {
    artistName: "GloRilla",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "goober sounds": {
    artistName: "Goober Sounds",
    suggestedGenres: ["pop"],
    suggestedPlaylistCode: "pop",
    confidence: "medium",
  },
  "grandson": {
    artistName: "grandson",
    suggestedGenres: ["alternative", "rock", "hiphop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "haim": {
    artistName: "HAIM",
    suggestedGenres: ["pop", "rock", "alternative"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "iyaz": {
    artistName: "Iyaz",
    suggestedGenres: ["pop", "rb"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "james brown & the famous flames": {
    artistName: "James Brown & The Famous Flames",
    suggestedGenres: ["soul", "rb"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "jet": {
    artistName: "Jet",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "joe cocker": {
    artistName: "Joe Cocker",
    suggestedGenres: ["rock", "soul", "blues"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "lil nas x": {
    artistName: "Lil Nas X",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "macklemore": {
    artistName: "Macklemore",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "meghan trainor": {
    artistName: "Meghan Trainor",
    suggestedGenres: ["pop", "soul"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "michael franti & spearhead": {
    artistName: "Michael Franti & Spearhead",
    suggestedGenres: ["soul", "folk", "rb"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "misterwives": {
    artistName: "MisterWives",
    suggestedGenres: ["pop", "alternative", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "mýa": {
    artistName: "Mýa",
    suggestedGenres: ["rb", "pop", "soul"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "nothing but thieves": {
    artistName: "Nothing But Thieves",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "p.m. dawn": {
    artistName: "P.M. Dawn",
    suggestedGenres: ["hiphop", "rb", "soul"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "plain white t's": {
    artistName: "Plain White T's",
    suggestedGenres: ["pop", "rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "ringo starr": {
    artistName: "Ringo Starr",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "sade": {
    artistName: "Sade",
    suggestedGenres: ["soul", "rb", "jazz"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "spin doctors": {
    artistName: "Spin Doctors",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "starship": {
    artistName: "Starship",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "teddy swims": {
    artistName: "Teddy Swims",
    suggestedGenres: ["soul", "rb", "pop"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "the driver era": {
    artistName: "THE DRIVER ERA",
    suggestedGenres: ["pop", "rock", "alternative"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the hollies": {
    artistName: "The Hollies",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "the power station": {
    artistName: "The Power Station",
    suggestedGenres: ["rock", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  tonic: {
    artistName: "Tonic",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "tyler, the creator": {
    artistName: "Tyler, The Creator",
    suggestedGenres: ["hiphop", "alternative"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "uncle kracker": {
    artistName: "Uncle Kracker",
    suggestedGenres: ["rock", "country", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  willow: {
    artistName: "WILLOW",
    suggestedGenres: ["alternative", "rock", "rb"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "world party": {
    artistName: "World Party",
    suggestedGenres: ["rock", "alternative", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "alannah myles": {
    artistName: "Alannah Myles",
    suggestedGenres: ["rock", "blues"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "arrested development": {
    artistName: "Arrested Development",
    suggestedGenres: ["hiphop", "soul"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "b.o.b": {
    artistName: "B.o.B",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "benson boone": {
    artistName: "Benson Boone",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  bleachers: {
    artistName: "Bleachers",
    suggestedGenres: ["alternative", "pop", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "blessid union of souls": {
    artistName: "Blessid Union Of Souls",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "blood, sweat & tears": {
    artistName: "Blood, Sweat & Tears",
    suggestedGenres: ["rock", "jazz", "soul"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "carly rae jepsen": {
    artistName: "Carly Rae Jepsen",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "chaka khan": {
    artistName: "Chaka Khan",
    suggestedGenres: ["soul", "rb", "dance"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "colbie caillat": {
    artistName: "Colbie Caillat",
    suggestedGenres: ["pop", "folk", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "david gray": {
    artistName: "David Gray",
    suggestedGenres: ["folk", "singer_songwriter"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "dermot kennedy": {
    artistName: "Dermot Kennedy",
    suggestedGenres: ["folk", "pop", "singer_songwriter"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  eve: {
    artistName: "Eve",
    suggestedGenres: ["hiphop", "rb"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "fetty wap": {
    artistName: "Fetty Wap",
    suggestedGenres: ["hiphop", "rb"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "fine young cannibals": {
    artistName: "Fine Young Cannibals",
    suggestedGenres: ["newwave", "pop", "soul"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "foster the people": {
    artistName: "Foster The People",
    suggestedGenres: ["alternative", "pop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "gavin degraw": {
    artistName: "Gavin DeGraw",
    suggestedGenres: ["pop", "rock", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "go west": {
    artistName: "Go West",
    suggestedGenres: ["newwave", "pop"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  hanson: {
    artistName: "Hanson",
    suggestedGenres: ["pop", "rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "hot chocolate": {
    artistName: "Hot Chocolate",
    suggestedGenres: ["soul", "pop"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "irene cara": {
    artistName: "Irene Cara",
    suggestedGenres: ["pop", "dance", "soundtrack"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "james blunt": {
    artistName: "James Blunt",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "jesse mccartney": {
    artistName: "Jesse McCartney",
    suggestedGenres: ["pop", "rb"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "jessie j": {
    artistName: "Jessie J",
    suggestedGenres: ["pop", "soul", "rb"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "john parr": {
    artistName: "John Parr",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "jon batiste": {
    artistName: "Jon Batiste",
    suggestedGenres: ["jazz", "soul"],
    suggestedPlaylistCode: "jazz",
    confidence: "high",
  },
  "julia michaels": {
    artistName: "Julia Michaels",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "k.flay": {
    artistName: "K.Flay",
    suggestedGenres: ["alternative", "hiphop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "kim wilde": {
    artistName: "Kim Wilde",
    suggestedGenres: ["newwave", "pop"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "kings of leon": {
    artistName: "Kings of Leon",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "la roux": {
    artistName: "La Roux",
    suggestedGenres: ["electronic", "pop", "dance"],
    suggestedPlaylistCode: "electronic",
    confidence: "high",
  },
  latto: {
    artistName: "Latto",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  lauv: {
    artistName: "Lauv",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  lmfao: {
    artistName: "LMFAO",
    suggestedGenres: ["dance", "hiphop", "electronic"],
    suggestedPlaylistCode: "dance",
    confidence: "high",
  },
  lorde: {
    artistName: "Lorde",
    suggestedGenres: ["pop", "alternative", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  måneskin: {
    artistName: "Måneskin",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  mika: {
    artistName: "MIKA",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "mr. mister": {
    artistName: "Mr. Mister",
    suggestedGenres: ["rock", "pop", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "new radicals": {
    artistName: "New Radicals",
    suggestedGenres: ["rock", "alternative", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "noah kahan": {
    artistName: "Noah Kahan",
    suggestedGenres: ["folk", "singer_songwriter"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "pharrell williams": {
    artistName: "Pharrell Williams",
    suggestedGenres: ["pop", "hiphop", "soul"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "rachel platten": {
    artistName: "Rachel Platten",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "rick astley": {
    artistName: "Rick Astley",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "robert plant": {
    artistName: "Robert Plant",
    suggestedGenres: ["rock", "blues"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  semisonic: {
    artistName: "Semisonic",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "sheena easton": {
    artistName: "Sheena Easton",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "sinéad o'connor": {
    artistName: "Sinéad O'Connor",
    suggestedGenres: ["alternative", "pop", "singer_songwriter"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "sister hazel": {
    artistName: "Sister Hazel",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "sixpence none the richer": {
    artistName: "Sixpence None The Richer",
    suggestedGenres: ["pop", "rock", "alternative"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "tone-loc": {
    artistName: "Tone-Loc",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "vertical horizon": {
    artistName: "Vertical Horizon",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "wiz khalifa": {
    artistName: "Wiz Khalifa",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "young mc": {
    artistName: "Young MC",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  yungblud: {
    artistName: "YUNGBLUD",
    suggestedGenres: ["alternative", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "jac ross": {
    artistName: "Jac Ross",
    suggestedGenres: ["soul", "rb"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  michigander: {
    artistName: "Michigander",
    suggestedGenres: ["alternative", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "the 5 heartbeats": {
    artistName: "The 5 Heartbeats",
    suggestedGenres: ["soul", "soundtrack"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  dax: {
    artistName: "Dax",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "dirty honey": {
    artistName: "Dirty Honey",
    suggestedGenres: ["rock", "blues"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "donnie iris": {
    artistName: "Donnie Iris",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "palaye royale": {
    artistName: "Palaye Royale",
    suggestedGenres: ["alternative", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "ray parker jr.": {
    artistName: "Ray Parker Jr.",
    suggestedGenres: ["soul", "pop", "soundtrack"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "rev theory": {
    artistName: "Rev Theory",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "ruth b.": {
    artistName: "Ruth B.",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "sananda maitreya": {
    artistName: "Sananda Maitreya",
    suggestedGenres: ["soul", "rb", "pop"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  scandal: {
    artistName: "Scandal",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "sly fox": {
    artistName: "Sly Fox",
    suggestedGenres: ["newwave", "pop"],
    suggestedPlaylistCode: "newwave",
    confidence: "high",
  },
  "smith & myers": {
    artistName: "Smith & Myers",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "sophie b. hawkins": {
    artistName: "Sophie B. Hawkins",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the greg kihn band": {
    artistName: "The Greg Kihn Band",
    suggestedGenres: ["rock", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "the tubes": {
    artistName: "The Tubes",
    suggestedGenres: ["rock", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "treble charger": {
    artistName: "Treble Charger",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "3oh!3": {
    artistName: "3OH!3",
    suggestedGenres: ["pop", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "adam lambert": {
    artistName: "Adam Lambert",
    suggestedGenres: ["pop", "rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "adam levine": {
    artistName: "Adam Levine",
    suggestedGenres: ["pop", "rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  anastacia: {
    artistName: "Anastacia",
    suggestedGenres: ["pop", "soul"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "ben harper and the innocent criminals": {
    artistName: "Ben Harper And The Innocent Criminals",
    suggestedGenres: ["folk", "blues", "soul"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "booker t. & the m.g.'s": {
    artistName: "Booker T. & the M.G.'s",
    suggestedGenres: ["soul", "blues"],
    suggestedPlaylistCode: "soul",
    confidence: "high",
  },
  "cardi b": {
    artistName: "Cardi B",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "carly simon": {
    artistName: "Carly Simon",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  ciara: {
    artistName: "Ciara",
    suggestedGenres: ["rb", "pop", "dance"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "coi leray": {
    artistName: "Coi Leray",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "crystal waters": {
    artistName: "Crystal Waters",
    suggestedGenres: ["dance", "electronic"],
    suggestedPlaylistCode: "dance",
    confidence: "high",
  },
  "debbie gibson": {
    artistName: "Debbie Gibson",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "deep blue something": {
    artistName: "Deep Blue Something",
    suggestedGenres: ["rock", "alternative"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "del the funky homosapien": {
    artistName: "Del The Funky Homosapien",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "diana king": {
    artistName: "Diana King",
    suggestedGenres: ["rb", "pop"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  divinyls: {
    artistName: "Divinyls",
    suggestedGenres: ["rock", "newwave"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "dj khaled": {
    artistName: "DJ Khaled",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "don mclean": {
    artistName: "Don McLean",
    suggestedGenres: ["folk", "singer_songwriter"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "eagle-eye cherry": {
    artistName: "Eagle-Eye Cherry",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "eddy grant": {
    artistName: "Eddy Grant",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "everything but the girl": {
    artistName: "Everything But The Girl",
    suggestedGenres: ["electronic", "pop"],
    suggestedPlaylistCode: "electronic",
    confidence: "high",
  },
  "far east movement": {
    artistName: "Far East Movement",
    suggestedGenres: ["dance", "hiphop", "electronic"],
    suggestedPlaylistCode: "dance",
    confidence: "high",
  },
  feist: {
    artistName: "Feist",
    suggestedGenres: ["folk", "singer_songwriter"],
    suggestedPlaylistCode: "folk",
    confidence: "high",
  },
  "fifth harmony": {
    artistName: "Fifth Harmony",
    suggestedGenres: ["pop", "rb"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  gorillaz: {
    artistName: "Gorillaz",
    suggestedGenres: ["alternative", "electronic", "hiphop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "gracie abrams": {
    artistName: "Gracie Abrams",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  gayle: {
    artistName: "GAYLE",
    suggestedGenres: ["pop", "alternative"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "dominic fike": {
    artistName: "Dominic Fike",
    suggestedGenres: ["alternative", "pop"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "imogen heap": {
    artistName: "Imogen Heap",
    suggestedGenres: ["electronic", "pop"],
    suggestedPlaylistCode: "electronic",
    confidence: "high",
  },
  "ingrid michaelson": {
    artistName: "Ingrid Michaelson",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "jeff buckley": {
    artistName: "Jeff Buckley",
    suggestedGenres: ["rock", "singer_songwriter"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  "jennifer lopez": {
    artistName: "Jennifer Lopez",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "kacey musgraves": {
    artistName: "Kacey Musgraves",
    suggestedGenres: ["country", "folk"],
    suggestedPlaylistCode: "country",
    confidence: "high",
  },
  kehlani: {
    artistName: "Kehlani",
    suggestedGenres: ["rb", "pop"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  kelis: {
    artistName: "Kelis",
    suggestedGenres: ["rb", "pop", "dance"],
    suggestedPlaylistCode: "rb",
    confidence: "high",
  },
  "megan thee stallion": {
    artistName: "Megan Thee Stallion",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "m.i.a.": {
    artistName: "M.I.A.",
    suggestedGenres: ["hiphop", "electronic"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "mike posner": {
    artistName: "Mike Posner",
    suggestedGenres: ["pop", "electronic"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "noah cyrus": {
    artistName: "Noah Cyrus",
    suggestedGenres: ["pop", "country"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "ok go": {
    artistName: "OK Go",
    suggestedGenres: ["alternative", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "paul mccartney": {
    artistName: "Paul McCartney",
    suggestedGenres: ["rock", "pop"],
    suggestedPlaylistCode: "rock",
    confidence: "high",
  },
  pitbull: {
    artistName: "Pitbull",
    suggestedGenres: ["pop", "hiphop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "shawn mendes": {
    artistName: "Shawn Mendes",
    suggestedGenres: ["pop", "singer_songwriter"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "silversun pickups": {
    artistName: "Silversun Pickups",
    suggestedGenres: ["alternative", "rock"],
    suggestedPlaylistCode: "alternative",
    confidence: "high",
  },
  "the 1975": {
    artistName: "The 1975",
    suggestedGenres: ["pop", "alternative"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "the fray": {
    artistName: "The Fray",
    suggestedGenres: ["pop", "rock"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  timbaland: {
    artistName: "Timbaland",
    suggestedGenres: ["hiphop", "rb"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "vanilla ice": {
    artistName: "Vanilla Ice",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "zara larsson": {
    artistName: "Zara Larsson",
    suggestedGenres: ["pop", "dance"],
    suggestedPlaylistCode: "pop",
    confidence: "high",
  },
  "french montana": {
    artistName: "French Montana",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "iggy azalea": {
    artistName: "Iggy Azalea",
    suggestedGenres: ["hiphop", "pop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "house of pain": {
    artistName: "House Of Pain",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
  "kris kross": {
    artistName: "Kris Kross",
    suggestedGenres: ["hiphop"],
    suggestedPlaylistCode: "hiphop",
    confidence: "high",
  },
};

function normalizeArtistName(artistName) {
  return artistName.trim().toLowerCase();
}

function getCuratedArtistSuggestion(artistName) {
  const suggestion = CURATED_ARTIST_SUGGESTIONS[normalizeArtistName(artistName || "")];

  if (!suggestion) {
    return null;
  }

  return {
    artistName: suggestion.artistName,
    suggestedGenres: suggestion.suggestedGenres,
    suggestedPlaylistCode: suggestion.suggestedPlaylistCode,
    confidence: suggestion.confidence,
    source: "curated_seed",
  };
}

function getCuratedSuggestionList() {
  return Object.values(CURATED_ARTIST_SUGGESTIONS).map((suggestion) => ({
    artistName: suggestion.artistName,
    suggestedGenres: suggestion.suggestedGenres,
    suggestedPlaylistCode: suggestion.suggestedPlaylistCode,
    confidence: suggestion.confidence,
    source: "curated_seed",
  }));
}

function toSuggestionResponse(suggestion, existingCount) {
  return {
    artist_name: suggestion.artistName,
    suggested_genres: suggestion.suggestedGenres,
    suggested_playlist_code: suggestion.suggestedPlaylistCode,
    confidence: suggestion.confidence,
    source: suggestion.source,
    applied: existingCount >= suggestion.suggestedGenres.length,
  };
}

function normalizeStatus(value) {
  if (value === "applied" || value === "all") {
    return value;
  }

  return "unapplied";
}

function getArtistGenreSuggestions(options = {}) {
  const status = normalizeStatus(options.status);
  const suggestions = getCuratedSuggestionList();
  const existingCounts = artistGenreRepo.countExistingSuggestedGenres(suggestions);
  const artists = suggestions
    .map((suggestion) =>
      toSuggestionResponse(suggestion, existingCounts.get(suggestion.artistName) || 0),
    )
    .filter((suggestion) => {
      if (status === "all") return true;
      if (status === "applied") return suggestion.applied;
      return !suggestion.applied;
    });

  return {
    status,
    count: artists.length,
    artists,
  };
}

function applyHighConfidenceArtistGenreSuggestions() {
  const suggestions = getCuratedSuggestionList().filter(
    (suggestion) => suggestion.confidence === "high",
  );
  const existingCounts = artistGenreRepo.countExistingSuggestedGenres(suggestions);
  let artistsApplied = 0;
  let genresInserted = 0;
  let skippedExisting = 0;

  for (const suggestion of suggestions) {
    const existingCount = existingCounts.get(suggestion.artistName) || 0;

    if (existingCount >= suggestion.suggestedGenres.length) {
      skippedExisting += suggestion.suggestedGenres.length;
      continue;
    }

    const result = artistGenreRepo.insertArtistGenres({
      artistName: suggestion.artistName,
      genres: suggestion.suggestedGenres,
      source: suggestion.source,
    });

    if (result.inserted > 0) {
      artistsApplied += 1;
      genresInserted += result.inserted;
    }

    skippedExisting += suggestion.suggestedGenres.length - result.inserted;
  }

  return {
    artists_applied: artistsApplied,
    genres_inserted: genresInserted,
    skipped_existing: skippedExisting,
  };
}

async function getMissingArtistGenreSuggestions(userId, options = {}) {
  const result = await getMissingArtistGenres(userId, options);

  return {
    ...result,
    artists: result.artists.map((artist) => {
      const suggestion = getCuratedArtistSuggestion(artist.artist_name);

      return {
        ...artist,
        suggested_genres: suggestion?.suggestedGenres || null,
        suggested_playlist_code: suggestion?.suggestedPlaylistCode || null,
        confidence: suggestion?.confidence || null,
        source: suggestion?.source || null,
      };
    }),
  };
}

module.exports = {
  applyHighConfidenceArtistGenreSuggestions,
  CURATED_ARTIST_SUGGESTIONS,
  getArtistGenreSuggestions,
  getCuratedArtistSuggestion,
  getMissingArtistGenreSuggestions,
};
