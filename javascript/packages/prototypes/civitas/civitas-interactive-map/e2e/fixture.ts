// The `assets/countries.json` the screenshot tests serve. Each country is a disc of provinces on its own landmass:
// - Aurelia: centroids within 260 px of (1460, 1100), the western landmass.
// - Borealis: centroids within 260 px of (2740, 800), the north-eastern landmass.
// - Calderra: centroids within 240 px of (2480, 1830), the southern landmass.
// Ids come from `assets/provinces_manifest.json`.

type FixtureCountry = {
  id: number;
  name: string;
  slogan: string;
  flagDataUrl: string;
  provinceIds: number[];
  colorHex: string;
};

type CountriesFixture = {
  format: string;
  version: number;
  countries: FixtureCountry[];
};

function svgFlag(top: string, middle: string, bottom: string): string {
  const svg =
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"60\" height=\"40\" viewBox=\"0 0 3 3\" preserveAspectRatio=\"none\">" +
    "<rect width=\"3\" height=\"1\" y=\"0\" fill=\"" + top + "\"/>" +
    "<rect width=\"3\" height=\"1\" y=\"1\" fill=\"" + middle + "\"/>" +
    "<rect width=\"3\" height=\"1\" y=\"2\" fill=\"" + bottom + "\"/>" +
    "</svg>";
  return "data:image/svg+xml;base64," + btoa(svg);
}

const AURELIA_IDS = [
  431, 448, 455, 461, 477, 489, 491, 495, 496, 503, 511, 513, 523, 532, 535, 545, 552, 558, 559,
  560, 563, 567, 568, 570, 573, 578, 582, 585, 587, 594, 596, 597, 606, 614, 616, 618, 626, 629,
  635, 636, 639, 649, 654, 657, 658, 663, 667, 678, 684, 689, 690, 693, 695, 697, 699, 701, 708,
  716, 723, 726, 728, 742, 751, 756, 760, 761, 763, 773, 775, 781, 785, 790, 796, 808, 811, 818,
  827, 838, 843, 849, 854, 876, 883, 890, 892, 910, 911, 912, 922, 923, 929, 938, 946, 954, 967,
  968, 977, 978, 994, 1000, 1012, 1013, 1026,
];

const BOREALIS_IDS = [
  112, 115, 116, 123, 124, 130, 131, 142, 159, 161, 169, 176, 177, 180, 186, 191, 194, 196, 198,
  210, 216, 220, 222, 224, 236, 237, 239, 243, 247, 251, 255, 257, 258, 259, 265, 266, 269, 272,
  274, 285, 290, 292, 293, 297, 298, 299, 302, 304, 308, 311, 312, 317, 325, 326, 327, 330, 331,
  335, 338, 342, 343, 344, 346, 347, 351, 354, 356, 362, 367, 372, 373, 374, 376, 377, 387, 389,
  395, 399, 404, 405, 408, 409, 413, 421, 422, 426, 430, 432, 436, 438, 441, 443, 444, 449, 451,
  453, 459, 466, 469, 470, 475, 476, 478, 482, 483, 486, 488, 492, 494, 499, 510, 512, 515, 516,
  520, 525, 528, 531, 533, 534, 537, 546, 547, 548, 553, 556, 576, 577, 592, 599, 608, 617, 624,
  627, 647,
];

const CALDERRA_IDS = [
  1273, 1287, 1288, 1290, 1305, 1312, 1315, 1320, 1321, 1327, 1328, 1331, 1334, 1336, 1341, 1345,
  1350, 1351, 1352, 1355, 1356, 1357, 1358, 1361, 1363, 1368, 1370, 1375, 1377, 1378, 1381, 1383,
  1384, 1386, 1387, 1389, 1391, 1392, 1397, 1399, 1400, 1401, 1402, 1404, 1405, 1408, 1410, 1412,
  1415, 1416, 1417, 1419, 1422, 1424, 1425, 1428, 1430, 1435, 1440, 1441, 1442, 1443, 1446, 1448,
  1449, 1450, 1451, 1454, 1455, 1459, 1461, 1462, 1463, 1464, 1467, 1468, 1469, 1470, 1473, 1474,
  1475, 1480, 1481, 1482, 1484, 1485, 1486, 1491, 1492, 1496, 1497, 1499, 1503, 1504, 1505, 1509,
  1510, 1511, 1513, 1514, 1516, 1520, 1522, 1526, 1527, 1529, 1530, 1533, 1534, 1537,
];

