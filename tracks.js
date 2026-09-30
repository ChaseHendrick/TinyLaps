import { createCityPlan } from './city.js';

// Shared circuit definitions. Distances and coordinates use meters.
export const TRACKS = {
  harbor: {name:'Pebble Bay',sub:'PEBBLE BAY CIRCUIT',grass:0x91b889,sand:0xd8c19a,water:0x8cc4c8,sky:0xe3eeee,sun:0xffedd2,points:[[-45,.17,25],[-29,.17,32],[-6,.17,27],[12,.17,34],[39,.17,24],[47,.17,7],[34,2,-10],[23,3,-23],[5,.17,-28],[-13,.17,-18],[-29,.17,-29],[-47,.17,-18],[-50,.17,4]]},
  alpine: {name:'Clover Hills',sub:'CLOVER HILLS CIRCUIT',grass:0x9caf7e,sand:0xcfc2a3,water:0x87b4bd,sky:0xe9ede4,sun:0xfff1d4,points:[[-42,.17,26],[-22,.17,34],[1,.17,27],[25,.17,33],[44,.17,17],[46,.17,-3],[31,.17,-23],[9,.17,-25],[-6,.17,-12],[-24,.17,-20],[-43,.17,-22],[-49,.17,-3]]},
  sunset: {name:'Sundown Valley',sub:'SUNDOWN CIRCUIT',grass:0xb0a16e,sand:0xd7b387,water:0xaaadaf,sky:0xf0dbca,sun:0xffc89c,points:[[-46,.17,22],[-26,.17,31],[-4,.17,24],[14,.17,33],[37,.17,25],[47,.17,5],[39,.17,-17],[20,.17,-28],[0,.17,-22],[-15,.17,-28],[-39,.17,-20],[-48,.17,-2]]}
};

// Every addition has its own centerline, rather than recoloring the same loop.
// The original three islands remain available at the top of the chooser.
const additions = [
  ['meadow', 'Meadow Oval', 'alpine', 'Easy', 'A flowing oval with two broad turns and long passing lanes.', [[-40,18],[-22,29],[20,29],[41,17],[44,0],[34,-24],[0,-30],[-34,-24],[-44,0]]],
  ['orchard', 'Orchard Square', 'harbor', 'Easy', 'Four rounded corners around a quiet orchard village.', [[-39,26],[0,29],[38,26],[44,12],[43,-16],[30,-29],[0,-30],[-32,-27],[-44,-12],[-44,13]]],
  ['crescent', 'Crescent Cove', 'harbor', 'Technical', 'A deep inlet pulls the middle of the circuit into a long sweeping bend.', [[-45,23],[-20,31],[7,29],[38,22],[48,0],[32,-25],[9,-31],[-2,-19],[16,-6],[4,6],[-21,-2],[-41,-22],[-49,-2]]],
  ['switchback', 'Fern Switchbacks', 'alpine', 'Technical', 'Three linked direction changes reward patient braking.', [[-44,24],[-22,32],[5,29],[36,25],[46,10],[33,-5],[14,2],[-2,-8],[15,-25],[-5,-32],[-29,-26],[-45,-9]]],
  ['teardrop', 'Lantern Point', 'sunset', 'Flowing', 'A pointed eastern turn opens into a wide western sweep.', [[-40,23],[-14,32],[17,23],[46,0],[20,-22],[-11,-32],[-37,-22],[-48,-2]]],
  ['clover', 'Lucky Clover', 'alpine', 'Technical', 'Three soft lobes with an inward turn between each one.', [[-46,0],[-37,22],[-17,28],[-2,16],[17,29],[38,23],[47,2],[32,-10],[24,-29],[2,-34],[-19,-27],[-25,-10]]],
  ['sprint', 'Seabreeze Sprint', 'harbor', 'Fast', 'A short, narrow stadium loop built for close racing.', [[-40,15],[-23,23],[23,23],[41,12],[43,-3],[27,-20],[-23,-20],[-42,-7]]],
  ['ridge', 'Highland Ribbon', 'alpine', 'Flowing', 'Two elevated ridges and a broad valley section change the pace.', [[-43,20],[-22,30],[6,26],[32,28],[44,12],[35,-10],[15,-24],[-4,-17],[-23,-30],[-43,-19],[-49,0]]],
  ['lagoon', 'Lagoon Keyhole', 'harbor', 'Technical', 'A wide western bulb joins a narrow eastern loop through two sweeping bends.', [[-44,0],[-39,20],[-20,30],[0,22],[8,9],[38,13],[48,0],[36,-13],[8,-9],[0,-23],[-22,-30],[-40,-20]]],
  ['amber', 'Amber Chicane', 'sunset', 'Technical', 'A fast outer sweep meets a distinct double bend on the eastern straight.', [[-45,22],[-23,30],[6,30],[29,24],[39,11],[29,0],[43,-14],[28,-29],[0,-31],[-25,-25],[-46,-7]]],
  ['summit', 'Summit Loop', 'alpine', 'Flowing', 'A rounded triangular circuit climbs to its northern summit.', [[-44,20],[-22,29],[14,27],[43,13],[39,-6],[21,-24],[0,-33],[-20,-24],[-42,-4]]],
  ['dusk', 'Dusk Run', 'sunset', 'Fast', 'A long diagonal straight leads into an off-center southern bend under evening light.', [[-44,18],[-25,30],[7,27],[39,12],[46,-6],[27,-27],[5,-28],[-9,-12],[-28,-25],[-44,-8]]],
];
for (const [key, name, setting, difficulty, description, outline] of additions) {
  const original = TRACKS[setting];
  const points = outline.map(([x,z],i) => [x, key==='ridge' && (i===2 || i===3) ? 2.6 : key==='summit' && i===6 ? 2.3 : .17, z]);
  TRACKS[key] = { ...original, name, sub:name.toUpperCase()+' CIRCUIT', setting, difficulty, description, seed:31+Object.keys(TRACKS).length*19, points };
}
Object.assign(TRACKS.harbor,{setting:'harbor',difficulty:'Flowing',description:'A coastal village, river bridge, lighthouse and sailboats.',river:true,seed:17});
Object.assign(TRACKS.alpine,{setting:'alpine',difficulty:'Flowing',description:'Rounded peaks, forest and a winding hillside circuit.',seed:17});
Object.assign(TRACKS.sunset,{setting:'sunset',difficulty:'Flowing',description:'Warm evening light over a gently winding valley.',seed:17});

