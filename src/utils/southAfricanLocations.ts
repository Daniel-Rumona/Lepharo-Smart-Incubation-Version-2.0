/**
 * Provinces and their main cities/towns, used by the branch form so a location
 * is picked as province -> city -> street address instead of typed free-hand.
 * The city field still accepts a town that is not listed.
 */
export const SOUTH_AFRICAN_LOCATIONS: Record<string, string[]> = {
    'Eastern Cape': [
        'Aliwal North', 'Bhisho', 'Cradock', 'East London', 'Graaff-Reinet', 'Grahamstown (Makhanda)',
        'Gqeberha (Port Elizabeth)', 'Humansdorp', 'Jeffreys Bay', 'King William\'s Town (Qonce)',
        'Komani (Queenstown)', 'Mthatha', 'Port Alfred', 'Uitenhage (Kariega)'
    ],
    'Free State': [
        'Bethlehem', 'Bloemfontein', 'Botshabelo', 'Harrismith', 'Kroonstad', 'Parys', 'Phuthaditjhaba',
        'Sasolburg', 'Thaba Nchu', 'Virginia', 'Welkom'
    ],
    'Gauteng': [
        'Alberton', 'Benoni', 'Boksburg', 'Brakpan', 'Centurion', 'Germiston', 'Johannesburg', 'Kempton Park',
        'Krugersdorp', 'Midrand', 'Pretoria', 'Randburg', 'Roodepoort', 'Sandton', 'Soweto', 'Springs',
        'Vanderbijlpark', 'Vereeniging'
    ],
    'KwaZulu-Natal': [
        'Durban', 'Empangeni', 'Estcourt', 'Ladysmith', 'Newcastle', 'Pietermaritzburg', 'Pinetown',
        'Port Shepstone', 'Richards Bay', 'Ulundi', 'Umhlanga', 'Vryheid'
    ],
    'Limpopo': [
        'Bela-Bela', 'Giyani', 'Lephalale', 'Louis Trichardt (Makhado)', 'Modimolle', 'Mokopane', 'Musina',
        'Phalaborwa', 'Polokwane', 'Thohoyandou', 'Tzaneen'
    ],
    'Mpumalanga': [
        'Barberton', 'Emalahleni (Witbank)', 'Ermelo', 'Kanyamazane', 'Komatipoort', 'Middelburg', 'Mbombela (Nelspruit)',
        'Piet Retief', 'Secunda', 'Standerton', 'White River'
    ],
    'North West': [
        'Brits', 'Klerksdorp', 'Lichtenburg', 'Mahikeng', 'Mogwase', 'Potchefstroom', 'Rustenburg', 'Vryburg',
        'Zeerust'
    ],
    'Northern Cape': [
        'Alexander Bay', 'Calvinia', 'De Aar', 'Kathu', 'Kimberley', 'Kuruman', 'Springbok', 'Upington'
    ],
    'Western Cape': [
        'Beaufort West', 'Bellville', 'Cape Town', 'George', 'Hermanus', 'Knysna', 'Mossel Bay', 'Oudtshoorn',
        'Paarl', 'Somerset West', 'Stellenbosch', 'Worcester'
    ]
}

export const SOUTH_AFRICAN_PROVINCES = Object.keys(SOUTH_AFRICAN_LOCATIONS)

export const citiesForProvince = (province?: string | null): string[] =>
    (province && SOUTH_AFRICAN_LOCATIONS[province]) || []

/** Matches a stored province value to the canonical spelling, ignoring case and spacing. */
export const matchProvince = (value?: string | null): string | undefined => {
    const needle = String(value || '').trim().toLowerCase()
    if (!needle) return undefined
    return SOUTH_AFRICAN_PROVINCES.find(province => province.toLowerCase() === needle)
}

/** Joins the non-empty parts of a location, skipping parts already contained in an earlier one. */
export const formatLocation = (parts: Array<string | undefined | null>): string => {
    const kept: string[] = []
    parts
        .map(part => String(part || '').trim())
        .filter(Boolean)
        .forEach(part => {
            const lower = part.toLowerCase()
            if (!kept.some(existing => existing.toLowerCase().includes(lower))) kept.push(part)
        })
    return kept.join(', ')
}