function createFixtureCountries(): CountriesFixture {
  return {
    format: "civitas.countries",
    version: 1,
    countries: [
      {
        id: 1,
        name: "Aurelia",
        slogan: "Gold in the hills",
        flagDataUrl: svgFlag("#c0563f", "#f2d27a", "#c0563f"),
        provinceIds: AURELIA_IDS,
        colorHex: "#c0563f",
      },
      {
        id: 2,
        name: "Borealis",
        slogan: "North of everything",
        flagDataUrl: svgFlag("#4f7fb5", "#ffffff", "#2d4a6b"),
        provinceIds: BOREALIS_IDS,
        colorHex: "#4f7fb5",
      },
      {
        id: 3,
        name: "Calderra",
        slogan: "Fire under the fields",
        flagDataUrl: svgFlag("#6f9e57", "#2f2f2f", "#6f9e57"),
        provinceIds: CALDERRA_IDS,
        colorHex: "#6f9e57",
      },
    ],
  };
}

// The shipped file: no countries yet.
function createEmptyCountries(): CountriesFixture {
  return { format: "civitas.countries", version: 1, countries: [] };
}

// The `assets/countries-info.json` the screenshot tests serve. Aurelia has the whole
// form and an economy, Borealis a form without an economy, Calderra no entry.
// The economy covers every visual state: an `other` sector, growth, decline and
// zero, a surplus, a deficit and a zero resource balance.
function createFixtureCountryInfo(): object {
  return {
    format: "civitas.countries-info",
    version: 1,
    countries: [
      {
        countryId: 1,
        profile: {
          capital: "Aurum",
          region: "Western Reach",
          history: "Aurelia began as a league of mining towns in the western hills. " +
            "The towns bought their charters from a bankrupt crown and elected a council of guilds. " +
            "Two hundred years later the council still meets in the old assay hall of Aurum. " +
            "It has survived three peasant risings and one long war over the river fords.",
          culture: "Gold leaf on every door frame, long harvest feasts and a love of written contracts.",
          religion: "The Church of the Deep Vein",
          government: "Guild republic",
          democraticElections: true,
          ideology: "Mercantilism",
        },
        economy: {
          year: 1912,
          gdp: 84200,
          growthPct: 3.4,
          sectors: [
            { kind: "agriculture", volume: 12600, growthPct: 1.1 },
            { kind: "lightIndustry", volume: 18500, growthPct: 3 },
            { kind: "heavyIndustry", volume: 24400, growthPct: 4.8 },
            { kind: "commerce", volume: 15200, growthPct: 0 },
            { kind: "extraction", volume: 10100, growthPct: -0.5 },
            { kind: "other", title: "Clockwork", volume: 3400, growthPct: 7.2 },
          ],
          creditRating: "B",
          stateControl: 62,
          emissionPct: 1,
          militarySpendingPct: 6.5,
          fs: 1240,
          vpk: 380,
          fsReserve: 600,
          vpkStockpile: 150,
          resources: [
            { title: "Coal", balance: 40 },
            { title: "Oil", balance: -25 },
            { title: "Fibre", balance: 10 },
            { title: "Iron", balance: 0 },
            { title: "Copper", balance: -15 },
            { title: "Rubber", balance: -30 },
            { title: "Chemicals", balance: 20 },
            { title: "Gems", balance: 5 },
          ],
        },
      },
      {
        countryId: 2,
        profile: {
          capital: "Frostgate",
          region: "",
          history: "",
          culture: "",
          religion: "",
          government: "Elective monarchy",
          democraticElections: false,
          ideology: "",
        },
        economy: null,
      },
    ],
  };
}

function createEmptyCountryInfo(): object {
  return { format: "civitas.countries-info", version: 1, countries: [] };
}

export {
  createEmptyCountries,
  createEmptyCountryInfo,
  createFixtureCountries,
  createFixtureCountryInfo,
  type CountriesFixture,
};
