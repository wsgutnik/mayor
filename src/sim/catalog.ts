/**
 * The Basic Buildings Kit plus the 41-84 expansion: 84 buildings in categories R1-R5, C1-C4, I1-I4 and civic, health, education,
 * safety, transport and utility groups. Used for names, descriptions and thumbnails in the UI, and to decide
 * which model a zoned building takes.
 */
import { FAC, FacilityKind, ZONE } from "./world";

export type CatalogGroup =
  | "residential" | "commercial" | "industrial" | "civic" | "health" | "education" | "safety" | "transport" | "utility";

export interface CatalogEntry {
  /** 1-84, as numbered in the kit (41-84 are the expansion set). */
  n: number;
  name: string;
  nameEn: string;
  /** Kit category such as R1, C2, S3, U4. */
  category: string;
  group: CatalogGroup;
  use: string;
  useEn: string;
  /** Set when a zoned building of this zone and level can take this look. */
  zone?: number;
  level?: number;
  /** Set when a player-placed facility is this building. */
  facility?: FacilityKind;
}

const e = (
  n: number, name: string, nameEn: string, category: string, group: CatalogGroup, use: string, useEn: string,
  extra: Partial<CatalogEntry> = {},
): CatalogEntry => ({ n, name, nameEn, category, group, use, useEn, ...extra });