// City worlds have connected side streets and several distinct districts.
const cities=[
 ['foundry','Foundry City','harbor','A dense grid of apartment blocks, a downtown skyline, neighborhood parks, and busy side streets.',{xs:[-40,-24,-8,8,24,40],zs:[-28,-14,0,14,28],width:7,warp:0,parks:[[1,1],[3,2]],style:'modern',residents:108,traffic:28,seed:911},[[0,1],[4,1],[4,0],[5,0],[5,4],[3,4],[3,2],[2,2],[2,4],[0,4],[0,3],[1,3],[1,2],[0,2]]],
 ['oldquarter','Old Quarter','sunset','A close-knit old city with irregular streets, tiled roofs, market squares, and clustered neighborhoods.',{xs:[-41,-25,-10,5,21,39],zs:[-28,-15,-1,13,28],width:7,warp:2.2,parks:[[2,1]],style:'historic',residents:108,traffic:26,seed:1441},[[0,1],[4,1],[4,0],[5,0],[5,4],[3,4],[3,2],[2,2],[2,4],[0,4],[0,3],[1,3],[1,2],[0,2]]],
 ['gardenmetro','Garden Metro','alpine','Three lively districts around broad boulevards, a central garden, and a compact business center.',{xs:[-40,-22,-4,14,36],zs:[-28,-13,3,18,29],width:7,warp:-1.1,parks:[[1,1],[2,1]],style:'garden',residents:108,traffic:24,seed:2077},[[0,1],[3,1],[3,0],[4,0],[4,4],[2,4],[2,2],[1,2],[1,4],[0,4]]]
];
for(const [key,name,setting,description,city,route] of cities){const plan=createCityPlan(city);TRACKS[key]={...TRACKS[setting],river:false,name,sub:name.toUpperCase()+' STREET RACE',setting,description:description+' The racers turn through the city streets.',difficulty:'City',seed:city.seed,city,routeRevision:2,points:route.map(([i,j])=>{const n=plan.nodes[j*city.xs.length+i];return[n.x,.18,n.z];})};}
