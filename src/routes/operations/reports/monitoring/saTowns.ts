// Town-level coordinates for South African towns and cities, used to place a
// centre on the map when no exact location has been captured for it. Coordinates
// are town centres from OpenStreetMap (ODbL), looked up once, checked
// against each town's province, and are deliberately approximate.
export type SaTown = {
    name: string;
    province: string;
    lat: number;
    lon: number;
};

export const SA_TOWNS: SaTown[] = [
    { name: "Johannesburg", province: "Gauteng", lat: -26.205, lon: 28.0497 },
    { name: "Pretoria", province: "Gauteng", lat: -25.7459, lon: 28.1879 },
    { name: "Soweto", province: "Gauteng", lat: -26.2228, lon: 27.89 },
    { name: "Springs", province: "Gauteng", lat: -26.255, lon: 28.4373 },
    { name: "Benoni", province: "Gauteng", lat: -26.193, lon: 28.3082 },
    { name: "Germiston", province: "Gauteng", lat: -26.2294, lon: 28.1806 },
    { name: "Krugersdorp", province: "Gauteng", lat: -26.0956, lon: 27.7756 },
    { name: "Randfontein", province: "Gauteng", lat: -26.1736, lon: 27.6942 },
    { name: "Vereeniging", province: "Gauteng", lat: -26.6747, lon: 27.9261 },
    { name: "Vanderbijlpark", province: "Gauteng", lat: -26.7069, lon: 27.8363 },
    { name: "Khutsong", province: "Gauteng", lat: -26.3236, lon: 27.3206 },
    { name: "Carletonville", province: "Gauteng", lat: -26.3614, lon: 27.4019 },
    { name: "Tembisa", province: "Gauteng", lat: -26.0096, lon: 28.2314 },
    { name: "Midrand", province: "Gauteng", lat: -25.9993, lon: 28.1259 },
    { name: "Centurion", province: "Gauteng", lat: -25.8364, lon: 28.1803 },
    { name: "Boksburg", province: "Gauteng", lat: -26.2125, lon: 28.2617 },
    { name: "Kempton Park", province: "Gauteng", lat: -26.0964, lon: 28.2336 },
    { name: "Sebokeng", province: "Gauteng", lat: -26.5603, lon: 27.8625 },
    { name: "Mamelodi", province: "Gauteng", lat: -25.7158, lon: 28.3808 },
    { name: "Soshanguve", province: "Gauteng", lat: -25.5264, lon: 28.0994 },
    { name: "Alberton", province: "Gauteng", lat: -26.267, lon: 28.1221 },
    { name: "Roodepoort", province: "Gauteng", lat: -26.1567, lon: 27.8856 },
    { name: "Bronkhorstspruit", province: "Gauteng", lat: -25.8081, lon: 28.7414 },
    { name: "Heidelberg", province: "Gauteng", lat: -26.4972, lon: 28.3592 },
    { name: "Nigel", province: "Gauteng", lat: -26.426, lon: 28.4704 },
    { name: "Rustenburg", province: "North West", lat: -25.6657, lon: 27.2414 },
    { name: "Klerksdorp", province: "North West", lat: -26.8625, lon: 26.6657 },
    { name: "Mahikeng", province: "North West", lat: -25.8636, lon: 25.6586 },
    { name: "Potchefstroom", province: "North West", lat: -26.7078, lon: 27.0958 },
    { name: "Brits", province: "North West", lat: -25.6297, lon: 27.7842 },
    { name: "Vryburg", province: "North West", lat: -26.9553, lon: 24.7301 },
    { name: "Lichtenburg", province: "North West", lat: -26.1499, lon: 26.1593 },
    { name: "Setlagole", province: "North West", lat: -26.2746, lon: 25.1247 },
    { name: "Zeerust", province: "North West", lat: -25.5377, lon: 26.0744 },
    { name: "Orkney", province: "North West", lat: -26.9753, lon: 26.6719 },
    { name: "Stilfontein", province: "North West", lat: -26.843, lon: 26.7832 },
    { name: "Jouberton", province: "North West", lat: -26.8933, lon: 26.605 },
    { name: "Taung", province: "North West", lat: -27.5533, lon: 24.7663 },
    { name: "Christiana", province: "North West", lat: -27.9136, lon: 25.1646 },
    { name: "Wolmaransstad", province: "North West", lat: -27.2005, lon: 25.9799 },
    { name: "Koster", province: "North West", lat: -25.8594, lon: 26.8972 },
    { name: "Mogwase", province: "North West", lat: -25.2761, lon: 27.2158 },
    { name: "Bloemfontein", province: "Free State", lat: -29.1164, lon: 26.2155 },
    { name: "Welkom", province: "Free State", lat: -27.9823, lon: 26.738 },
    { name: "Bethlehem", province: "Free State", lat: -28.2308, lon: 28.3089 },
    { name: "Kroonstad", province: "Free State", lat: -27.6533, lon: 27.2355 },
    { name: "Sasolburg", province: "Free State", lat: -26.8103, lon: 27.8214 },
    { name: "Harrismith", province: "Free State", lat: -28.2784, lon: 29.1332 },
    { name: "Phuthaditjhaba", province: "Free State", lat: -28.5342, lon: 28.8163 },
    { name: "Botshabelo", province: "Free State", lat: -29.2324, lon: 26.7333 },
    { name: "Thaba Nchu", province: "Free State", lat: -29.1979, lon: 26.8322 },
    { name: "Virginia", province: "Free State", lat: -28.1031, lon: 26.8594 },
    { name: "Parys", province: "Free State", lat: -26.9044, lon: 27.4561 },
    { name: "Ficksburg", province: "Free State", lat: -28.8737, lon: 27.8794 },
    { name: "Odendaalsrus", province: "Free State", lat: -27.8742, lon: 26.6853 },
    { name: "Frankfort", province: "Free State", lat: -27.2788, lon: 28.4978 },
    { name: "Ladybrand", province: "Free State", lat: -29.1927, lon: 27.4576 },
    { name: "Polokwane", province: "Limpopo", lat: -23.9058, lon: 29.4614 },
    { name: "Thohoyandou", province: "Limpopo", lat: -22.9676, lon: 30.4597 },
    { name: "Lephalale", province: "Limpopo", lat: -23.6833, lon: 27.7333 },
    { name: "Mokopane", province: "Limpopo", lat: -24.1833, lon: 29.0167 },
    { name: "Tzaneen", province: "Limpopo", lat: -23.8319, lon: 30.1611 },
    { name: "Musina", province: "Limpopo", lat: -22.3454, lon: 30.0269 },
    { name: "Giyani", province: "Limpopo", lat: -23.3153, lon: 30.7256 },
    { name: "Phalaborwa", province: "Limpopo", lat: -23.9485, lon: 31.1376 },
    { name: "Bela-Bela", province: "Limpopo", lat: -24.8806, lon: 28.2905 },
    { name: "Modimolle", province: "Limpopo", lat: -24.7011, lon: 28.4089 },
    { name: "Louis Trichardt", province: "Limpopo", lat: -23.0383, lon: 29.9067 },
    { name: "Burgersfort", province: "Limpopo", lat: -24.6736, lon: 30.3283 },
    { name: "Seshego", province: "Limpopo", lat: -23.8494, lon: 29.3894 },
    { name: "Lebowakgomo", province: "Limpopo", lat: -24.3148, lon: 29.4812 },
    { name: "Jane Furse", province: "Limpopo", lat: -24.7654, lon: 29.8649 },
    { name: "Mbombela", province: "Mpumalanga", lat: -25.4729, lon: 30.9773 },
    { name: "eMalahleni", province: "Mpumalanga", lat: -25.8762, lon: 29.21 },
    { name: "Middelburg", province: "Mpumalanga", lat: -25.7678, lon: 29.4555 },
    { name: "Secunda", province: "Mpumalanga", lat: -26.5161, lon: 29.2028 },
    { name: "Kriel", province: "Mpumalanga", lat: -26.2589, lon: 29.2628 },
    { name: "Ermelo", province: "Mpumalanga", lat: -26.5201, lon: 29.9862 },
    { name: "Standerton", province: "Mpumalanga", lat: -26.9433, lon: 29.2436 },
    { name: "Bushbuckridge", province: "Mpumalanga", lat: -24.8336, lon: 31.0677 },
    { name: "Barberton", province: "Mpumalanga", lat: -25.7822, lon: 31.0475 },
    { name: "Piet Retief", province: "Mpumalanga", lat: -27.0067, lon: 30.8078 },
    { name: "Delmas", province: "Mpumalanga", lat: -26.1461, lon: 28.6836 },
    { name: "Hazyview", province: "Mpumalanga", lat: -25.0442, lon: 31.1284 },
    { name: "White River", province: "Mpumalanga", lat: -25.3264, lon: 31.0144 },
    { name: "KwaMhlanga", province: "Mpumalanga", lat: -25.4262, lon: 28.7045 },
    { name: "Lydenburg", province: "Mpumalanga", lat: -25.0994, lon: 30.4589 },
    { name: "Volksrust", province: "Mpumalanga", lat: -27.3628, lon: 29.8825 },
    { name: "Durban", province: "KwaZulu-Natal", lat: -29.8618, lon: 31.0099 },
    { name: "Pietermaritzburg", province: "KwaZulu-Natal", lat: -29.6, lon: 30.3789 },
    { name: "Richards Bay", province: "KwaZulu-Natal", lat: -28.7708, lon: 32.0578 },
    { name: "Newcastle", province: "KwaZulu-Natal", lat: -27.7545, lon: 29.9326 },
    { name: "Ladysmith", province: "KwaZulu-Natal", lat: -28.558, lon: 29.7817 },
    { name: "Empangeni", province: "KwaZulu-Natal", lat: -28.7461, lon: 31.8972 },
    { name: "Port Shepstone", province: "KwaZulu-Natal", lat: -30.7428, lon: 30.4506 },
    { name: "Vryheid", province: "KwaZulu-Natal", lat: -27.7705, lon: 30.7886 },
    { name: "Ulundi", province: "KwaZulu-Natal", lat: -28.2919, lon: 31.4294 },
    { name: "KwaDukuza", province: "KwaZulu-Natal", lat: -29.3384, lon: 31.2881 },
    { name: "Umlazi", province: "KwaZulu-Natal", lat: -29.9525, lon: 30.9003 },
    { name: "Pinetown", province: "KwaZulu-Natal", lat: -29.8143, lon: 30.8582 },
    { name: "Estcourt", province: "KwaZulu-Natal", lat: -29.0103, lon: 29.8686 },
    { name: "Kokstad", province: "KwaZulu-Natal", lat: -30.5475, lon: 29.4244 },
    { name: "Dundee", province: "KwaZulu-Natal", lat: -28.1614, lon: 30.235 },
    { name: "East London", province: "Eastern Cape", lat: -33.0192, lon: 27.8999 },
    { name: "Gqeberha", province: "Eastern Cape", lat: -33.9619, lon: 25.6187 },
    { name: "Mthatha", province: "Eastern Cape", lat: -31.5896, lon: 28.7878 },
    { name: "Komani", province: "Eastern Cape", lat: -31.8959, lon: 26.871 },
    { name: "Makhanda", province: "Eastern Cape", lat: -33.3071, lon: 26.5263 },
    { name: "Kariega", province: "Eastern Cape", lat: -33.7679, lon: 25.3978 },
    { name: "Qonce", province: "Eastern Cape", lat: -32.8802, lon: 27.3938 },
    { name: "Butterworth", province: "Eastern Cape", lat: -32.332, lon: 28.1445 },
    { name: "Graaff-Reinet", province: "Eastern Cape", lat: -32.2492, lon: 24.5348 },
    { name: "Aliwal North", province: "Eastern Cape", lat: -30.6942, lon: 26.7097 },
    { name: "Cradock", province: "Eastern Cape", lat: -32.1644, lon: 25.6208 },
    { name: "Port Alfred", province: "Eastern Cape", lat: -33.5982, lon: 26.8915 },
    { name: "Mdantsane", province: "Eastern Cape", lat: -32.9323, lon: 27.7426 },
    { name: "Bhisho", province: "Eastern Cape", lat: -32.8494, lon: 27.4464 },
    { name: "Jeffreys Bay", province: "Eastern Cape", lat: -34.0511, lon: 24.9222 },
    { name: "Cape Town", province: "Western Cape", lat: -33.9288, lon: 18.4172 },
    { name: "Grabouw", province: "Western Cape", lat: -34.1531, lon: 19.0139 },
    { name: "Stellenbosch", province: "Western Cape", lat: -33.9344, lon: 18.8692 },
    { name: "Paarl", province: "Western Cape", lat: -33.731, lon: 18.9642 },
    { name: "George", province: "Western Cape", lat: -33.9597, lon: 22.4587 },
    { name: "Worcester", province: "Western Cape", lat: -33.6462, lon: 19.4459 },
    { name: "Mossel Bay", province: "Western Cape", lat: -34.1832, lon: 22.1536 },
    { name: "Knysna", province: "Western Cape", lat: -34.0357, lon: 23.0485 },
    { name: "Oudtshoorn", province: "Western Cape", lat: -33.5903, lon: 22.2042 },
    { name: "Khayelitsha", province: "Western Cape", lat: -34.0406, lon: 18.6674 },
    { name: "Mitchells Plain", province: "Western Cape", lat: -34.0506, lon: 18.6181 },
    { name: "Somerset West", province: "Western Cape", lat: -34.0822, lon: 18.8489 },
    { name: "Hermanus", province: "Western Cape", lat: -34.4175, lon: 19.2361 },
    { name: "Vredenburg", province: "Western Cape", lat: -32.9067, lon: 17.99 },
    { name: "Beaufort West", province: "Western Cape", lat: -32.3536, lon: 22.5806 },
    { name: "Atlantis", province: "Western Cape", lat: -33.5672, lon: 18.5003 },
    { name: "Caledon", province: "Western Cape", lat: -34.23, lon: 19.4283 },
    { name: "Malmesbury", province: "Western Cape", lat: -33.4603, lon: 18.7236 },
    { name: "Kimberley", province: "Northern Cape", lat: -28.7383, lon: 24.7642 },
    { name: "Upington", province: "Northern Cape", lat: -28.4563, lon: 21.2419 },
    { name: "Kuruman", province: "Northern Cape", lat: -27.4602, lon: 23.4348 },
    { name: "Springbok", province: "Northern Cape", lat: -29.6661, lon: 17.8831 },
    { name: "De Aar", province: "Northern Cape", lat: -30.6506, lon: 24.0075 },
    { name: "Kathu", province: "Northern Cape", lat: -27.6958, lon: 23.05 },
    { name: "Postmasburg", province: "Northern Cape", lat: -28.3267, lon: 23.0689 },
    { name: "Calvinia", province: "Northern Cape", lat: -31.4694, lon: 19.7772 },
    { name: "Colesberg", province: "Northern Cape", lat: -30.7211, lon: 25.0967 },
    { name: "Prieska", province: "Northern Cape", lat: -29.6663, lon: 22.7444 },
];