export const CATALOG: CatalogEntry[] = [
  e(1, "Casa Inicial", "Starter House", "R1", "residential", "moradia de entrada", "entry-level housing", { zone: ZONE.RES, level: 1 }),
  e(2, "Casa Familiar", "Family House", "R1", "residential", "família média", "average family", { zone: ZONE.RES, level: 1 }),
  e(3, "Sobrado Moderno", "Modern Townhouse", "R2", "residential", "bairro urbano", "urban neighbourhood", { zone: ZONE.RES, level: 2 }),
  e(4, "Vila Geminada", "Semi-detached Villa", "R2", "residential", "adensamento leve", "light densification", { zone: ZONE.RES, level: 2 }),
  e(5, "Pequeno Apartamento", "Small Apartment", "R3", "residential", "habitação compacta", "compact housing", { zone: ZONE.RES, level: 3 }),
  e(6, "Condomínio Jardim", "Garden Condominium", "R3", "residential", "moradia de bairro", "neighbourhood housing", { zone: ZONE.RES, level: 3 }),
  e(7, "Torre Compacta", "Compact Tower", "R4", "residential", "adensamento urbano", "urban densification", { zone: ZONE.RES, level: 3 }),
  e(8, "Residencial Varanda", "Balcony Residence", "R3", "residential", "famílias urbanas", "urban families", { zone: ZONE.RES, level: 3 }),
  e(9, "Edifício Misto Local", "Local Mixed-use Building", "R4", "residential", "moradia sobre lojas", "homes above shops", { zone: ZONE.RES, level: 3 }),
  e(10, "Torre Premium", "Premium Tower", "R5", "residential", "habitação de alto padrão", "high-end housing", { zone: ZONE.RES, level: 3 }),

  e(11, "Loja de Conveniência", "Convenience Store", "C1", "commercial", "compras rápidas", "quick shopping", { zone: ZONE.COM, level: 1 }),
  e(12, "Café de Esquina", "Corner Café", "C1", "commercial", "encontro local", "local meeting place", { zone: ZONE.COM, level: 1 }),
  e(13, "Mercado Local", "Local Market", "C2", "commercial", "abastecimento diário", "daily supplies", { zone: ZONE.COM, level: 2 }),
  e(14, "Restaurante Urbano", "Urban Restaurant", "C2", "commercial", "alimentação", "dining", { zone: ZONE.COM, level: 2 }),
  e(15, "Farmácia de Bairro", "Neighbourhood Pharmacy", "C1", "commercial", "serviços essenciais", "essential services", { zone: ZONE.COM, level: 1 }),
  e(16, "Escritório Compacto", "Compact Office", "C2", "commercial", "serviços profissionais", "professional services", { zone: ZONE.COM, level: 2 }),
  e(17, "Banco Local", "Local Bank", "C2", "commercial", "serviços financeiros", "financial services", { zone: ZONE.COM, level: 2 }),
  e(18, "Hotel Executivo", "Executive Hotel", "C3", "commercial", "hospedagem", "lodging", { zone: ZONE.COM, level: 3 }),
  e(19, "Shopping de Bairro", "Neighbourhood Mall", "C3", "commercial", "varejo variado", "varied retail", { zone: ZONE.COM, level: 3 }),
  e(20, "Torre Corporativa", "Corporate Tower", "C4", "commercial", "negócios e escritórios", "business and offices", { zone: ZONE.COM, level: 3 }),

  e(21, "Prefeitura", "City Hall", "S3", "civic", "administração central", "central administration", { facility: FAC.CITYHALL }),
  e(22, "Biblioteca Municipal", "Public Library", "S2", "civic", "educação e cultura", "education and culture", { facility: FAC.LIBRARY }),
  e(23, "Centro Comunitário", "Community Centre", "S2", "civic", "eventos e apoio social", "events and social support", { facility: FAC.COMMUNITY }),
  e(24, "Delegacia", "Police Station", "S3", "safety", "polícia e ordem pública", "police and public order", { facility: FAC.POLICE }),
  e(25, "Museu Municipal", "City Museum", "S3", "civic", "cultura e turismo", "culture and tourism", { facility: FAC.MUSEUM }),

  e(26, "Clínica", "Clinic", "S2", "health", "atendimento básico", "basic care", { facility: FAC.CLINIC }),
  e(27, "Hospital Geral", "General Hospital", "S4", "health", "atendimento avançado", "advanced care", { facility: FAC.HOSPITAL }),
  e(28, "Escola Primária", "Primary School", "S2", "education", "ensino infantil e básico", "primary education", { facility: FAC.SCHOOL }),
  e(29, "Escola Secundária", "Secondary School", "S3", "education", "ensino juvenil", "secondary education", { facility: FAC.HIGHSCHOOL }),
  e(30, "Quartel dos Bombeiros", "Fire Station", "S3", "safety", "resposta a incêndios", "fire response", { facility: FAC.FIRE }),

  e(31, "Estação de Ônibus", "Bus Station", "T2", "transport", "integração local", "local integration"),
  e(32, "Estação de Trem", "Train Station", "T3", "transport", "mobilidade regional", "regional mobility", { facility: FAC.METRO }),
  e(33, "Terminal de Carga", "Cargo Terminal", "T3", "transport", "logística urbana", "urban logistics"),
  e(34, "Estação de Tratamento de Água", "Water Treatment Plant", "U3", "utility", "abastecimento", "water supply", { facility: FAC.WATER }),
  e(35, "Subestação Elétrica", "Electrical Substation", "U2", "utility", "distribuição de energia", "power distribution", { facility: FAC.SUBSTATION }),

  e(36, "Armazém Logístico", "Logistics Warehouse", "I1", "industrial", "armazenamento", "storage", { zone: ZONE.IND, level: 1 }),
  e(37, "Fábrica Leve", "Light Factory", "I2", "industrial", "manufatura simples", "simple manufacturing", { zone: ZONE.IND, level: 2 }),
  e(38, "Fábrica Pesada", "Heavy Factory", "I4", "industrial", "produção intensa", "intensive production", { zone: ZONE.IND, level: 3 }),
  e(39, "Centro de Reciclagem", "Recycling Centre", "U3", "utility", "gestão de resíduos", "waste management", { facility: FAC.LANDFILL }),
  e(40, "Usina Termelétrica", "Thermal Power Plant", "U4", "utility", "geração de energia", "power generation", { facility: FAC.POWER }),
  e(41, "Casa Ecológica", "Eco House", "R1", "residential", "moradia sustentável", "sustainable housing", { zone: ZONE.RES, level: 1 }),
  e(42, "Casa de Pedra", "Stone Cottage", "R1", "residential", "moradia rústica", "rustic housing", { zone: ZONE.RES, level: 1 }),
  e(43, "Duplex Urbano", "Urban Duplex", "R2", "residential", "duas famílias", "two families", { zone: ZONE.RES, level: 2 }),
  e(44, "Casas em Fita", "Row Houses", "R2", "residential", "adensamento leve", "light densification", { zone: ZONE.RES, level: 2 }),
  e(45, "Apartamento Pátio", "Courtyard Apartments", "R3", "residential", "moradia de bairro", "neighbourhood housing", { zone: ZONE.RES, level: 3 }),
  e(46, "Condomínio Parque", "Park Condominium", "R3", "residential", "famílias urbanas", "urban families", { zone: ZONE.RES, level: 3 }),
  e(47, "Torre Espelho", "Mirror Tower", "R4", "residential", "adensamento urbano", "urban densification", { zone: ZONE.RES, level: 3 }),
  e(48, "Residencial Terraço", "Terrace Residence", "R3", "residential", "moradia sobre o bairro", "homes over the district", { zone: ZONE.RES, level: 3 }),

  e(49, "Padaria Artesanal", "Artisan Bakery", "C1", "commercial", "alimentação local", "local food", { zone: ZONE.COM, level: 1 }),
  e(50, "Livraria de Bairro", "Neighbourhood Bookshop", "C1", "commercial", "cultura e varejo", "culture and retail", { zone: ZONE.COM, level: 1 }),
  e(51, "Mercado Coberto", "Covered Market", "C2", "commercial", "abastecimento diário", "daily supplies", { zone: ZONE.COM, level: 2 }),
  e(52, "Academia Urbana", "Urban Gym", "C2", "commercial", "saúde e lazer", "health and leisure", { zone: ZONE.COM, level: 2 }),
  e(53, "Escritório Parque", "Office Park", "C3", "commercial", "serviços profissionais", "professional services", { zone: ZONE.COM, level: 3 }),
  e(54, "Cinema de Bairro", "Neighbourhood Cinema", "C3", "commercial", "lazer e cultura", "leisure and culture", { zone: ZONE.COM, level: 3 }),
  e(55, "Hotel Boutique", "Boutique Hotel", "C3", "commercial", "hospedagem", "lodging", { zone: ZONE.COM, level: 3 }),
  e(56, "Torre de Escritórios", "Office Tower", "C4", "commercial", "negócios e escritórios", "business and offices", { zone: ZONE.COM, level: 3 }),

  e(57, "Oficina Maker", "Maker Workshop", "I1", "industrial", "produção leve", "light production", { zone: ZONE.IND, level: 1 }),
  e(58, "Fábrica de Alimentos", "Food Factory", "I2", "industrial", "processamento", "processing", { zone: ZONE.IND, level: 2 }),
  e(59, "Montadora Tech", "Tech Assembly Plant", "I4", "industrial", "produção intensa", "intensive production", { zone: ZONE.IND, level: 3 }),
  e(60, "Armazém Frigorífico", "Cold Storage Warehouse", "I3", "industrial", "armazenamento refrigerado", "cold storage", { zone: ZONE.IND, level: 3 }),

  e(61, "Estação Ferroviária", "Train Station", "T4", "transport", "trem regional", "regional rail", { facility: FAC.TRAIN_STATION }),
  e(62, "Plataforma Regional", "Regional Platform", "T2", "transport", "embarque regional", "regional boarding"),
  e(63, "Pátio de Manobras", "Rail Yard", "T3", "transport", "manobra de composições", "train shunting"),
  e(64, "Terminal Intermodal", "Intermodal Terminal", "T4", "transport", "integração trem e ônibus", "train and bus interchange"),
  e(65, "Depósito de Trens", "Train Depot", "T3", "transport", "manutenção de trens", "train maintenance"),
  e(66, "Terminal Ferroviário de Carga", "Rail Freight Terminal", "T3", "transport", "carga por ferrovia", "rail freight"),

  e(67, "Centro de Artes", "Arts Centre", "S2", "civic", "cultura local", "local culture"),
  e(68, "Posto de Saúde Avançado", "Advanced Health Post", "S2", "health", "atendimento ampliado", "expanded care"),
  e(69, "Escola Técnica", "Technical School", "S3", "education", "formação técnica", "technical training"),
  e(70, "Base Comunitária de Segurança", "Community Safety Base", "S2", "safety", "presença local", "local presence"),
  e(71, "Centro Esportivo", "Sports Centre", "S2", "civic", "esporte e lazer", "sport and leisure"),
  e(72, "Arquivo Municipal", "Municipal Archive", "S2", "civic", "documentos e memória", "records and memory"),

  e(73, "Usina Solar", "Solar Plant", "U3", "utility", "energia renovável", "renewable power", { facility: FAC.POWER_SOLAR }),
  e(74, "Estação de Recarga", "Charging Station", "U2", "utility", "veículos elétricos", "electric vehicles"),
  e(75, "Centro de Compostagem", "Composting Centre", "U2", "utility", "resíduos orgânicos", "organic waste"),
  e(76, "Reservatório Elevado", "Elevated Reservoir", "U3", "utility", "reserva de água", "water reserve", { facility: FAC.WATER_TOWER }),

  e(77, "Residencial da Estação", "Station Residence", "R4", "residential", "moradia junto ao trem", "homes by the train", { zone: ZONE.RES, level: 3 }),
  e(78, "Varejo da Estação", "Station Retail", "C3", "commercial", "lojas da estação", "station shops", { zone: ZONE.COM, level: 3 }),
  e(79, "Galpão Ferroviário", "Rail-side Warehouse", "I2", "industrial", "logística ferroviária", "rail logistics", { zone: ZONE.IND, level: 2 }),
  e(80, "Estação Central", "Grand Central Station", "T5", "transport", "hub ferroviário central", "central rail hub"),

  e(81, "Usina de Grande Porte", "Large Power Plant", "U5", "utility", "geração em larga escala", "large-scale generation", { facility: FAC.POWER_LARGE }),
  e(82, "Estação de Tratamento Avançada", "Advanced Treatment Plant", "U4", "utility", "abastecimento ampliado", "expanded water supply", { facility: FAC.WATER_LARGE }),
  e(83, "Quartel Central dos Bombeiros", "Fire Headquarters", "S4", "safety", "comando e resposta ampla", "command and wide response", { facility: FAC.FIRE_HQ }),
  e(84, "Posto Avançado dos Bombeiros", "Fire Post", "S1", "safety", "resposta local rápida", "fast local response", { facility: FAC.FIRE_POST }),
];

