/**
 * Parking guide data for UW campus venues.
 *
 * Each venue has a set of recommended parking lots with coordinates, walking
 * times, and descriptive text. The parking guide page uses this data to render
 * the map and info panel.
 */

export interface ParkingLot {
    id: string;
    name: string;
    nameCn: string;
    type: 'general' | 'disabled' | 'garage';
    lat: number;
    lng: number;
    walkingMinutes: number;
    /** Whether this lot is the primary recommendation for the venue. */
    recommended: boolean;
    descriptionEn: string;
    descriptionCn: string;
}

export interface Venue {
    id: string;
    nameEn: string;
    nameCn: string;
    shortName: string;
    lat: number;
    lng: number;
    /** Keywords that match the event `location` field to this venue. */
    keywords: string[];
    parkingLots: ParkingLot[];
    parkingNotesEn: string[];
    parkingNotesCn: string[];
}

/**
 * All known UW campus venues with parking data.
 * To add a new venue, add an entry here with its coordinates and parking lots.
 */
export const VENUES: Venue[] = [
    {
        id: 'hub',
        nameEn: 'Husky Union Building',
        nameCn: '学生活动中心',
        shortName: 'HUB',
        lat: 47.6553,
        lng: -122.3050,
        keywords: ['hub', 'husky union', 'husky union building'],
        parkingLots: [
            {
                id: 'n24',
                name: 'N24 General Parking',
                nameCn: 'N24 普通停车场',
                type: 'general',
                lat: 47.6570,
                lng: -122.3025,
                walkingMinutes: 5,
                recommended: true,
                descriptionEn: 'N24 is the recommended parking with 5 min walking distance.',
                descriptionCn: 'N24 是推荐停车场，步行约5分钟。',
            },
            {
                id: 'padelford-garage',
                name: 'Padelford Parking Garage',
                nameCn: 'Padelford 停车库',
                type: 'garage',
                lat: 47.6585,
                lng: -122.3040,
                walkingMinutes: 7,
                recommended: false,
                descriptionEn: 'Padelford Parking Garage is recommended as well with more spots available, 7 min walking.',
                descriptionCn: 'Padelford 停车库车位较多，步行约7分钟。',
            },
            {
                id: 'n22',
                name: 'N22 Disabled Parking',
                nameCn: 'N22 无障碍停车场',
                type: 'disabled',
                lat: 47.6560,
                lng: -122.3095,
                walkingMinutes: 4,
                recommended: false,
                descriptionEn: 'N22 provides disabled parking.',
                descriptionCn: 'N22 提供无障碍停车位。',
            },
        ],
        parkingNotesEn: [
            'Parking permits are complimentary during Saturdays after noon until Monday 6 a.m., except when event rates are in effect.',
            'For more information, visit transportation.uw.edu/park/visitor',
        ],
        parkingNotesCn: [
            '周六中午至周一早上6点停车免费，除非活动费率生效。',
            '更多信息请访问 transportation.uw.edu/park/visitor',
        ],
    },
    {
        id: 'denny',
        nameEn: 'Denny Hall',
        nameCn: 'Denny 大楼',
        shortName: 'DEN',
        lat: 47.6584,
        lng: -122.3088,
        keywords: ['denny', 'denny hall'],
        parkingLots: [
            {
                id: 'n01',
                name: 'N01 General Parking',
                nameCn: 'N01 普通停车场',
                type: 'general',
                lat: 47.6595,
                lng: -122.3080,
                walkingMinutes: 3,
                recommended: true,
                descriptionEn: 'N01 is the closest parking to Denny Hall, located near the Burke Museum.',
                descriptionCn: 'N01 是距离 Denny 大楼最近的停车场，靠近 Burke 博物馆。',
            },
            {
                id: 'cpg-denny',
                name: 'Central Plaza Garage',
                nameCn: '中央广场停车库 (CPG)',
                type: 'garage',
                lat: 47.6565,
                lng: -122.3100,
                walkingMinutes: 6,
                recommended: false,
                descriptionEn: 'Central Plaza Garage has more spots if N01 is full.',
                descriptionCn: '如果 N01 满员，中央广场停车库 (CPG) 有更多车位。',
            },
            {
                id: 'n2-disabled',
                name: 'N2 Disabled Parking',
                nameCn: 'N2 无障碍停车场',
                type: 'disabled',
                lat: 47.6590,
                lng: -122.3085,
                walkingMinutes: 2,
                recommended: false,
                descriptionEn: 'N2 has accessible parking spaces right next to Denny Hall.',
                descriptionCn: 'N2 在 Denny 大楼旁边提供无障碍停车位。',
            },
        ],
        parkingNotesEn: [
            'Parking permits are complimentary during Saturdays after noon until Monday 6 a.m., except when event rates are in effect.',
            'For more information, visit transportation.uw.edu/park/visitor',
        ],
        parkingNotesCn: [
            '周六中午至周一早上6点停车免费，除非活动费率生效。',
            '更多信息请访问 transportation.uw.edu/park/visitor',
        ],
    },
    {
        id: 'kane',
        nameEn: 'Kane Hall',
        nameCn: 'Kane 大厅',
        shortName: 'KNE',
        lat: 47.6566,
        lng: -122.3091,
        keywords: ['kane', 'kane hall'],
        parkingLots: [
            {
                id: 'cpg-kane',
                name: 'Central Plaza Garage',
                nameCn: '中央广场停车库 (CPG)',
                type: 'garage',
                lat: 47.6565,
                lng: -122.3100,
                walkingMinutes: 2,
                recommended: true,
                descriptionEn: 'Central Plaza Garage is located directly underneath Red Square, next to Kane Hall.',
                descriptionCn: '中央广场停车库位于红场正下方，紧邻 Kane 大厅。',
            },
        ],
        parkingNotesEn: [
            'For Kane Hall events, park in Central Plaza Garage and look for the Kane Hall elevators in the northeast corner.',
            'Parking permits are complimentary during Saturdays after noon until Monday 6 a.m., except when event rates are in effect.',
        ],
        parkingNotesCn: [
            '参加 Kane 大厅的活动，请在中央广场停车库停车，并寻找位于东北角的 Kane 大厅电梯。',
            '周六中午至周一早上6点停车免费，除非活动费率生效。',
        ],
    },
    {
        id: 'meany',
        nameEn: 'Meany Hall',
        nameCn: 'Meany 大厅',
        shortName: 'MNY',
        lat: 47.6558,
        lng: -122.3106,
        keywords: ['meany', 'meany hall', 'meany studio'],
        parkingLots: [
            {
                id: 'cpg-meany',
                name: 'Central Plaza Garage',
                nameCn: '中央广场停车库 (CPG)',
                type: 'garage',
                lat: 47.6565,
                lng: -122.3100,
                walkingMinutes: 1,
                recommended: true,
                descriptionEn: 'Central Plaza Garage is located directly beneath Meany Hall. Level C03 is best for the main theater.',
                descriptionCn: '中央广场停车库位于 Meany 大厅正下方。C03 层最方便前往主剧场。',
            },
        ],
        parkingNotesEn: [
            'Park in Central Plaza Garage. Use the PayByPhone app (location 123211 for accessible parking on C01).',
            'Parking is free on Saturdays after 12 p.m. and all day Sundays.',
        ],
        parkingNotesCn: [
            '请在中央广场停车库停车。使用 PayByPhone 应用程序（C01 无障碍停车位编号为 123211）。',
            '周六下午 12 点后及周日全天免费停车。',
        ],
    },
    {
        id: 'paccar',
        nameEn: 'Paccar Hall',
        nameCn: 'Paccar 大楼',
        shortName: 'PCAR',
        lat: 47.6588,
        lng: -122.3082,
        keywords: ['paccar', 'paccar hall', 'foster'],
        parkingLots: [
            {
                id: 'n1',
                name: 'N1 & N5 Parking',
                nameCn: 'N1 & N5 停车场',
                type: 'general',
                lat: 47.6598,
                lng: -122.3070,
                walkingMinutes: 3,
                recommended: true,
                descriptionEn: 'N1 and N5 lots are the closest to Paccar Hall.',
                descriptionCn: 'N1 和 N5 停车场距离 Paccar 大楼最近。',
            },
            {
                id: 'cpg-paccar',
                name: 'Central Plaza Garage',
                nameCn: '中央广场停车库 (CPG)',
                type: 'garage',
                lat: 47.6565,
                lng: -122.3100,
                walkingMinutes: 7,
                recommended: false,
                descriptionEn: 'Central Plaza Garage is a larger alternative if the North lots are full.',
                descriptionCn: '如果北区停车场满员，中央广场停车库 (CPG) 是一个更大的备选。',
            },
        ],
        parkingNotesEn: [
            'Parking permits are complimentary during Saturdays after noon until Monday 6 a.m., except when event rates are in effect.',
        ],
        parkingNotesCn: [
            '周六中午至周一早上6点停车免费，除非活动费率生效。',
        ],
    },
    {
        id: 'ima',
        nameEn: 'Intramural Activities Building',
        nameCn: '校内体育活动中心 (IMA)',
        shortName: 'IMA',
        lat: 47.6534,
        lng: -122.3015,
        keywords: ['ima', 'intramural activities'],
        parkingLots: [
            {
                id: 'e18',
                name: 'E18 Parking Lot',
                nameCn: 'E18 停车场',
                type: 'general',
                lat: 47.6535,
                lng: -122.2985,
                walkingMinutes: 3,
                recommended: true,
                descriptionEn: 'E18 is located just north of the IMA.',
                descriptionCn: 'E18 位于 IMA 的正北方。',
            },
            {
                id: 'e1',
                name: 'E1 General Parking',
                nameCn: 'E1 大型停车场',
                type: 'general',
                lat: 47.6550,
                lng: -122.2985,
                walkingMinutes: 6,
                recommended: false,
                descriptionEn: 'E1 is a massive lot further north if E18 is full.',
                descriptionCn: '如果 E18 满员，更北面的 E1 是一个超大型停车场。',
            },
        ],
        parkingNotesEn: [
            'Check for Husky football or basketball game day restrictions, as E1/E18 rates and availability can change drastically during events.',
        ],
        parkingNotesCn: [
            '请注意哈士奇队橄榄球或篮球比赛日的停车限制，E1/E18 的费率和可用车位在比赛期间可能会大幅变动。',
        ],
    },
];

/**
 * Attempt to resolve an event's `location` string to a known venue.
 * Returns the matching Venue or `null` if no match is found.
 */
export function resolveVenue(location: string): Venue | null {
    const lower = location.toLowerCase();
    for (const venue of VENUES) {
        for (const kw of venue.keywords) {
            if (lower.includes(kw)) return venue;
        }
    }
    return null;
}

/** Default map center (UW campus center) when no venue-specific center is available. */
export const UW_CAMPUS_CENTER = {lat: 47.6553, lng: -122.3035};
export const DEFAULT_ZOOM = 17;