// Branch names that are municipalities or old names, mapped to the town they
// refer to. Keys and values are compared after normalizeTownName.
export const SA_TOWN_ALIASES: Record<string, string> = {
    matlosana: "klerksdorp",
    citjofmatlosana: "klerksdorp",
    mogalecity: "krugersdorp",
    mogale: "krugersdorp",
    ratlou: "setlagole",
    kimberly: "kimberley",
    nelspruit: "mbombela",
    witbank: "emalahleni",
    portelizabeth: "gqeberha",
    queenstown: "komani",
    grahamstown: "makhanda",
    uitenhage: "kariega",
    kingwilliamstown: "qonce",
    stanger: "kwadukuza",
    mafikeng: "mahikeng",
    pietersburg: "polokwane",
    ellisras: "lephalale",
    potgietersrus: "mokopane",
    warmbaths: "belabela",
    nylstroom: "modimolle",
    makhado: "louistrichardt",
    tshwane: "pretoria",
    ekurhuleni: "germiston",
    capetowncity: "capetown",
    ethekwini: "durban",
    buffalocity: "eastlondon",
    mangaung: "bloemfontein",
    nelsonmandelabay: "gqeberha",
    msunduzi: "pietermaritzburg",
};

export const normalizeTownName = (value?: string) =>
    String(value || "")
        .replace(/\([^)]*\)/g, "")
        .replace(/(local|metropolitan|district)?\s*municipality/gi, "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");

const TOWN_BY_KEY: Record<string, SaTown> = Object.fromEntries(
    SA_TOWNS.map((town) => [normalizeTownName(town.name), town])
);

const lookupOne = (value?: string): SaTown | undefined => {
    const key = normalizeTownName(value);
    if (!key) return undefined;
    return TOWN_BY_KEY[SA_TOWN_ALIASES[key] || key];
};

// Tries each candidate whole and then each comma-separated part, so
// "Matlosana", "Springs (Head Office)" and "12 Main Rd, Kriel" all resolve.
export const findSaTown = (...candidates: Array<string | undefined>) => {
    for (const candidate of candidates) {
        const whole = lookupOne(candidate);
        if (whole) return whole;
        for (const part of String(candidate || "").split(",")) {
            const town = lookupOne(part);
            if (town) return town;
        }
    }
    return undefined;
};