const byN = new Map(CATALOG.map((c) => [c.n, c]));
export const entryByNumber = (n: number): CatalogEntry | undefined => byN.get(n);

/** Entries a zoned building of this zone and level can look like, in kit order. */
export function zoneEntries(zone: number, level: number): CatalogEntry[] {
  return CATALOG.filter((c) => c.zone === zone && c.level === level);
}

/** The kit entry for a player-placed facility, when the kit has one. */
export function facilityEntry(kind: FacilityKind): CatalogEntry | undefined {
  return CATALOG.find((c) => c.facility === kind);
}

/** Thumbnail URL for an entry (public/ui/buildings/NN.jpg). */
export const thumbnailOf = (n: number) => `/ui/buildings/${String(n).padStart(2, "0")}.jpg`;

/** Stable pick of the look for the building at a tile; the renderer uses the same index. */
export function pickZoneEntry(zone: number, level: number, hash01: number): CatalogEntry | undefined {
  const list = zoneEntries(zone, level);
  return list.length ? list[Math.min(list.length - 1, Math.floor(hash01 * list.length))] : undefined;
}

/** The resolved look of a lot's building: the entry and where it sits in its pool. */
export interface LotLook {
  entry: CatalogEntry | undefined;
  /** Effective level (a large lot borrows the next tier's looks). */
  level: number;
  /** Index into zoneEntries(zone, level). */
  index: number;
}

/**
 * Stable pick of the look for a whole lot. Larger lots prefer higher-level
 * entries: any multi-tile lot borrows the next tier up (a 2x2 level-1 block
 * already looks like level 2), so big footprints never wear the smallest hut.
 */
export function pickLotEntry(zone: number, level: number, area: number, hash01: number): LotLook {
  // The kit currently has three visual tiers. Simulation levels 4-5 deliberately
  // borrow tier 3 until their dedicated growable variants ship.
  const eff = Math.min(3, Math.max(1, level + (area > 1 ? 1 : 0)));
  const list = zoneEntries(zone, eff);
  const index = list.length ? Math.min(list.length - 1, Math.floor(hash01 * list.length)) : 0;
  return { entry: list[index], level: eff, index };
}

/** Deterministic 0..1 hash of a tile, shared by the renderer and the UI so both pick the same building. */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
